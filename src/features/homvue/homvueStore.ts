import { create } from 'zustand';
import { roomFocus, roomSpot, toScene, travelSpots } from './homvueTravel';
import { fetchMaterials, type MaterialManifest } from './homvueMaterials';
import { fetchMaterialParams, type MatParamsManifest } from './homvueMaterialParams';
import { fetchCatalog, fetchPlan, type Catalog, type CatalogItem, type HomvueLight, type PlacedItem, type PlanData, type PlanIndexEntry, type Vec3 } from './homvueAssets';

/** 재질 직접 편집 값 — 비운 항목은 원래 값 */
export interface HomvueMatEdit {
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transmission?: number;
  ior?: number;
}

/**
 * Homvue 이식 상태.
 * - 아파트·평면 선택 (언리얼 WB_Step_PlanMenu · WB_MenuAPTCell · WB_MenuPlanCell)
 * - 방 유형·스타일 변경 (WB_MenuRoomStyleCell · ChangeRoomModule) — 방마다 모듈 번호
 * - 투어 (HVTravelControllerComponent · HVPlayer) — 1인칭 둘러보기와 투어 지점·방으로 이동
 * - 상품 선택·교체 (HVPlayer::ChangeProduct · WB_ChangeProductCell) — 같은 종류 상품으로, 위치·방향 유지
 *
 * plan 이 있으면 그 평면을 장면에 조립하고 홈플래너3 자체 도면(PlanScene)은 숨긴다.
 */
export interface HomvueState {
  panelOpen: boolean;
  plans: PlanIndexEntry[];
  listError: string | null;
  /** 장면에 띄운 평면 */
  plan: PlanData | null;
  /** 방 종류(Living01 …) → 고른 모듈 번호 */
  modules: Record<string, number>;
  showCeiling: boolean;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  loadError: string | null;
  /** 아파트를 홈플래너3 원점에 맞추려고 옮긴 양 — 평면 좌표(언리얼에서 옮긴 값) + offset = 장면 좌표 */
  offset: Vec3;
  /** 투어(1인칭) 모드 — 켜지면 궤도 카메라 대신 HomvueWalkControls 가 카메라를 움직인다 */
  walk: boolean;
  /** 이동 요청 — 장면 좌표의 바닥 지점. seq 가 바뀔 때마다 그곳 눈높이로 부드럽게 이동 */
  travel: { target: Vec3; look: Vec3 | null; seq: number } | null;
  /** 지금 있는 방 — 방 이동·투어 지점 클릭으로 바뀐다 (언리얼 CurrentTraveledRoomMaster). 미니맵 강조 */
  currentRoom: string | null;
  /** 선택한 상품의 key (placedProducts 의 key) */
  selected: string | null;
  /** 교체한 상품 — key → 교체본 */
  overrides: Record<string, PlacedItem>;
  catalog: Catalog | null;
  /** 견적 패널 (WB_Estimate) */
  estimateOpen: boolean;
  /** 배치 상품 확인 패널 (WB_CheckProducts) */
  checkOpen: boolean;
  /** 상담 신청 패널 (WB_PhoneNumInput · WB_AgreementPopup · WB_SelectStore) */
  consultOpen: boolean;
  /** 언리얼 재질 실제 값 (manifest/material-params.json) — 평면을 열기 전에 받아 둔다 */
  matParams: MatParamsManifest | null;
  /** 재질 목록·구운 GLB (manifest/materials.json) */
  materials: MaterialManifest | null;
  /** 방 → 고른 벽지·바닥재 ID (언리얼은 방마다 따로: CurrentRoom->ChangeAllWallsMaterial / ChangeFloorMaterial) */
  matWall: Record<string, number>;
  matFloor: Record<string, number>;
  /** 상품 key → 고른 상품 재질 ID */
  matProduct: Record<string, number>;
  /** 실내 조명 전체 배율 (HomvueLights) — 언리얼 노출과 맞추는 값 */
  lightScale: number;
  /** 기즈모 모드 — 이동·회전(3축)·크기 (HomvueGizmo · HomvueInspector) */
  gizmoMode: 'translate' | 'rotate' | 'scale';
  /** 물체 key → (원래 재질 uuid → 편집 값). 편집할 때 그 물체용으로 재질을 복제해 다른 물체는 그대로 둔다 */
  matEdits: Record<string, Record<string, HomvueMatEdit>>;
  /** 언리얼 조명 번호(plan.base.lights 순서) → 고친 값 */
  lightEdits: Record<number, Partial<HomvueLight>>;
  /** 언리얼 조명 위치 표시(누르면 선택) */
  showLightMarkers: boolean;
  /** 물체를 옮기거나 값을 고칠 때마다 1씩 — 편집 패널이 장면 물체 값을 다시 읽는다 */
  editTick: number;
  /** 미니맵 이미지 — 위에서 내려다본 캡처와 그 범위(장면 좌표 x·z) */
  minimap: { url: string; bounds: [number, number, number, number] } | null;
  togglePanel: () => void;
  setPlans: (list: PlanIndexEntry[]) => void;
  setListError: (msg: string | null) => void;
  /** modules 를 주면 기본 모듈 대신 그것으로 (저장 불러오기) */
  openPlan: (id: string, modules?: Record<string, number>) => Promise<void>;
  closePlan: () => void;
  setModule: (roomType: string, no: number) => void;
  setShowCeiling: (v: boolean) => void;
  setLoadState: (state: HomvueState['loadState'], error?: string | null) => void;
  setOffset: (v: Vec3) => void;
  setWalk: (v: boolean) => void;
  /** 투어 지점·방으로 이동 — 투어 모드가 아니면 켠다. look 이 있으면 도착하며 그쪽을 본다(고개 10° 숙임) */
  travelTo: (target: Vec3, room: string | null, look?: Vec3 | null) => void;
  select: (key: string | null) => void;
  /** 상품 교체 — 언리얼처럼 위치·회전만 이어받고 크기는 새 상품 기본값(1) */
  swap: (key: string, from: PlacedItem, to: CatalogItem) => void;
  /** 놓인 상품을 옮김·회전 — 기즈모(HomvueGizmo)를 놓을 때. 언리얼 좌표(cm·도)로 저장 */
  moveItem: (key: string, item: PlacedItem) => void;
  loadCatalog: () => Promise<void>;
  setEstimateOpen: (v: boolean) => void;
  setCheckOpen: (v: boolean) => void;
  setConsultOpen: (v: boolean) => void;
  setMinimap: (m: HomvueState['minimap']) => void;
  loadMaterials: () => Promise<void>;
  setLightScale: (v: number) => void;
  setMaterial: (kind: 'wall' | 'floor' | 'product', target: string, id: number) => void;
  /** 방으로 이동 — 언리얼 TravelToRoom (패널 「~로 이동」·미니맵 공간 버튼 WB_MinimapSpaceButton) */
  goToRoom: (roomType: string) => void;
  setGizmoMode: (m: HomvueState['gizmoMode']) => void;
  setMatEdit: (key: string, matId: string, patch: HomvueMatEdit | null) => void;
  setLightEdit: (index: number, patch: Partial<HomvueLight> | null) => void;
  setShowLightMarkers: (v: boolean) => void;
  bumpEdit: () => void;
}

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__homvueStore = useHomvueStore; }, 0);
}

export const useHomvueStore = create<HomvueState>((set) => ({
  panelOpen: false,
  plans: [],
  listError: null,
  plan: null,
  modules: {},
  // 천장 표시 — 기본 켬(평면을 열 때마다 켠 상태로 시작)
  showCeiling: true,
  loadState: 'idle',
  loadError: null,
  offset: [0, 0, 0],
  walk: false,
  travel: null,
  currentRoom: null,
  selected: null,
  overrides: {},
  catalog: null,
  estimateOpen: false,
  checkOpen: false,
  consultOpen: false,
  minimap: null,
  // 언리얼 값 그대로 — 밝기는 평면의 언리얼 노출이 맞춘다(homvueEnvironment). 예전 ×3 은 노출 대신 조명을 키운 것
  lightScale: 1,
  gizmoMode: 'translate',
  matEdits: {},
  lightEdits: {},
  showLightMarkers: false,
  editTick: 0,
  matParams: null,
  materials: null,
  matWall: {},
  matFloor: {},
  matProduct: {},
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPlans: (plans) => set({ plans, listError: null }),
  setListError: (listError) => set({ listError }),
  openPlan: async (id, saved) => {
    set({ loadState: 'loading', loadError: null, showCeiling: true });
    try {
      // 재질 값은 조립(prepare) 때 바로 쓰이므로 평면보다 먼저 받아 둔다
      const [plan, matParams] = await Promise.all([fetchPlan(id), useHomvueStore.getState().matParams ?? fetchMaterialParams()]);
      if (matParams) set({ matParams });
      // 방마다 언리얼 데이터의 기본 모듈(IsDefault)로 시작
      const modules: Record<string, number> = {};
      for (const r of plan.rooms) {
        const no = saved?.[r.type];
        modules[r.type] = (no && r.modules.some((m) => m.no === no) ? no : (r.modules.find((m) => m.isDefault) ?? r.modules[0])?.no) ?? 1;
      }
      set({ plan, modules, selected: null, overrides: {}, matWall: {}, matFloor: {}, matProduct: {}, matEdits: {}, lightEdits: {} });
      void useHomvueStore.getState().loadMaterials();
    } catch (e) {
      set({ loadState: 'error', loadError: String((e as Error).message ?? e) });
    }
  },
  closePlan: () => set({ minimap: null, estimateOpen: false, checkOpen: false, consultOpen: false, plan: null, modules: {}, loadState: 'idle', loadError: null, walk: false, travel: null, currentRoom: null, selected: null, overrides: {}, matEdits: {}, lightEdits: {} }),
  setModule: (roomType, no) => set((s) => ({ modules: { ...s.modules, [roomType]: no }, selected: null })),
  setShowCeiling: (showCeiling) => set({ showCeiling }),
  setLoadState: (loadState, loadError = null) => set({ loadState, loadError }),
  setOffset: (offset) => set({ offset }),
  setWalk: (walk) => set({ walk }),
  travelTo: (target, room, look = null) =>
    set((s) => ({ walk: true, currentRoom: room ?? s.currentRoom, travel: { target, look, seq: (s.travel?.seq ?? 0) + 1 } })),
  select: (selected) => set({ selected }),
  setEstimateOpen: (estimateOpen) => set({ estimateOpen }),
  setCheckOpen: (checkOpen) => set({ checkOpen }),
  setConsultOpen: (consultOpen) => set({ consultOpen }),
  setMinimap: (minimap) => set({ minimap }),
  setLightScale: (lightScale) => set({ lightScale }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  // null = 그 재질의 편집을 지운다(원래대로)
  setMatEdit: (key, matId, patch) =>
    set((s) => {
      const cur = { ...(s.matEdits[key] ?? {}) };
      if (patch === null) delete cur[matId];
      else cur[matId] = { ...cur[matId], ...patch };
      return { matEdits: { ...s.matEdits, [key]: cur } };
    }),
  setLightEdit: (index, patch) =>
    set((s) => {
      const next = { ...s.lightEdits };
      if (patch === null) delete next[index];
      else next[index] = { ...next[index], ...patch };
      return { lightEdits: next };
    }),
  setShowLightMarkers: (showLightMarkers) => set({ showLightMarkers }),
  bumpEdit: () => set((s) => ({ editTick: s.editTick + 1 })),
  loadMaterials: async () => {
    const materials = await fetchMaterials();
    if (materials) set({ materials });
  },
  setMaterial: (kind, target, id) =>
    set((s) =>
      kind === 'wall'
        ? { matWall: { ...s.matWall, [target]: id } }
        : kind === 'floor'
          ? { matFloor: { ...s.matFloor, [target]: id } }
          : { matProduct: { ...s.matProduct, [target]: id } },
    ),
  goToRoom: (roomType) => {
    const { plan, modules, offset, travelTo } = useHomvueStore.getState();
    if (!plan) return;
    const spots = travelSpots(plan, modules);
    const spot = roomSpot(spots, roomType);
    const focus = roomFocus(spots, roomType);
    if (spot) travelTo(toScene(spot.local, offset), roomType, focus && toScene(focus, offset));
  },
  moveItem: (key, item) => set((s) => ({ overrides: { ...s.overrides, [key]: item } })),
  swap: (key, from, to) =>
    set((s) => ({
      overrides: {
        ...s.overrides,
        [key]: {
          blueprint: to.blueprint,
          glb: to.glb,
          location_cm: from.location_cm,
          rotation_deg: from.rotation_deg,
          scale: [1, 1, 1],
          product: { id: to.id, code: to.code, name: to.name, type: to.type, group: to.group, price: to.price, eventPrice: to.eventPrice },
        },
      },
    })),
  loadCatalog: async () => {
    if (useHomvueStore.getState().catalog) return;
    try {
      set({ catalog: await fetchCatalog() });
    } catch (e) {
      set({ listError: String((e as Error).message ?? e) });
    }
  },
}));
