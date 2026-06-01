import { useMemo } from 'react';
import { Vector2 } from 'three';
import { AccumulativeShadows, RandomizedLight } from '@react-three/drei';
import { useLayoutStore } from '@/domain/state/layoutStore';
import { useLightingStore, sphericalToCartesian } from '@/engine/stores/lightingStore';

/**
 * 공간이 하나라도 만들어졌을 때 그 영역에 **점진적 베이크 라이트맵**을 적용한다.
 *
 * - `<AccumulativeShadows>` (drei) — `RandomizedLight` 다수의 그림자를 카메라 정지 동안 점진적으로
 *   누적해 *라이트맵 텍스처*를 실시간 베이크. 카메라 정지 시 점점 진해지고, 카메라 이동/조명 변경 시
 *   자동 reset 후 재누적.
 * - 광원 방향은 `lightingStore`의 directional light (azimuth/elevation/distance) 그대로 따라간다.
 * - 공간 합산 영역을 cover하는 ground plane으로 동작. 노드 좌표 bounding box로 크기와 위치 결정.
 */
export function SpaceLightmap() {
  const spaces = useLayoutStore((s) => s.spaces);
  const nodes = useLayoutStore((s) => s.nodes);
  const azimuth = useLightingStore((s) => s.azimuth);
  const elevation = useLightingStore((s) => s.elevation);
  const distance = useLightingStore((s) => s.distance);
  const intensity = useLightingStore((s) => s.intensity);
  const shadowStrength = useLightingStore((s) => s.shadowStrength);
  const lightmapEnabled = useLightingStore((s) => s.lightmapEnabled);

  // 라이트맵 plane의 중심/크기 — 모든 *space cornerPoints*(wall 두께 보정된 정확한 floor 좌표)
  // 의 bounding box를 사용. 이전엔 노드 좌표(wall 중심)를 써서 wall 두께만큼 plane이 안쪽으로
  // 들어와 wall 옆에 plane 가장자리가 노출되던 오프셋 버그가 있었다. 추가로 wall 외곽까지
  // 충분히 덮도록 +4m 여유.
  const { center, size } = useMemo(() => {
    if (spaces.length === 0) return { center: new Vector2(), size: 0 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const sp of spaces) {
      for (const p of sp.cornerPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minZ) minZ = p.y;
        if (p.y > maxZ) maxZ = p.y;
      }
    }
    // fallback: cornerPoints 비어있으면 nodes로
    if (!isFinite(minX)) {
      for (const n of nodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.x > maxX) maxX = n.position.x;
        if (n.position.z < minZ) minZ = n.position.z;
        if (n.position.z > maxZ) maxZ = n.position.z;
      }
    }
    if (!isFinite(minX)) return { center: new Vector2(), size: 0 };
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const sx = maxX - minX;
    const sz = maxZ - minZ;
    return {
      center: new Vector2(cx, cz),
      // bbox보다 충분히 크게 — wall 외곽 + 그림자 fade 영역까지 덮음
      size: Math.max(sx, sz) + 4,
    };
  }, [spaces, nodes]);

  if (!lightmapEnabled || spaces.length === 0 || size <= 0) return null;

  const [lx, ly, lz] = sphericalToCartesian(azimuth, elevation, distance);
  // 광원 변경/위치 이동 시 강제 remount해 누적 재시작
  const remountKey = `${azimuth}-${elevation}-${distance}-${spaces.length}-${nodes.length}`;

  return (
    <AccumulativeShadows
      key={remountKey}
      // floor와 정확히 같은 y=0 — z-fighting은 alphaTest로 처리, 따로 위로 띄우면 wall 안쪽
      // 가장자리 오프셋이 시각적으로 노출된다.
      position={[center.x, 0, center.y]}
      scale={size}
      temporal
      // 누적 프레임 수 ↑ — GI처럼 더 부드러운 음영
      frames={100}
      blend={60}
      alphaTest={0.8}
      opacity={Math.max(0.25, shadowStrength)}
      color="#000000"
    >
      {/* RandomizedLight 다수로 면광원처럼 — soft + indirect 느낌의 GI 시뮬 */}
      <RandomizedLight
        amount={12}
        radius={2.5}
        ambient={0.7}
        intensity={Math.max(0.6, intensity)}
        position={[lx, ly, lz]}
        bias={-0.001}
      />
    </AccumulativeShadows>
  );
}
