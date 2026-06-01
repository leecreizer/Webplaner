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
 *
 * @param thickness 천장 두께(m). 기본 0.05 — 단면 메시면 위에서 들어오는 빛이 그대로 실내로
 *   투과되므로 항상 두께를 가진 박스로 만든다. 실내에서 보이는 천장 아랫면 좌표는
 *   `DEFAULT_CEILING_HEIGHT`로 유지되고 위로만 두꺼워진다.
 */
export function CeilingView({
  space,
  thickness = 0.05,
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
    // 아랫면이 DEFAULT_CEILING_HEIGHT, 위로 thickness 만큼 압출되도록 origin을 올려둠
    const origin = new Vector3(0, Space.DEFAULT_CEILING_HEIGHT + Math.max(0, thickness), 0);
    // thickness ≤ 0 (단면)일 때만 reverse=true — 실내(아래)를 향하도록 winding 뒤집기.
    // thickness > 0 (extruded)이면 윗면/아랫면 다 있어 reverse 불필요.
    const reverse = thickness <= 0;
    const base =
      thickness <= 0
        ? polyGeometry(pts as Vector2[], origin, new Vector3(0, 0, 1), reverse)
        : polyGeometryExtruded(pts as Vector2[], origin, new Vector3(0, 0, 1), thickness, false);
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
      castShadow
      receiveShadow
      userData={{ editKind: 'ceiling', editOwnerId: space.spaceIndex }}
    >
      <meshStandardMaterial color={color} roughness={0.9} metalness={0.0} />
    </mesh>
  );
}