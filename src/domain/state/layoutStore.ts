import { create } from 'zustand';
import { Vector3 } from 'three';
import { Node, type NodeRegistry } from '@/domain/structures/Node';
import { Wall, type WallRegistry } from '@/domain/structures/Wall';
import type { Space, SpaceRegistry } from '@/domain/structures/Space';
import { EPSILON } from '@/lib/math/Math';
import { flatSqrDistance } from '@/lib/math/VectorExtensions';

/**
 * 평면도 도메인 전역 상태.
 *
 * Unity의 정적 컬렉션(`Node.AllNodes`, `Wall.AllWalls`, `Space.AllSpaces`)을 본 Zustand
 * 스토어로 대체했다. React UI/r3f 컴포넌트가 본 스토어를 구독하면 데이터 변경 시
 * 자동으로 리렌더링된다.
 *
 * `Node` / `Wall` 클래스는 본 스토어에 직접 의존하지 않고 `NodeRegistry`/`WallRegistry`
 * 인터페이스를 통해 작업한다. 본 파일이 두 인터페이스의 구현체를 제공한다.
 */
export interface LayoutState {
  // ===== 컬렉션 ============================================
  nodes: Node[];
  walls: Wall[];
  spaces: Space[];

  // ===== 인덱스 카운터 ====================================
  _nextNodeIdx: number;
  _nextWallIdx: number;
  _nextSpaceIdx: number;

  // ===== 컬렉션 변이 ======================================
  addNode(node: Node): void;
  removeNode(node: Node): void;
  addWall(wall: Wall): void;
  removeWall(wall: Wall): void;
  addSpace(space: Space): void;
  removeSpace(space: Space): void;

  // ===== 조회 헬퍼 ========================================
  findNodeByPosition(position: Vector3): Node | undefined;

  // ===== 카운터 발급 ======================================
  nextNodeIndex(): number;
  nextWallIndex(): number;
  nextSpaceIndex(): number;

  /** 모든 컬렉션 비우기 + 인덱스 카운터 리셋. 새 평면도 로드 시 사용. */
  reset(): void;
}

/**
 * 평면도 전역 상태 훅.
 *
 * @example UI 컴포넌트에서 구독
 * ```tsx
 * const nodes = useLayoutStore((s) => s.nodes);
 * return <>{nodes.map((n) => <NodeView key={n.nodeIndex} node={n} />)}</>;
 * ```
 *
 * @example 도메인 로직에서 직접 접근 (구독 없이)
 * ```ts
 * const wall = Wall.create(start, end, useLayoutStore.getState());
 * ```
 */
/** dev 모드 진단용으로 store를 window에 노출. production 빌드에서도 비용 없음. */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__layoutStore = useLayoutStore; }, 0);
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  nodes: [],
  walls: [],
  spaces: [],
  _nextNodeIdx: 0,
  _nextWallIdx: 0,
  _nextSpaceIdx: 0,

  addNode(node) {
    set((s) => ({ nodes: [...s.nodes, node] }));
  },

  removeNode(node) {
    set((s) => ({ nodes: s.nodes.filter((n) => n !== node) }));
  },

  addWall(wall) {
    set((s) => ({ walls: [...s.walls, wall] }));
  },

  removeWall(wall) {
    // 노드들의 walls 배열에서도 해당 벽을 제거 (Unity 원본은 setter에서 처리됨)
    const startNode = wall.startNode;
    const endNode = wall.endNode;
    if (startNode) {
      const idx = startNode.walls.indexOf(wall);
      if (idx >= 0) startNode.walls.splice(idx, 1);
    }
    if (endNode) {
      const idx = endNode.walls.indexOf(wall);
      if (idx >= 0) endNode.walls.splice(idx, 1);
    }
    set((s) => ({ walls: s.walls.filter((w) => w !== wall) }));
  },

  addSpace(space) {
    set((s) => ({ spaces: [...s.spaces, space] }));
  },

  removeSpace(space) {
    set((s) => ({ spaces: s.spaces.filter((sp) => sp !== space) }));
  },

  findNodeByPosition(position) {
    const eps2 = EPSILON * EPSILON;
    return get().nodes.find((n) => flatSqrDistance(n.position, position) < eps2);
  },

  nextNodeIndex() {
    const idx = get()._nextNodeIdx;
    set({ _nextNodeIdx: idx + 1 });
    return idx;
  },

  nextWallIndex() {
    const idx = get()._nextWallIdx;
    set({ _nextWallIdx: idx + 1 });
    return idx;
  },

  nextSpaceIndex() {
    const idx = get()._nextSpaceIdx;
    set({ _nextSpaceIdx: idx + 1 });
    return idx;
  },

  reset() {
    set({
      nodes: [],
      walls: [],
      spaces: [],
      _nextNodeIdx: 0,
      _nextWallIdx: 0,
      _nextSpaceIdx: 0,
    });
  },
}));

/**
 * `NodeRegistry` 구현 — `useLayoutStore` 위에 얇은 어댑터.
 *
 * `Node.create(position, layoutRegistry)` 형태로 도메인 로직이 쓸 수 있도록 제공.
 */
export const layoutRegistry: NodeRegistry & WallRegistry & SpaceRegistry = {
  findByPosition(position) {
    return useLayoutStore.getState().findNodeByPosition(position);
  },
  addNode(node) {
    useLayoutStore.getState().addNode(node);
  },
  removeNode(node) {
    useLayoutStore.getState().removeNode(node);
  },
  addWall(wall) {
    useLayoutStore.getState().addWall(wall);
  },
  removeWall(wall) {
    useLayoutStore.getState().removeWall(wall);
  },
  addSpace(space) {
    useLayoutStore.getState().addSpace(space);
  },
  removeSpace(space) {
    useLayoutStore.getState().removeSpace(space);
  },
  nextNodeIndex() {
    return useLayoutStore.getState().nextNodeIndex();
  },
  nextWallIndex() {
    return useLayoutStore.getState().nextWallIndex();
  },
  nextSpaceIndex() {
    return useLayoutStore.getState().nextSpaceIndex();
  },
};