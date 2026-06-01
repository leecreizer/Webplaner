import { useEffect, useMemo, useRef } from 'react';
import { Mesh, Group, Vector3, BufferGeometry, BufferAttribute, Euler } from 'three';
import { TransformControls } from '@react-three/drei';
import { useLightingStore, sphericalToCartesian } from '@/engine/stores/lightingStore';

/**
 * 화면 상에 빛 위치를 sphere로 표시하고 TransformControls로 드래그/회전 조작할 수 있게 한다.
 *
 * ### 구조
 * 원점에 `pivot` 그룹을 두고 그 자식으로 sphere를 `[0, 0, distance]` 로컬 좌표에 배치. pivot의
 * 회전 (`-elevation`, `azimuth`, 0, YXZ)을 적용하면 sphere 월드 위치는
 * `sphericalToCartesian(az, el, dist)` 와 정확히 일치한다.
 *
 * ### 모드
 * - **translate**: sphere를 직접 드래그 → world position 갱신 → store(az/el/dist) 역계산
 * - **rotate**: pivot 그룹을 회전 → sphere world position 갱신 → store 역계산 (distance 유지)
 *
 * 외부 store → mesh 동기화는 `useEffect` 로, mesh → store는 TransformControls `onObjectChange`로.
 * `useLightingStore.showLightGizmo`로 표시 토글, `lightGizmoMode`로 이동/회전 모드 토글.
 */
export function SunGizmo() {
  const show = useLightingStore((s) => s.showLightGizmo);
  const mode = useLightingStore((s) => s.lightGizmoMode);
  const azimuth = useLightingStore((s) => s.azimuth);
  const elevation = useLightingStore((s) => s.elevation);
  const distance = useLightingStore((s) => s.distance);

  const pivotRef = useRef<Group>(null);
  const sphereRef = useRef<Mesh>(null);
  const guideRef = useRef<BufferGeometry | null>(null);

  // store → 기즈모 동기화 (스토어 변경 시 pivot 회전 + sphere 로컬 위치 재설정)
  useEffect(() => {
    if (!pivotRef.current || !sphereRef.current) return;
    const azRad = (azimuth * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    pivotRef.current.rotation.set(0, 0, 0);
    pivotRef.current.rotation.copy(new Euler(-elRad, azRad, 0, 'YXZ'));
    sphereRef.current.position.set(0, 0, distance);
    sphereRef.current.rotation.set(0, 0, 0);
    updateGuide();
  }, [azimuth, elevation, distance]);

  // 원점 → 현재 sphere world position 가이드 라인
  const guideGeometry = useMemo(() => {
    const g = new BufferGeometry();
    const [x, y, z] = sphericalToCartesian(azimuth, elevation, distance);
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, x, y, z]), 3));
    guideRef.current = g;
    return g;
    // 마운트 시 1회 — 이후 updateGuide() 로 in-place 갱신
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateGuide() {
    if (!sphereRef.current || !guideRef.current) return;
    const p = sphereRef.current.getWorldPosition(new Vector3());
    const arr = (guideRef.current.attributes.position as BufferAttribute).array as Float32Array;
    arr[3] = p.x;
    arr[4] = p.y;
    arr[5] = p.z;
    (guideRef.current.attributes.position as BufferAttribute).needsUpdate = true;
  }

  function handleChange() {
    if (!sphereRef.current) return;
    const p = sphereRef.current.getWorldPosition(new Vector3());
    const newDist = Math.hypot(p.x, p.y, p.z);
    if (newDist < 0.01) return;
    const horizontal = Math.hypot(p.x, p.z);
    const newEl = (Math.atan2(p.y, horizontal) * 180) / Math.PI;
    const newAz = (Math.atan2(p.x, p.z) * 180) / Math.PI;
    const store = useLightingStore.getState();
    store.setAzimuth(newAz);
    store.setElevation(Math.max(0, Math.min(90, newEl)));
    store.setDistance(Math.max(5, Math.min(50, newDist)));
    updateGuide();
  }

  if (!show) return null;

  return (
    <group>
      {/* 원점 ↔ 빛 위치 가이드 라인 (월드 좌표) */}
      <line>
        <primitive object={guideGeometry} attach="geometry" />
        <lineBasicMaterial color="#ffaa00" transparent opacity={0.6} depthTest={false} />
      </line>

      {/* 회전 피벗 — rotate 모드에서 이 그룹을 회전 */}
      <group ref={pivotRef}>
        {/* 빛 위치 표시 sphere — translate 모드에서 이 메쉬를 이동 */}
        <mesh
          ref={sphereRef}
          position={[0, 0, distance]}
          userData={{ isSunGizmo: true }}
        >
          <sphereGeometry args={[0.6, 24, 24]} />
          <meshBasicMaterial color="#fff176" transparent opacity={0.85} />
        </mesh>
      </group>

      {/* TransformControls — mode에 따라 sphere(이동) 또는 pivot(회전) 대상 변경 */}
      {mode === 'translate' && sphereRef.current && (
        <TransformControls
          object={sphereRef.current}
          mode="translate"
          size={0.8}
          onObjectChange={handleChange}
        />
      )}
      {mode === 'rotate' && pivotRef.current && (
        <TransformControls
          object={pivotRef.current}
          mode="rotate"
          size={1.2}
          onObjectChange={handleChange}
        />
      )}
    </group>
  );
}
