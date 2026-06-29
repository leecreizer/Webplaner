import { useMemo } from 'react';
import { DoubleSide, Vector2, Vector3 } from 'three';
import { useMeshSelectionStore, meshKey } from '@/features/selection/meshSelectionStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { Space } from '@/domain/structures/Space';
import { polyGeometry, polyGeometryExtruded } from '@/engine/mesh/MeshGenerator';
import { useEditStore } from '@/features/editing/editStore';

const _csgEval = new Evaluator();

/**
 * Space의 바닥면을 그리는 r3f 컴포넌트.
 *
 * Unity의 `Floor` + `CeilingFloorBase.DirtyUpdate` + `MeshGenerator.GeneratePolyToMesh` 조합을
 * 단일 컴포넌트로 통합. `space.cornerPoints`를 Triangulator로 삼각분할.
 *
 * @param thickness 단차 내림 두께(m, Y 음의 방향 압출). 기본 0 (단면).
 *   단면이어도 material의 `shadowSide=DoubleSide` + `castShadow` 조합으로 양방향에서
 *   shadow map에 잡혀 빛이 투과되지 않는다.
 */
export function FloorView({
  space,
  thickness = 0,
  color = '#ffffff',
}: {
  space: Space;
  thickness?: number;
  color?: string;
}) {
  // editStore.operations를 ref-stable하게 구독 후 useMemo로 floor만 필터 (무한 루프 방지)
  const allEditOps = useEditStore((s) => s.operations);
  const floorOps = useMemo(
    () => allEditOps.filter((o) => o.targetKind === 'floor' && o.ownerId === space.spaceIndex),
    [allEditOps, space.spaceIndex],
  );

  // mesh 선택 + 사용자 material override + visibility
  const myKey = meshKey('floor', space.spaceIndex);
  const visible = useVisibilityStore((s) => !s.hidden[myKey]);
  const selected = useMeshSelectionStore((s) => s.selectedMeshKeys.includes(myKey));
  const override = useMeshSelectionStore((s) => s.materials[myKey]);
  const selectMesh = useMeshSelectionStore((s) => s.selectMesh);
  const effectiveColor = override?.color ?? color;
  const effectiveRoughness = override?.roughness ?? 0.95;
  const effectiveMetalness = override?.metalness ?? 0.0;
  const effectiveOpacity = override?.opacity ?? 1.0;

  const geometry = useMemo(() => {
    const pts = space.cornerPoints;
    if (pts.length < 3) return null;
    const origin = new Vector3(0, Space.DEFAULT_FLOOR_HEIGHT + thickness, 0);
    const base =
      thickness === 0
        ? polyGeometry(pts as Vector2[], origin, new Vector3(0, 0, 1), false)
        : polyGeometryExtruded(pts as Vector2[], origin, new Vector3(0, 0, 1), thickness, false);
    if (!base || floorOps.length === 0) return base;
    // floor mesh는 group transform 없이 world 좌표 그대로 — brush들도 world 좌표라 단순 평가
    try {
      let result = new Brush(base);
      result.updateMatrixWorld();
      for (const op of floorOps) {
        const tool = new Brush(op.boxGeometry.clone());
        tool.updateMatrixWorld();
        const next = _csgEval.evaluate(
          result,
          tool,
          op.kind === 'cut' ? SUBTRACTION : ADDITION,
        );
        result = next;
      }
      return result.geometry;
    } catch (e) {
      console.warn('[FloorView] CSG 평가 실패', e);
      return base;
    }
  }, [space.cornerPoints, thickness, floorOps]);

  if (geometry === null || !visible) return null;

  return (
    <group>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        userData={{ editKind: 'floor', editOwnerId: space.spaceIndex }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          selectMesh(myKey, e.shiftKey);
        }}
      >
        <meshStandardMaterial
          color={effectiveColor}
          roughness={effectiveRoughness}
          metalness={effectiveMetalness}
          opacity={effectiveOpacity}
          transparent={effectiveOpacity < 1}
          emissive={override?.emissive ?? '#000000'}
          emissiveIntensity={override?.emissiveIntensity ?? 0}
          side={DoubleSide}
          shadowSide={DoubleSide}
        />
      </mesh>
      {/* 선택 시 시안색 가장자리 라인 — depthTest=false 로 다른 mesh 뒤에 있어도 보임 */}
      {selected && (
        <lineSegments renderOrder={999}>
          <edgesGeometry args={[geometry, 1]} />
          <lineBasicMaterial color="#22d3ee" depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      )}
    </group>
  );
}
