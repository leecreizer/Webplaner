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
  isVisible: (key: string) => boolean;
  setVisible: (key: string, visible: boolean) => void;
  toggle: (key: string) => void;
  showAll: () => void;
}

export const useVisibilityStore = create<VisibilityState>((set, get) => ({
  hidden: {},
  isVisible: (key) => !get().hidden[key],
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
  showAll: () => set({ hidden: {} }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__visibilityStore = useVisibilityStore; }, 0);
}