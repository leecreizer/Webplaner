import { create } from 'zustand';

/**
 * 어드민(호스트)에서 선택한 상품을 캔버스에 클릭 배치하기 위한 상태.
 * - pending: 마우스에 따라다니는(배치 대기) 상품 박스 정보. null이면 배치 모드 아님.
 * - placed: 실제로 배치된 박스들.
 * 치수(w/d/h)는 mm 단위(어드민 상품정보 기준) → 렌더 시 /1000으로 m 변환.
 */
export interface PendingProduct {
  name: string;
  code?: string;
  w: number; // mm
  d: number; // mm
  h: number; // mm
  lift?: number; // 배치높이(바닥에서 띄움) mm
  modelUrl?: string; // 실제 GLB/GLTF 모델 URL (있으면 박스 대신 모델 로드)
}
export interface PlacedProduct extends PendingProduct {
  id: string;
  x: number; // m
  z: number; // m
  ry: number; // 회전 Y (deg)
}

interface PlacementState {
  pending: PendingProduct | null;
  placed: PlacedProduct[];
  /** 선택된 박스 id 목록 (다중 선택 지원). 단일 선택은 길이 1. */
  selectedIds: string[];
  /** 하위호환: 단일 선택 첫 항목 */
  selectedId: string | null;
  setPending: (p: PendingProduct | null) => void;
  place: (x: number, z: number) => void;
  /** 대기 상품 없이 지정 좌표에 바로 배치 (자동 배치용) */
  placeAt: (p: PendingProduct, x: number, z: number, ry?: number) => void;
  /** additive(Shift)면 토글 추가, 아니면 단독 선택. id=null이면 전체 해제 */
  select: (id: string | null, additive?: boolean) => void;
  update: (id: string, patch: Partial<PlacedProduct>) => void;
  remove: (id: string) => void;
  cancel: () => void;
  clearAll: () => void;
}

let _seq = 0;

export const usePlacedProductStore = create<PlacementState>((set, get) => ({
  pending: null,
  placed: [],
  selectedIds: [],
  selectedId: null,
  setPending: (p) => set({ pending: p }),
  place: (x, z) => {
    const p = get().pending;
    if (!p) return;
    const id = `pp-${++_seq}`;
    set((s) => ({ placed: [...s.placed, { ...p, id, x, z, ry: 0 }], pending: null, selectedIds: [id], selectedId: id }));
  },
  placeAt: (p, x, z, ry = 0) => {
    const id = `pp-${++_seq}`;
    set((s) => ({ placed: [...s.placed, { ...p, id, x, z, ry }] }));
  },
  select: (id, additive) => set((s) => {
    if (id == null) return { selectedIds: [], selectedId: null };
    let ids: string[];
    if (additive) ids = s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
    else ids = [id];
    return { selectedIds: ids, selectedId: ids[0] ?? null };
  }),
  update: (id, patch) => set((s) => ({ placed: s.placed.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  remove: (id) => set((s) => { const ids = s.selectedIds.filter((x) => x !== id); return { placed: s.placed.filter((p) => p.id !== id), selectedIds: ids, selectedId: ids[0] ?? null }; }),
  cancel: () => set({ pending: null }),
  clearAll: () => set({ placed: [], pending: null, selectedIds: [], selectedId: null }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__placedProductStore = usePlacedProductStore; }, 0);
}