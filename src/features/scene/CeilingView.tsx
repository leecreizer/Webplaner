import { useMemo } from 'react';
import { Vector2, Vector3 } from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { Space } from '@/domain/structures/Space';
import { polyGeometry, polyGeometryExtruded } from '@/engine/mesh/MeshGenerator';
import { useEditStore } from '@/features/editing/editStore';

const _csgEval = new Evaluator();

/**
 * Space의 천장면을 그리는 r3f 컴포넌트.
 *
 * Unity의 `Ceiling.GeneratePolyToMesh` 동작과 동일 — thickness ≤ 0이면 winding 반전.
 *
 * Floor와 달리 위치를 `DEFAULT_CEILING_HEIGHT`로 끌어올린다.
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

  const geometry = useMemo(() => {
    const pts = space.cornerPoints;
    if (pts.length < 3) return null;
    const origin = new Vector3(0, Space.DEFAULT_CEILING_HEIGHT, 0);
    // Unity `Ceiling.GeneratePolyToMesh`: thickness ≤ 0 → reverse=true
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

  if (geometry === null) return null;

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      userData={{ editKind: 'ceiling', editOwnerId: space.spaceIndex }}
    >
      <meshStandardMaterial color={color} roughness={0.9} metalness={0.0} />
    </mesh>
  );
}