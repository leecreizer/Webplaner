import { Vector3 } from 'three';
import { Node } from '../structures/Node';
import { Wall } from '../structures/Wall';
import { useLayoutStore, layoutRegistry } from '../structures/state';
import { buildSpaces } from '../layout/SpaceBuilder';

/**
 * 데모용 샘플 평면도를 현재 Zustand 스토어에 주입한다.
 *
 * 6m × 4m 직사각형 + 가운데 분리벽 → 좌측 4m × 4m 거실 + 우측 2m × 4m 작은방 두 공간이
 * `SpaceBuilder`로 자동 검출된다.
 *
 * ```
 *   F(-3,2) -------- E(1,2) -------- D(3,2)
 *   |                |               |
 *   |    [거실]      | [작은방]      |
 *   |                |               |
 *   A(-3,-2) ------- B(1,-2) ------- C(3,-2)
 * ```
 *
 * `App.tsx`의 `demo` prop이 true일 때 useEffect에서 1회 호출된다.
 */
export function seedSampleRooms(): void {
  // 기존 도메인 상태 초기화
  useLayoutStore.getState().reset();

  // 6개 노드
  const A = Node.create(new Vector3(-3, 0, -2), layoutRegistry);
  const B = Node.create(new Vector3(1, 0, -2), layoutRegistry);
  const C = Node.create(new Vector3(3, 0, -2), layoutRegistry);
  const D = Node.create(new Vector3(3, 0, 2), layoutRegistry);
  const E = Node.create(new Vector3(1, 0, 2), layoutRegistry);
  const F = Node.create(new Vector3(-3, 0, 2), layoutRegistry);

  // 외벽 6개 (반시계 방향)
  Wall.create(A, B, layoutRegistry);
  Wall.create(B, C, layoutRegistry);
  Wall.create(C, D, layoutRegistry);
  Wall.create(D, E, layoutRegistry);
  Wall.create(E, F, layoutRegistry);
  Wall.create(F, A, layoutRegistry);

  // 분리벽 (B↔E) — 두 공간을 가른다
  Wall.create(B, E, layoutRegistry);

  // SpaceBuilder로 폐쇄 공간 자동 검출
  buildSpaces(useLayoutStore.getState().walls, layoutRegistry);

  // 각 공간의 cornerPoints/center/area를 명시적으로 계산 (FloorView/CeilingView가 즉시 그릴 수 있게)
  for (const space of useLayoutStore.getState().spaces) {
    space.invalidateCornerPoints();
    void space.cornerPoints;
    space.updateCenter();
    space.updateArea();
  }

  if (typeof console !== 'undefined') {
    const s = useLayoutStore.getState();
    console.info(
      `[sampleScene] seeded ${s.nodes.length} nodes, ${s.walls.length} walls, ${s.spaces.length} spaces`,
    );
    for (const sp of s.spaces) {
      console.info(`  Space ${sp.spaceIndex} "${sp.name}": area=${sp.area.toFixed(2)}m²`);
    }
  }
}