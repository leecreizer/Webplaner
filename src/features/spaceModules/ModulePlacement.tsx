import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { BoxGeometry as BoxGeometryCtor, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { Edges, Html } from '@react-three/drei';
import { useSpaceModuleStore, MODULE_PRESETS, OPENING_DEFAULTS } from './spaceModuleStore';
import { useImportedModelStore, type PrimitiveKind } from '@/features/models/importedModelStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { moduleEdges } from './compileModules';
import { computeModuleSnap } from './moduleSnap';
import { OpeningMarkers } from './OpeningMarkers';

const KIND_COLOR: Record<string, string> = {
  bedroom: '#93c5fd', living: '#fcd34d', kitchen: '#86efac',
  bath: '#a5f3fc', entrance: '#d8b4fe', corridor: '#e5e7eb', custom: '#f9a8d4',
};

/** 공간 모듈 배치/표시/선택 — Canvas 내부 전용. */
export function ModulePlacement() {
  const modules = useSpaceModuleStore((s) => s.modules);
  const selectedId = useSpaceModuleStore((s) => s.selectedId);
  const pendingKind = useSpaceModuleStore((s) => s.pendingKind);
  const pendingOpeningType = useSpaceModuleStore((s) => s.pendingOpeningType);
  const movingOpening = useSpaceModuleStore((s) => s.movingOpening);
  // 활성 부착 작업(신규 배치 or 기존 재배치)의 종류·치수 — 고스트/픽킹 공용
  const activeAttach = useMemo(() => {
    if (pendingOpeningType) {
      const d = OPENING_DEFAULTS[pendingOpeningType];
      return { type: pendingOpeningType, width: d.width, height: d.height, sill: d.sill, mode: 'new' as const };
    }
    if (movingOpening) {
      const m = modules.find((mm) => mm.id === movingOpening.moduleId);
      const o = m?.openings.find((oo) => oo.id === movingOpening.openingId);
      if (o) return { type: o.type, width: o.width, height: o.height, sill: o.sill, mode: 'move' as const };
    }
    return null;
  }, [pendingOpeningType, movingOpening, modules]);
  const { camera, gl } = useThree();
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  // 개구부 부착 미리보기 — 포인터 근처 모듈 벽면 위 스냅 위치
  const [attachHover, setAttachHover] = useState<{
    moduleId: string; side: 'N'|'E'|'S'|'W'; offset: number;
    x: number; z: number; rotY: number;
  } | null>(null);
  // 부착 모드에서 마우스를 따라다니는 커서 위치(바닥 교점) — 벽 스냅 전에도 고스트 표시
  const [attachCursor, setAttachCursor] = useState<[number, number] | null>(null);
  // 드래그 중인 모듈의 "잡은 지점 - 모듈 중심" 오프셋. null이면 드래그 아님.
  const dragRef = useRef<{ id: string; offX: number; offZ: number } | null>(null);

  // ESC 로 배치 취소
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useSpaceModuleStore.getState().setPendingKind(null);
        useSpaceModuleStore.getState().setPendingOpeningType(null);
        useSpaceModuleStore.getState().setMovingOpening(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // R 키 — 선택된 모듈을 90°씩 회전
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (useViewStore.getState().viewMode !== '2D') return; // 모듈 회전도 2D 전용
      const s = useSpaceModuleStore.getState();
      if (!s.selectedId) return;
      const m = s.modules.find((mm) => mm.id === s.selectedId);
      if (!m) return;
      s.transformModule(m.id, { ry: (m.ry + 90) % 360 }); // 상품 동반 회전
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 고스트 박스 지오메트리 — 종류별 1회 생성 (렌더마다 재생성 시 GPU 누수)
  const ghostGeo = useMemo(() => {
    if (!activeAttach) return null;
    return new BoxGeometryCtor(activeAttach.width, activeAttach.height, 0.3);
  }, [activeAttach]);
  useEffect(() => () => { ghostGeo?.dispose(); }, [ghostGeo]);

  // 개구부 부착 모드 — canvas 캡처 단계에서 직접 레이캐스트 (벽 stopPropagation 우회).
  // 바닥(y=0) 평면과의 교점을 구해 가장 가까운 모듈 벽면에 스냅한다.
  useEffect(() => {
    if (!activeAttach) { setAttachHover(null); setAttachCursor(null); return; }
    const attachType = activeAttach.type;
    const el = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const hitPt = new Vector3();

    const pick = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      // 1) 벽면 직접 클릭 — 각 모듈 변의 수직 평면과 교차 (3D 뷰에서 자연스러운 조작)
      const face = pickWallFace(ray, attachType);
      if (face) return face;
      // 2) 폴백: 바닥(y=0) 교점 근처 벽면 (탑뷰/바닥 클릭)
      if (!ray.ray.intersectPlane(ground, hitPt)) return null;
      return findWallAttach(hitPt.x, hitPt.z, attachType);
    };

    const onMove = (ev: PointerEvent) => {
      setAttachHover(pick(ev));
      // 바닥 교점은 항상 추적 — 벽에서 멀어도 고스트가 마우스에 붙어 다니게
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      setAttachCursor(ray.ray.intersectPlane(ground, hitPt) ? [hitPt.x, hitPt.z] : null);
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const hit = pick(ev);
      // ── 기존 개구부 재배치 모드 ──
      if (activeAttach.mode === 'move') {
        const mv = useSpaceModuleStore.getState().movingOpening;
        if (!mv) return;
        ev.stopPropagation();
        ev.preventDefault();
        if (hit) {
          const st = useSpaceModuleStore.getState();
          if (hit.moduleId === mv.moduleId) {
            // 같은 모듈: 변/위치만 갱신 (충돌 suppress 는 초기화 — 새 위치 기준 재판정)
            st.updateOpening(mv.moduleId, mv.openingId, { side: hit.side, offset: hit.offset, suppressedBy: undefined });
          } else {
            // 다른 모듈 벽으로 이사: 원본 제거 후 새 모듈에 동일 속성으로 추가
            st.addOpening(hit.moduleId, {
              side: hit.side, type: activeAttach.type, offset: hit.offset,
              width: activeAttach.width, height: activeAttach.height,
              ...(activeAttach.sill !== undefined ? { sill: activeAttach.sill } : {}),
            });
            st.removeOpening(mv.moduleId, mv.openingId);
          }
        }
        // 벽 밖 클릭 = 취소 (원위치 유지)
        useSpaceModuleStore.getState().setMovingOpening(null);
        setAttachHover(null);
        setAttachCursor(null);
        return;
      }
      if (!hit) {
        // 벽 근처 아님 → 바닥 교점에 **독립 모델**로 배치 (도어/창호/개구부 프리미티브)
        const r2 = el.getBoundingClientRect();
        ndc.set(((ev.clientX - r2.left) / r2.width) * 2 - 1, -(((ev.clientY - r2.top) / r2.height) * 2 - 1));
        ray.setFromCamera(ndc, camera);
        if (!ray.ray.intersectPlane(ground, hitPt)) return;
        ev.stopPropagation();
        ev.preventDefault();
        const kindMap: Record<'door'|'window'|'opening', PrimitiveKind> = {
          door: 'door', window: 'window', opening: 'openingFrame',
        };
        const im = useImportedModelStore.getState();
        const mid = im.addPrimitive(kindMap[activeAttach.type]);
        im.update(mid, { position: [hitPt.x, 0, hitPt.z] });
        useSpaceModuleStore.getState().setPendingOpeningType(null);
        setAttachHover(null);
        setAttachCursor(null);
        return;
      }
      // 캡처 단계에서 소비 — 벽/바닥 선택 등 r3f 핸들러로 전달 차단
      ev.stopPropagation();
      ev.preventDefault();
      const st = useSpaceModuleStore.getState();
      st.addOpening(hit.moduleId, {
        side: hit.side, type: activeAttach.type,
        offset: hit.offset, width: activeAttach.width, height: activeAttach.height,
        ...(activeAttach.sill !== undefined ? { sill: activeAttach.sill } : {}),
      });
      st.setPendingOpeningType(null);
      setAttachHover(null);
      setAttachCursor(null);
    };

    el.addEventListener('pointermove', onMove, { capture: true });
    el.addEventListener('pointerdown', onDown, { capture: true });
    return () => {
      el.removeEventListener('pointermove', onMove, { capture: true });
      el.removeEventListener('pointerdown', onDown, { capture: true });
    };
  }, [activeAttach, camera, gl]);

  return (
    <group>
      <OpeningMarkers />
      {/* 개구부 부착 미리보기 — 이벤트는 아래 캡처 리스너(useEffect)가 처리 (벽/바닥
          메시의 stopPropagation 에 막히지 않도록 r3f 이벤트를 우회) */}
      {activeAttach && (attachHover || attachCursor) && (() => {
        const d = activeAttach;
        const y = (d.type === 'window' ? (d.sill ?? 0.9) : 0) + d.height / 2;
        // 벽 근처면 벽면 스냅 위치·방향, 아니면 마우스(바닥 교점)에 붙어 따라다님
        const px = attachHover ? attachHover.x : attachCursor![0];
        const pz = attachHover ? attachHover.z : attachCursor![1];
        const rotY = attachHover ? attachHover.rotY : 0;
        return (
          <group position={[px, y, pz]} rotation={[0, rotY, 0]} renderOrder={999}>
            {/* 벽 스냅 시 벽 두께(0.2m)를 관통하는 고스트 — depthTest 끔으로 벽 너머에서도 위치 확인 */}
            <mesh renderOrder={999}>
              <boxGeometry args={[d.width, d.height, attachHover ? 0.3 : 0.1]} />
              <meshBasicMaterial
                color={attachHover ? '#a78bfa' : '#64748b'}
                transparent opacity={attachHover ? 0.5 : 0.35}
                depthWrite={false} depthTest={false}
              />
            </mesh>
            {/* 테두리 — 벽면 위 정확한 윤곽 강조 */}
            {attachHover && ghostGeo && (
              <lineSegments renderOrder={1000}>
                <edgesGeometry args={[ghostGeo]} />
                <lineBasicMaterial color="#7c3aed" depthTest={false} />
              </lineSegments>
            )}
          </group>
        );
      })()}

      {/* 배치 모드: 투명 바닥 캐처 + 고스트 */}
      {pendingKind && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          onPointerMove={(e) => { e.stopPropagation(); setGhost([e.point.x, e.point.z]); }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const s = useSpaceModuleStore.getState();
            s.add(pendingKind, e.point.x, e.point.z);
            s.setPendingKind(null);
            setGhost(null);
          }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {pendingKind && ghost && (
        <mesh position={[ghost[0], 0.02, ghost[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[MODULE_PRESETS[pendingKind].w, MODULE_PRESETS[pendingKind].d]} />
          <meshBasicMaterial color="#a78bfa" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}

      {/* 모듈 바닥 슬래브 + 라벨 + 선택 */}
      {modules.map((m) => {
        const rotY = (-m.ry * Math.PI) / 180;
        const sel = m.id === selectedId;
        return (
          <group key={m.id} position={[m.x, 0, m.z]} rotation={[0, rotY, 0]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.015, 0]}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                if (e.button !== 0) return;
                { const st = useSpaceModuleStore.getState(); if (st.pendingKind || st.pendingOpeningType || st.movingOpening) return; }
                e.stopPropagation();
                useSpaceModuleStore.getState().select(m.id);
                // 모듈 이동은 **2D(탑뷰) 전용** — 3D 에서는 선택만 (공간 배치 변경 방지)
                if (useViewStore.getState().viewMode !== '2D') return;
                // 드래그 시작 — 잡은 지점과 모듈 중심의 오프셋을 저장하고 포인터 캡처.
                dragRef.current = { id: m.id, offX: e.point.x - m.x, offZ: e.point.z - m.z };
                (e.target as Element).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e: ThreeEvent<PointerEvent>) => {
                { const st = useSpaceModuleStore.getState(); if (st.pendingKind || st.pendingOpeningType || st.movingOpening) return; }
                const d = dragRef.current;
                if (!d || d.id !== m.id) return;
                e.stopPropagation();
                const s = useSpaceModuleStore.getState();
                const cur = s.modules.find((mm) => mm.id === d.id);
                if (!cur) return;
                const x = e.point.x - d.offX;
                const z = e.point.z - d.offZ;
                const snap = computeModuleSnap(cur, x, z, s.modules);
                s.transformModule(d.id, { x: x + snap.dx, z: z + snap.dz }); // 상품 동반 이동
              }}
              onPointerUp={(e: ThreeEvent<PointerEvent>) => {
                if (dragRef.current?.id !== m.id) return;
                dragRef.current = null;
                (e.target as Element).releasePointerCapture(e.pointerId);
              }}
            >
              <planeGeometry args={[m.w, m.d]} />
              <meshBasicMaterial
                color={KIND_COLOR[m.kind]}
                transparent opacity={sel ? 0.4 : 0.18} depthWrite={false}
              />
              {sel && <Edges scale={1.001} color="#a78bfa" />}
            </mesh>
            <Html center position={[0, 0.05, 0]} style={{ pointerEvents: 'none', fontSize: 11, color: '#334155', fontWeight: 600, textShadow: '0 0 3px #fff' }}>
              {m.name}
            </Html>
            {/* 선택 시 회전 버튼 — 클릭당 +90° (R 키와 동일). 모듈 우상단 코너에 표시 */}
            {sel && (
              <Html center position={[m.w / 2, 0.05, -m.d / 2]} zIndexRange={[90, 0]}>
                <button
                  onPointerDown={(e) => {
                    // 드래그 = 자유 회전 (5° 스냅, 45/90° 강스냅) / 짧은 클릭 = +90°
                    e.stopPropagation();
                    e.preventDefault();
                    const startX = e.clientX, startY = e.clientY;
                    let moved = false;
                    let alpha0: number | null = null;
                    // 누적 각 — 스냅 전 원시 각도를 유지해 스냅 경계에서 튀지 않게
                    let rawRy = useSpaceModuleStore.getState().modules.find((x) => x.id === m.id)?.ry ?? 0;
                    const canvas = gl.domElement;
                    const toWorld = (cx: number, cy: number) => {
                      const r = canvas.getBoundingClientRect();
                      const nd = new Vector2(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
                      const rc = new Raycaster();
                      rc.setFromCamera(nd, camera);
                      const pt = new Vector3();
                      return rc.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), pt) ? pt : null;
                    };
                    const onMove = (ev: PointerEvent) => {
                      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) moved = true;
                      if (!moved) return;
                      const w = toWorld(ev.clientX, ev.clientY);
                      if (!w) return;
                      const cur = useSpaceModuleStore.getState().modules.find((x) => x.id === m.id);
                      if (!cur) return;
                      const alpha = (Math.atan2(w.z - cur.z, w.x - cur.x) * 180) / Math.PI;
                      if (alpha0 === null) { alpha0 = alpha; return; }
                      let dA = alpha - alpha0;
                      if (dA > 180) dA -= 360; else if (dA < -180) dA += 360; // 랩어라운드 보정
                      rawRy += dA;
                      alpha0 = alpha;
                      useSpaceModuleStore.getState().transformModule(m.id, { ry: snapAngle(rawRy) });
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                      if (!moved) {
                        const st = useSpaceModuleStore.getState();
                        const cur = st.modules.find((x) => x.id === m.id);
                        if (cur) st.transformModule(m.id, { ry: (cur.ry + 90) % 360 });
                      }
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                  title="클릭: 90° 회전 (R) · 드래그: 자유 회전 (5°/45°/90° 스냅)"
                  style={{
                    width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                    border: '1px solid #7c3aed', background: '#a78bfa', color: '#1e1b4b',
                    fontSize: 14, fontWeight: 700, lineHeight: '22px',
                  }}
                >
                  ↻
                </button>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}


/** 회전 각 스냅 — 45°/90° 배수 ±4° 는 강스냅, 그 외 5° 단위. [0,360). */
export function snapAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  const s45 = Math.round(a / 45) * 45;
  if (Math.abs(a - s45) <= 4) return ((s45 % 360) + 360) % 360;
  return ((Math.round(a / 5) * 5) % 360 + 360) % 360;
}

/**
 * 레이가 모듈 벽면(변의 수직 평면)과 직접 교차하는지 검사 — 3D 뷰에서 벽을 바로 클릭하는
 * 자연스러운 부착. 교차점이 벽 구간(길이×높이) 안이면 부착 정보 반환.
 */
function pickWallFace(ray: Raycaster, type: 'door'|'opening'|'window') {
  const modules = useSpaceModuleStore.getState().modules;
  const d = OPENING_DEFAULTS[type];
  const hit = new Vector3();
  let best: { moduleId: string; side: 'N'|'E'|'S'|'W'; offset: number; x: number; z: number; rotY: number } | null = null;
  let bestRayDist = Infinity;
  for (const m of modules) {
    const edges = moduleEdges(m);
    for (const side of ['N', 'E', 'S', 'W'] as const) {
      const e = edges[side];
      const dx = e.bx - e.ax, dz = e.bz - e.az;
      const len = Math.hypot(dx, dz) || 1;
      if (len < d.width) continue;
      const ux = dx / len, uz = dz / len;
      // 변을 지나는 수직 평면 (법선 = 수평 수직벡터)
      const plane = new Plane().setFromNormalAndCoplanarPoint(
        new Vector3(-uz, 0, ux), new Vector3(e.ax, 0, e.az));
      if (!ray.ray.intersectPlane(plane, hit)) continue;
      if (hit.y < -0.05 || hit.y > m.wallH + 0.1) continue; // 벽 높이 밖
      let t = (hit.x - e.ax) * ux + (hit.z - e.az) * uz;
      if (t < -0.1 || t > len + 0.1) continue; // 변 구간 밖
      t = Math.max(d.width / 2, Math.min(len - d.width / 2, t));
      const rayDist = ray.ray.origin.distanceTo(hit);
      if (rayDist < bestRayDist) {
        bestRayDist = rayDist;
        best = { moduleId: m.id, side, offset: t, x: e.ax + ux * t, z: e.az + uz * t, rotY: -Math.atan2(dz, dx) };
      }
    }
  }
  return best;
}

/** 포인터(px,pz)에서 0.6m 안의 가장 가까운 모듈 벽면을 찾아 부착 정보 계산. 없으면 null. */
function findWallAttach(px: number, pz: number, type: 'door'|'opening'|'window') {
  const modules = useSpaceModuleStore.getState().modules;
  const d = OPENING_DEFAULTS[type];
  let best: { moduleId: string; side: 'N'|'E'|'S'|'W'; offset: number; x: number; z: number; rotY: number } | null = null;
  let bestDist = 0.6; // 부착 감지 반경(m)
  for (const m of modules) {
    const edges = moduleEdges(m);
    for (const side of ['N', 'E', 'S', 'W'] as const) {
      const e = edges[side];
      const dx = e.bx - e.ax, dz = e.bz - e.az;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      // 포인터를 변 위로 투영
      let t = (px - e.ax) * ux + (pz - e.az) * uz;
      // 개구부가 변 밖으로 나가지 않게 클램프
      t = Math.max(d.width / 2, Math.min(len - d.width / 2, t));
      if (len < d.width) continue; // 변이 개구부보다 짧으면 부착 불가
      const wx = e.ax + ux * t, wz = e.az + uz * t;
      const dist = Math.hypot(px - wx, pz - wz);
      if (dist < bestDist) {
        bestDist = dist;
        best = { moduleId: m.id, side, offset: t, x: wx, z: wz, rotY: -Math.atan2(dz, dx) };
      }
    }
  }
  return best;
}
