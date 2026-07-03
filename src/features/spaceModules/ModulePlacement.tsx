import { useEffect, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { Edges, Html } from '@react-three/drei';
import { useSpaceModuleStore, MODULE_PRESETS, OPENING_DEFAULTS } from './spaceModuleStore';
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
  const { camera, gl } = useThree();
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  // 개구부 부착 미리보기 — 포인터 근처 모듈 벽면 위 스냅 위치
  const [attachHover, setAttachHover] = useState<{
    moduleId: string; side: 'N'|'E'|'S'|'W'; offset: number;
    x: number; z: number; rotY: number;
  } | null>(null);
  // 드래그 중인 모듈의 "잡은 지점 - 모듈 중심" 오프셋. null이면 드래그 아님.
  const dragRef = useRef<{ id: string; offX: number; offZ: number } | null>(null);

  // ESC 로 배치 취소
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useSpaceModuleStore.getState().setPendingKind(null);
        useSpaceModuleStore.getState().setPendingOpeningType(null);
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
      const s = useSpaceModuleStore.getState();
      if (!s.selectedId) return;
      const m = s.modules.find((mm) => mm.id === s.selectedId);
      if (!m) return;
      s.update(m.id, { ry: (((m.ry + 90) % 360) as 0 | 90 | 180 | 270) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 개구부 부착 모드 — canvas 캡처 단계에서 직접 레이캐스트 (벽 stopPropagation 우회).
  // 바닥(y=0) 평면과의 교점을 구해 가장 가까운 모듈 벽면에 스냅한다.
  useEffect(() => {
    if (!pendingOpeningType) { setAttachHover(null); return; }
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
      const face = pickWallFace(ray, pendingOpeningType);
      if (face) return face;
      // 2) 폴백: 바닥(y=0) 교점 근처 벽면 (탑뷰/바닥 클릭)
      if (!ray.ray.intersectPlane(ground, hitPt)) return null;
      return findWallAttach(hitPt.x, hitPt.z, pendingOpeningType);
    };

    const onMove = (ev: PointerEvent) => { setAttachHover(pick(ev)); };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const hit = pick(ev);
      if (!hit) return; // 벽 근처 아님 — 이벤트 통과(카메라 등 정상 동작)
      // 캡처 단계에서 소비 — 벽/바닥 선택 등 r3f 핸들러로 전달 차단
      ev.stopPropagation();
      ev.preventDefault();
      const st = useSpaceModuleStore.getState();
      const d = OPENING_DEFAULTS[pendingOpeningType];
      st.addOpening(hit.moduleId, {
        side: hit.side, type: pendingOpeningType,
        offset: hit.offset, width: d.width, height: d.height,
        ...(d.sill !== undefined ? { sill: d.sill } : {}),
      });
      st.setPendingOpeningType(null);
      setAttachHover(null);
    };

    el.addEventListener('pointermove', onMove, { capture: true });
    el.addEventListener('pointerdown', onDown, { capture: true });
    return () => {
      el.removeEventListener('pointermove', onMove, { capture: true });
      el.removeEventListener('pointerdown', onDown, { capture: true });
    };
  }, [pendingOpeningType, camera, gl]);

  return (
    <group>
      <OpeningMarkers />
      {/* 개구부 부착 미리보기 — 이벤트는 아래 캡처 리스너(useEffect)가 처리 (벽/바닥
          메시의 stopPropagation 에 막히지 않도록 r3f 이벤트를 우회) */}
      {pendingOpeningType && attachHover && (() => {
        const d = OPENING_DEFAULTS[pendingOpeningType];
        const y = (pendingOpeningType === 'window' ? (d.sill ?? 0.9) : 0) + d.height / 2;
        return (
          <mesh position={[attachHover.x, y, attachHover.z]} rotation={[0, attachHover.rotY, 0]}>
            <boxGeometry args={[d.width, d.height, 0.1]} />
            <meshBasicMaterial color="#a78bfa" transparent opacity={0.5} depthWrite={false} />
          </mesh>
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
                { const st = useSpaceModuleStore.getState(); if (st.pendingKind || st.pendingOpeningType) return; }
                e.stopPropagation();
                useSpaceModuleStore.getState().select(m.id);
                // 드래그 시작 — 잡은 지점과 모듈 중심의 오프셋을 저장하고 포인터 캡처.
                dragRef.current = { id: m.id, offX: e.point.x - m.x, offZ: e.point.z - m.z };
                (e.target as Element).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e: ThreeEvent<PointerEvent>) => {
                { const st = useSpaceModuleStore.getState(); if (st.pendingKind || st.pendingOpeningType) return; }
                const d = dragRef.current;
                if (!d || d.id !== m.id) return;
                e.stopPropagation();
                const s = useSpaceModuleStore.getState();
                const cur = s.modules.find((mm) => mm.id === d.id);
                if (!cur) return;
                const x = e.point.x - d.offX;
                const z = e.point.z - d.offZ;
                const snap = computeModuleSnap(cur, x, z, s.modules);
                s.update(d.id, { x: x + snap.dx, z: z + snap.dz });
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
          </group>
        );
      })}
    </group>
  );
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
