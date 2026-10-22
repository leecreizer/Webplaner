import { useMemo } from 'react';
import { DoubleSide, Vector2, Vector3 } from 'three';
import { useMeshSelectionStore, meshKey } from '@/features/selection/meshSelectionStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { Space } from '@/domain/structures/Space';
import { polyGeometry, polyGeometryExtruded } from '@/engine/mesh/MeshGenerator';
import { useEditStore } from '@/features/editing/editStore';
import { isGizmoBusy } from '@/features/models/gizmoGuard';

const _csgEval = new Evaluator();

/**
 * Space의 천장면을 그리는 r3f 컴포넌트.
 *
 * Unity의 `Ceiling.GeneratePolyToMesh` 동작과 동일 — thickness ≤ 0이면 winding 반전.
 *
 * Floor와 달리 위치를 `DEFAULT_CEILING_HEIGHT`로 끌어올린다.
 *
 * @param thickness 천장 두께(m). 기본 0 (단면). 단면이어도 material의 `shadowSide=DoubleSide`
 *   + `castShadow` 조합으로 양방향에서 shadow map에 잡혀 빛이 투과되지 않는다.
 */
export function CeilingView({
  space,
  thickness = 0,
  color = '#ffffff',
}: {
  space: Space;
  thickness?: number;
  color?: string;
}) {
  const allEditOps = useEditStore((s) => s.operations);
  const ceilingOps = useMemo(
    () => allEditOps.filter((o) => o.targetKind === 'ceiling' && o.ownerId === space.spaceIndex),
    [allEditOps, space.spaceIndex],
  );

  const myKey = meshKey('ceiling', space.spaceIndex);
  const visible = useVisibilityStore((s) => !s.hidden[myKey] && !s.removed[myKey]);
  const selected = useMeshSelectionStore((s) => s.selectedMeshKeys.includes(myKey));
  const override = useMeshSelectionStore((s) => s.materials[myKey]);
  const selectMesh = useMeshSelectionStore((s) => s.selectMesh);
  const effectiveColor = override?.color ?? color;
  const effectiveRoughness = override?.roughness ?? 0.9;
  const effectiveMetalness = override?.metalness ?? 0.0;
  const effectiveOpacity = override?.opacity ?? 1.0;

  const geometry = useMemo(() => {
    const pts = space.cornerPoints;
    if (pts.length < 3) return null;
    const origin = new Vector3(0, Space.DEFAULT_CEILING_HEIGHT, 0);
    // Unity `Ceiling.GeneratePolyToMesh`: thickness ≤ 0 → reverse=true (단면 normal이 실내 아래로)
    const reverse = thickness <= 0;
    const base =
      thickness === 0
        ? polyGeometry(pts as Vector2[], origin, new Vector3(0, 0, 1), reverse)
        : polyGeometryExtruded(pts as Vector2[], origin, new Vector3(0, 0, 1), thickness, reverse);
    if (!base || ceilingOps.length === 0) return base;
    try {
      let result = new Brush(base);
      result.updateMatrixWorld();
      for (const op of ceilingOps) {
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
      console.warn('[CeilingView] CSG 평가 실패', e);
      return base;
    }
  }, [space.cornerPoints, thickness, ceilingOps]);

  if (geometry === null || !visible) return null;

  return (
    <group>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        userData={{ editKind: 'ceiling', editOwnerId: space.spaceIndex }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // 기즈모 핸들 조작 중이면 선택 가로채기 금지 (핸들 뒤 메시 오선택 방지)
          if (isGizmoBusy()) return;
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
      {selected && (
        <lineSegments renderOrder={999}>
          <edgesGeometry args={[geometry, 1]} />
          <lineBasicMaterial color="#22d3ee" depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      )}
    </group>
  );
}