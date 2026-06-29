import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box3, DoubleSide, Mesh, Object3D, Vector3 } from 'three';
import { Edges, TransformControls, useGLTF } from '@react-three/drei';
import { HelperScaler, isHelperRegionName, replaceableSizeOf, pickReplaceableSize } from '@/domain/products/HelperScaler';
import { usePlacedProductStore, type PendingProduct, type PlacedProduct } from './placedProductStore';

const M = 1 / 1000; // mm → m

/** 모델 로드 실패 시 박스로 폴백 */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** 배치 박스(모델 없을 때 / 폴백) — 그룹 로컬 좌표 기준 */
function BoxMesh({ p, sel }: { p: PlacedProduct; sel: boolean }) {
  return (
    <mesh position={[0, ((p.lift ?? 0) + p.h / 2) * M, 0]} castShadow receiveShadow>
      <boxGeometry args={[p.w * M, p.h * M, p.d * M]} />
      <meshStandardMaterial color={sel ? '#b98a3e' : '#c9a063'} roughness={0.6} />
      {sel && <Edges scale={1.001} threshold={15} color="#22d3ee" />}
    </mesh>
  );
}

/**
 * 등록된 모델(GLB)을 컨텐츠 W/D/H에 맞춰 표시.
 *
 * helper(L/R/T/B/F/K) 영역이 있는 모델은 **helper 기반 정점 스트레치**로 좌우/상하/앞뒤 패널만
 * 이동시켜 형태·텍스처를 보존한다(통짜 스케일 금지). helper가 없는 모델은 기존처럼 균등 스케일 폴백.
 */
function FittedModel({ url, p, sel }: { url: string; p: PlacedProduct; sel: boolean }) {
  const { scene } = useGLTF(url);
  const { obj, scale, pos } = useMemo(() => {
    // useGLTF 공유 geometry 보호 — 인스턴스 전용 deep clone 후 변형.
    const clone = scene.clone(true);
    clone.traverse((o) => {
      if (o instanceof Mesh) o.geometry = o.geometry.clone();
    });

    const scaler = HelperScaler.build(clone);
    const useHelper = scaler.regionCount > 0;
    if (typeof window !== 'undefined' && (window as unknown as { __HELPER_DEBUG__?: boolean }).__HELPER_DEBUG__) {
      const names: string[] = [];
      clone.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) names.push(o.name || '(unnamed)'); });
      // eslint-disable-next-line no-console
      console.log('[FittedModel] regionCount=', scaler.regionCount, 'useHelper=', useHelper, 'meshes=', names, scaler.getDiagnostics());
    }
    // 목표 치수(m, y-up): x=폭(w), y=높이(h), z=깊이(d)
    if (useHelper) scaler.applyResize(new Vector3(p.w * M, p.h * M, p.d * M));

    // replaceable 구성품: 입력 폭(p.w)과 같은(또는 구간) 사이즈 명칭만 노출.
    const sizes = new Set<number>();
    clone.traverse((o) => {
      const s = replaceableSizeOf(o.name);
      if (s != null) sizes.add(s);
    });
    const chosenSize = pickReplaceableSize(sizes, p.w);

    // 보조 메시 렌더 처리.
    clone.traverse((o) => {
      const n = o.name.toLowerCase();
      const size = replaceableSizeOf(o.name);
      if (size != null) {
        o.visible = size === chosenSize; // 선택된 사이즈 구성품만 노출
      } else if (isHelperRegionName(o.name) || n === 'helper' || n === 'hotspot' || n.startsWith('replaceable')) {
        o.visible = false; // helper 영역/보조 노드 숨김
      }
    });

    clone.updateMatrixWorld(true);
    // 센터/바닥 정렬용 bbox는 몸통(변형 대상) 메시만으로 계산.
    // (Box3.setFromObject는 visible=false인 helper/replaceable 메시도 포함하므로 직접 순회)
    const box = new Box3();
    clone.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh && !isHelperRegionName(o.name) && replaceableSizeOf(o.name) == null) {
        box.expandByObject(o);
      }
    });
    const size = new Vector3(); box.getSize(size);
    const center = new Vector3(); box.getCenter(center);
    if (typeof window !== 'undefined' && (window as unknown as { __HELPER_DEBUG__?: boolean }).__HELPER_DEBUG__) {
      // eslint-disable-next-line no-console
      console.log('[FittedModel] 몸통 size(m)=', size.toArray().map((v) => +v.toFixed(3)),
        '입력 p(m)=', [p.w * M, p.h * M, p.d * M].map((v) => +v.toFixed(3)),
        'min/max=', box.min.toArray().map((v) => +v.toFixed(3)), box.max.toArray().map((v) => +v.toFixed(3)));
    }

    if (useHelper) {
      // 이미 정점이 목표 치수로 변형됨 → 스케일 없이 중심/바닥 정렬만.
      return {
        obj: clone,
        scale: [1, 1, 1] as [number, number, number],
        pos: [-center.x, (p.lift ?? 0) * M - box.min.y, -center.z] as [number, number, number],
      };
    }
    // helper 없는 모델: 기존 균등 스케일 폴백.
    const sx = (p.w * M) / (size.x || 1);
    const sy = (p.h * M) / (size.y || 1);
    const sz = (p.d * M) / (size.z || 1);
    return {
      obj: clone,
      scale: [sx, sy, sz] as [number, number, number],
      pos: [-center.x * sx, (p.lift ?? 0) * M - box.min.y * sy, -center.z * sz] as [number, number, number],
    };
  }, [scene, p.w, p.d, p.h, p.lift]);
  return (
    <group>
      <primitive object={obj} scale={scale} position={pos} />
      {sel && (
        <mesh position={[0, ((p.lift ?? 0) + p.h / 2) * M, 0]}>
          <boxGeometry args={[p.w * M, p.h * M, p.d * M]} />
          <meshBasicMaterial visible={false} />
          <Edges scale={1.001} threshold={15} color="#22d3ee" />
        </mesh>
      )}
    </group>
  );
}

/** 배치 아이템 — 모델 있으면 모델, 없으면 박스 */
function PlacedItem({ p, sel, onDown }: { p: PlacedProduct; sel: boolean; onDown: (id: string, code: string | undefined, name: string, shift: boolean) => void }) {
  return (
    <group
      position={[p.x, 0, p.z]}
      rotation={[0, (p.ry * Math.PI) / 180, 0]}
      onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onDown(p.id, p.code, p.name, e.nativeEvent.shiftKey); }}
    >
      {p.modelUrl ? (
        <ModelErrorBoundary fallback={<BoxMesh p={p} sel={sel} />}>
          <Suspense fallback={<BoxMesh p={p} sel={sel} />}>
            <FittedModel url={p.modelUrl} p={p} sel={sel} />
          </Suspense>
        </ModelErrorBoundary>
      ) : (
        <BoxMesh p={p} sel={sel} />
      )}
    </group>
  );
}

/**
 * 상품 클릭 배치 (호스트 어드민 ↔ 웹플래너 연동).
 *
 * - 호스트가 `postMessage({ type:'hp3:place-product', name, code, w, d, h })` 보내면 배치 모드 진입
 * - 배치 모드: 바닥(y=0) 위 포인터를 따라다니는 반투명 고스트 박스 표시 (상품 치수 = w×d×h mm)
 * - 좌클릭: 해당 위치에 박스 배치 / Esc·우클릭: 취소
 * - 치수는 mm → m(/1000) 변환, 박스는 바닥에 올려둠(y = h/2)
 */
export function ProductPlacement() {
  const pending = usePlacedProductStore((s) => s.pending);
  const placed = usePlacedProductStore((s) => s.placed);
  const place = usePlacedProductStore((s) => s.place);
  const setPending = usePlacedProductStore((s) => s.setPending);
  const cancel = usePlacedProductStore((s) => s.cancel);
  const selectedIds = usePlacedProductStore((s) => s.selectedIds);
  const select = usePlacedProductStore((s) => s.select);
  const update = usePlacedProductStore((s) => s.update);
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
  /** 선택 박스들의 중심 피벗(보이지 않음) — 기즈모를 여기 붙여 다중 이동/회전 */
  const [pivotObj, setPivotObj] = useState<Object3D | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tcRef = useRef<any>(null); // TransformControls 인스턴스 — 핸들 위면 .axis 설정됨
  const lastPivot = useRef<{ x: number; z: number; ry: number }>({ x: 0, z: 0, ry: 0 });
  const selectedSet = new Set(selectedIds);

  // 선택이 바뀌면 피벗을 선택 박스들의 중심으로 재배치 (회전 0)
  useEffect(() => {
    if (!pivotObj || selectedIds.length === 0) return;
    const boxes = usePlacedProductStore.getState().placed.filter((p) => selectedIds.includes(p.id));
    if (boxes.length === 0) return;
    const cx = boxes.reduce((s, b) => s + b.x, 0) / boxes.length;
    const cz = boxes.reduce((s, b) => s + b.z, 0) / boxes.length;
    pivotObj.position.set(cx, 0, cz);
    pivotObj.rotation.set(0, 0, 0);
    lastPivot.current = { x: cx, z: cz, ry: 0 };
  }, [pivotObj, selectedIds]);

  // 박스 클릭 선택 (Shift = 다중 토글), 호스트에 선택 정보 전송
  const onBoxDown = (id: string, code: string | undefined, name: string, shift: boolean) => {
    select(id, shift);
    const ids = usePlacedProductStore.getState().selectedIds;
    if (ids.length <= 1) window.parent?.postMessage({ type: 'hp3:selected', code, name }, '*');
    else window.parent?.postMessage({ type: 'hp3:selected', code, name, count: ids.length }, '*');
  };

  // 기즈모 변경 → 선택 박스 전체에 이동/회전 델타 적용
  const onPivotChange = () => {
    if (!pivotObj) return;
    const px = pivotObj.position.x, pz = pivotObj.position.z, pry = pivotObj.rotation.y;
    const last = lastPivot.current;
    const dx = px - last.x, dz = pz - last.z, dRy = pry - last.ry;
    const st = usePlacedProductStore.getState();
    if (gizmoMode === 'translate' && (dx || dz)) {
      for (const b of st.placed) if (selectedSet.has(b.id)) update(b.id, { x: b.x + dx, z: b.z + dz });
    } else if (gizmoMode === 'rotate' && dRy) {
      const cx = last.x, cz = last.z, cos = Math.cos(dRy), sin = Math.sin(dRy);
      for (const b of st.placed) if (selectedSet.has(b.id)) {
        const rx = b.x - cx, rz = b.z - cz;
        update(b.id, { x: cx + rx * cos - rz * sin, z: cz + rx * sin + rz * cos, ry: b.ry + (dRy * 180) / Math.PI });
      }
    }
    lastPivot.current = { x: px, z: pz, ry: pry };
  };

  // 배치 목록이 바뀌면 호스트(어드민)로 전송 → 견적보기 등에서 사용
  useEffect(() => {
    const items = placed.map((p) => ({ id: p.id, code: p.code, name: p.name, w: p.w, d: p.d, h: p.h, lift: p.lift ?? 0 }));
    window.parent?.postMessage({ type: 'hp3:scene', count: placed.length, items }, '*');
  }, [placed]);

  // 기즈모 모드 단축키: G/T=이동, R=회전
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') setGizmoMode('rotate');
      if (e.key === 'g' || e.key === 'G' || e.key === 't' || e.key === 'T') setGizmoMode('translate');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 호스트 메시지 수신 → 배치 모드 진입
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string } & Partial<PendingProduct>;
      if (d && d.type === 'hp3:place-product') {
        setPending({ name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0, modelUrl: d.modelUrl });
      }
      if (d && d.type === 'hp3:update-product') {
        // 선택된 배치 컨텐츠의 치수/배치높이를 그 자리에서 수정 (새 배치 아님)
        const st = usePlacedProductStore.getState();
        // 선택이 없으면 마지막 배치 박스에 적용 (배치 직후 선택이 풀린 경우 대비)
        const targets = st.selectedIds.length > 0
          ? st.selectedIds
          : (st.placed.length ? [st.placed[st.placed.length - 1].id] : []);
        if (targets.length === 0) return;
        const patch: Partial<PendingProduct> = {};
        if (d.w != null) patch.w = d.w;
        if (d.d != null) patch.d = d.d;
        if (d.h != null) patch.h = d.h;
        if (d.lift != null) patch.lift = d.lift;
        if (d.code != null) patch.code = d.code;
        if (d.name != null) patch.name = d.name;
        if (d.modelUrl != null) patch.modelUrl = d.modelUrl;
        for (const id of targets) st.update(id, patch);
        return;
      }
      if (d && d.type === 'hp3:attach-doors') {
        // 선택된 몸통에 DP 매칭 도어들을 POS(L/R)에 자동 배치 (시뮬레이션: 박스)
        const ad = e.data as { bodyW?: number; bodyD?: number; bodyH?: number; doors?: { code?: string; name?: string; w?: number; d?: number; h?: number; pos?: string; modelUrl?: string }[] };
        const st = usePlacedProductStore.getState();
        const bodyId = st.selectedIds[0] ?? (st.placed.length ? st.placed[st.placed.length - 1].id : null);
        const body = st.placed.find((p) => p.id === bodyId);
        if (!body || !ad.doors?.length) return;
        const bw = (ad.bodyW || body.w) * M;
        const bd = (ad.bodyD || body.d) * M;
        // 좌/우 도어 개수 분배 → 몸통 폭 안에서 배치
        ad.doors.forEach((dr, i) => {
          const pos = (dr.pos || (i % 2 === 0 ? 'L' : 'R')).toUpperCase();
          const side = pos.startsWith('R') ? 1 : -1;          // L=-1, R=+1
          const dx = side * bw / 4;                            // 몸통 폭의 1/4 지점
          const dz = bd / 2;                                   // 몸통 앞면
          st.placeAt({
            name: dr.name ?? '도어', code: dr.code, w: dr.w || 600, d: dr.d || 30, h: dr.h || body.h, lift: body.lift ?? 0, modelUrl: dr.modelUrl,
          }, body.x + dx, body.z + dz, body.ry);
        });
        return;
      }
      if (d && d.type === 'hp3:swap-product') {
        // 선택된 배치 상품이 있으면 그 자리에서 교체, 없으면 새 배치 대기
        const st = usePlacedProductStore.getState();
        if (st.selectedId) {
          st.update(st.selectedId, { name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0 });
        } else {
          setPending({ name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0 });
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [setPending]);

  // Esc 취소
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancel]);

  return (
    <>
      {/* 배치된 상품 — 모델 등록 시 GLB, 없으면 박스. 빈 곳 클릭 해제는 Canvas onPointerMissed에서 처리 */}
      {placed.map((p) => (
        <PlacedItem key={p.id} p={p} sel={selectedSet.has(p.id)} onDown={onBoxDown} />
      ))}

      {/* 선택 중심 피벗 + 기즈모 — 다중 선택 시 전체 이동/회전 (G=이동, R=회전) */}
      <object3D ref={setPivotObj} />
      {selectedIds.length > 0 && pivotObj && (
        <TransformControls
          ref={tcRef}
          key={`gizmo-${selectedIds.join(',')}-${gizmoMode}`}
          object={pivotObj}
          mode={gizmoMode}
          showX={gizmoMode === 'translate'}
          showZ={gizmoMode === 'translate'}
          showY={gizmoMode === 'rotate'}
          onObjectChange={onPivotChange}
        />
      )}

      {/* 배치 모드: 바닥 인터랙션 평면 + 고스트 박스 */}
      {pending && (
        <>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            // 바닥 평면보다 살짝 위 — 레이캐스트가 이 평면을 먼저 맞춰 다른 메쉬의
            // 선택 핸들러가 pointerdown을 가로채지 못하게 함 (배치 우선)
            position={[0, 0.05, 0]}
            renderOrder={999}
            onPointerMove={(e) => { e.stopPropagation(); setGhost([e.point.x, e.point.z]); }}
            onPointerDown={(e) => {
              if (e.button === 2) { cancel(); setGhost(null); return; } // 우클릭 취소
              if (e.button !== 0) return;
              e.stopPropagation();
              place(e.point.x, e.point.z);
              setGhost(null);
            }}
          >
            <planeGeometry args={[400, 400]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
          </mesh>
          {ghost && (() => {
            const gp: PlacedProduct = { ...pending, id: 'ghost', x: ghost[0], z: ghost[1], ry: 0 };
            const ghostBox = (
              <mesh position={[0, ((pending.lift ?? 0) + pending.h / 2) * M, 0]}>
                <boxGeometry args={[pending.w * M, pending.h * M, pending.d * M]} />
                <meshStandardMaterial color="#4a90d9" transparent opacity={0.45} depthWrite={false} />
              </mesh>
            );
            return (
              <group position={[ghost[0], 0, ghost[1]]}>
                {pending.modelUrl ? (
                  <ModelErrorBoundary fallback={ghostBox}>
                    <Suspense fallback={ghostBox}>
                      <FittedModel url={pending.modelUrl} p={gp} sel={false} />
                    </Suspense>
                  </ModelErrorBoundary>
                ) : ghostBox}
              </group>
            );
          })()}
        </>
      )}
    </>
  );
}