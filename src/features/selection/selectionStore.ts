import { create } from 'zustand';
import type { Node } from '@/domain/structures/Node';
import type { Wall } from '@/domain/structures/Wall';

/**
 * 캔버스에서 사용자가 선택한 *단일* 객체(점 또는 벽) 상태.
 *
 * - **선택 트리거**: 노드/벽을 클릭(드래그 아닌 단순 클릭)했을 때 set
 * - **해제 트리거**: 빈 캔버스 클릭, ESC, 그리기 시작 등
 * - **삭제 트리거**: 선택된 객체 위 삭제 버튼 클릭 또는 Del/Backspace 키
 *
 * 선택된 노드는 그 노드와 연결된 wall도 함께 삭제될 수 있다 (`Wall.delete` 흐름).
 * 선택된 wall은 wall만 삭제 — 양 끝 노드는 다른 wall에 연결돼 있으면 살아남는다.
 */
export interface SelectionState {
  selectedNode: Node | null;
  selectedWall: Wall | null;
  selectNode: (n: Node | null) => void;
  selectWall: (w: Wall | null) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedNode: null,
  selectedWall: null,
  selectNode: (n) => set({ selectedNode: n, selectedWall: null }),
  selectWall: (w) => set({ selectedWall: w, selectedNode: null }),
  clear: () => set({ selectedNode: null, selectedWall: null }),
}));

/** dev 진단용으로 store를 window에 노출. */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__selectionStore = useSelectionStore; }, 0);
}