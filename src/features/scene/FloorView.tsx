import { useMemo } from 'react';
import { Vector2, Vector3 } from 'three';
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
 * @param thickness 바닥 두께(m, Y 음의 방향 압출). 기본 0.05 — 단면 메시면 빛이 투과해
 *   실내 그림자가 형성되지 않으므로 항상 두께를 가진 박스로 만든다. 윗면 좌표는
 *   `DEFAULT_FLOOR_HEIGHT`로 유지되고 아래로만 두꺼워진다.
 */
export function FloorView({
  space,
  thickness = 0.05,
  color = '#e0d6c4',
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

  const geometry = useMemo(() => {
    const pts = space.cornerPoints;
    if (pts.length < 3) return null;
    // 윗면 좌표가 DEFAULT_FLOOR_HEIGHT, 아래로 thickness 만큼 압출
    const origin = new Vector3(0, Space.DEFAULT_FLOOR_HEIGHT, 0);
    const base =
      thickness <= 0
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

  if (geometry === null) return null;

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      userData={{ editKind: 'floor', editOwnerId: space.spaceIndex }}
    >
      <meshStandardMaterial color={color} roughness={0.95} metalness={0.0} />
    </mesh>
  );
}
