import { create } from 'zustand';

/**
 * Wall/Floor/Ceiling/Product 등 임의의 mesh 표시/숨김 토글 — SceneOutliner 에서 사용.
 *
 * key 포맷: `${editKind}-${ownerId}` (MeshInspector 의 meshKey 와 동일 규칙).
 *   wall-0, floor-1, ceiling-2, product-X 등.
 *
 * 디폴트 = visible. map 에 명시적으로 false 가 있을 때만 hidden.
 */
export interface VisibilityState {
  hidden: Record<string, true>;
  /** 삭제된 mesh — 숨김과 달리 씬 트리에서도 사라진다(바닥/천장 등 자동 생성 메시용).
   *  공간이 다시 빌드되면(벽 편집 등) 인덱스가 재생성되므로 그때 자연 복구될 수 있다. */
  removed: Record<string, true>;
  isVisible: (key: string) => boolean;
  setVisible: (key: string, visible: boolean) => void;
  toggle: (key: string) => void;
  /** mesh 삭제 — 렌더 제외 + 트리에서 제거 */
  remove: (key: string) => void;
  showAll: () => void;
}

export const useVisibilityStore = create<VisibilityState>((set, get) => ({
  hidden: {},
  removed: {},
  isVisible: (key) => !get().hidden[key] && !get().removed[key],
  setVisible: (key, visible) =>
    set((s) => {
      const next = { ...s.hidden };
      if (visible) delete next[key];
      else next[key] = true;
      return { hidden: next };
    }),
  toggle: (key) =>
    set((s) => {
      const next = { ...s.hidden };
      if (next[key]) delete next[key];
      else next[key] = true;
      return { hidden: next };
    }),
  remove: (key) => set((s) => ({ removed: { ...s.removed, [key]: true } })),
  showAll: () => set({ hidden: {}, removed: {} }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__visibilityStore = useVisibilityStore; }, 0);
}