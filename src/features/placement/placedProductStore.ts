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
  /** 도어 등 부속이 부착된 몸통(베이스)의 placed id. 몸통 크기 변경 시 자동 갱신 대상 판별용. */
  parentId?: string;
  /** 부착 면(L/R) — 몸통 도어 슬롯과 매칭해 크기/위치를 따라가기 위함. */
  slotPos?: 'L' | 'R';
  /** 좌우 미러(피봇 보정) — POS='X' 범용 도어를 반대편(R) 슬롯에 붙일 때 대칭이 되도록 X축 반전. */
  mirror?: boolean;
  /** 실제 렌더된 모델의 가로/세로(mm, 보이는 bbox). 스냅을 등록치수가 아닌 실제 크기로 하기 위함. */
  renderW?: number;
  renderD?: number;
  // 견적용 — 콘텐츠 마스터 사이즈(카탈로그 등록 치수). 실제 렌더 지오메트리(w/h/d, stretch)와 별개.
  // 견적(hp3:scene)에는 이 마스터 사이즈가 나간다. 미설정 시 w/h/d 사용.
  masterW?: number;
  masterH?: number;
  masterD?: number;
  /** 도어 변형 상품 식별 — 모델코드/품목코드. 리사이즈 시 사이즈 변형 재조회 기준. */
  modelCode?: string;
  itemCode?: string;
  /**
   * 도어 사이즈 변형 테이블(admin이 부착 시 전달). 몸통 리사이즈로 도어 사이즈가 바뀌면
   * 이 표에서 사이즈에 맞는 변형을 골라 **명칭(name)·상품코드(code)·마스터 사이즈·모델**을 갱신한다.
   */
  variants?: DoorVariant[];
}

/** 도어 사이즈 변형 — 카탈로그의 같은 모델/품목 패밀리 한 사이즈. */
export interface DoorVariant {
  size: number; // 마스터 폭(mm) = 매칭 기준
  code?: string;
  name: string;
  masterW?: number;
  masterH?: number;
  masterD?: number;
  modelUrl?: string;
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
  /** 도어 열림 애니메이션 상태(확인용). true면 부착된 도어들이 힌지 기준으로 열린다. */
  doorsOpen: boolean;
  toggleDoors: () => void;
  setDoorsOpen: (v: boolean) => void;
  /** 도어 열림 각도(도). 힌지 기준. 양수 기본 100°. UI에서 조절. */
  doorOpenDeg: number;
  setDoorOpenDeg: (deg: number) => void;
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
  doorsOpen: false,
  toggleDoors: () => set((s) => ({ doorsOpen: !s.doorsOpen })),
  setDoorsOpen: (v) => set({ doorsOpen: v }),
  doorOpenDeg: 100,
  setDoorOpenDeg: (deg) => set({ doorOpenDeg: deg }),
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