/**
 * Homvue(언리얼) 이식 데이터 — 변환 도구(D:\HP3_assets\homvue\tools)가 만든 목록(manifest)과 GLB.
 *
 * 개발 서버: Vite 프록시가 `/homvue/**` 를 로컬 정적 서버(127.0.0.1:8791, 변환 결과 폴더)로 넘긴다.
 * 배포: HOMVUE_BASE 를 CDN 주소로 바꾼다. 목록 안의 glb 경로는 `/homvue/glb/...` 형태로 기록돼 있다.
 *
 * 데이터 원본: 언리얼 데이터 테이블(DT_APTMaster · DT_PlanMaster · DT_RoomMaster · DT_ProductMaster)과
 * 평면 레벨(기본 레벨 + 방별 모듈 레벨)의 액터 배치. 좌표는 언리얼 그대로(cm · Roll/Pitch/Yaw) — ueTransform 으로 옮긴다.
 */
export const HOMVUE_BASE = '/homvue';

export type Vec3 = [number, number, number];

/** 레벨에 놓인 블루프린트 하나 (아파트 벽·바닥 또는 상품) */
export interface PlacedItem {
  blueprint: string;
  /** 변환된 GLB — 아직 변환 전이면 null */
  glb: string | null;
  location_cm: Vec3;
  rotation_deg: Vec3;
  scale: Vec3;
  /** 언리얼 상품 마스터(DT_ProductMaster) — 블루프린트 이름으로 연결. 없으면 소품(교체 대상 아님) */
  product?: ProductMasterInfo;
}

export interface ProductMasterInfo {
  id: number;
  code: string;
  name: string;
  type: string;
  group: string;
  price: number;
  eventPrice: number;
}

/** 상품 교체 후보 — 상품 마스터 행 + 블루프린트 GLB(변환 전이면 null) */
export interface CatalogItem extends ProductMasterInfo {
  blueprint: string;
  glb: string | null;
}

/** ProductType → 후보 목록 (언리얼 GetChangeableProductList = 같은 ProductType) */
export type Catalog = Record<string, CatalogItem[]>;

/** 언리얼 조명 (평면 기본 레벨) — HomvueLights 가 three 조명으로 옮긴다 */
export interface HomvueLight {
  kind: 'rect' | 'spot' | 'point';
  actor: string;
  location_cm: Vec3;
  rotation_deg: Vec3;
  intensity: number | null;
  units: 'lumens' | 'candelas' | 'unitless';
  color: [number, number, number] | null;
  temperature: number | null;
  width_cm: number | null;
  height_cm: number | null;
  inner_deg: number | null;
  outer_deg: number | null;
  radius_cm: number | null;
  shadows: boolean | null;
}

export interface TravelPoint {
  /** BP_TravelPoint(주 지점) · BP_SubTravelTargetPoint(보조) */
  kind: string;
  location_cm: Vec3;
  rotation_deg: Vec3;
  /** 언리얼 IsCapturePoint / IsPlayerStartPoint — data/travel-info.json 추출 후 채워짐 */
  capture?: boolean;
  start?: boolean;
}

/** 방 모듈 = 방 스타일 선택지 하나 (언리얼 DT_RoomMaster 행 + 그 모듈 레벨의 배치) */
export interface RoomModule {
  no: number;
  name: string;
  isDefault: boolean;
  style: string;
  level: string | null;
  products: PlacedItem[];
  travel: TravelPoint[];
  unconverted: number;
  /** 이 모듈의 방 바닥(BP_*_Floor) — 기본 레벨이 아니라 모듈 레벨에 들어 있다 */
  apartment: PlacedItem[];
  /** 언리얼 방 마스터 행(DT_RoomMaster) — 저장 파일(FSaveData.RoomList)에 그대로 들어간다 */
  master?: Record<string, string>;
}

export interface PlanRoom {
  /** Living01 · Room01 … */
  type: string;
  label: string;
  modules: RoomModule[];
}

export interface PlanData {
  id: string;
  apt: { id: string; dong: string; name: string; label: string };
  planName: string;
  alias: string | null;
  area: string | null;
  /** 상담 문자에 들어가는 VR 링크(DT_PlanMaster.CoohomVRURL) · 홈플래너 링크(DT_HomeplannerURL, 방 스타일별) */
  coohomVRURL?: string;
  homeplannerURL?: Record<string, string>;
  base: { level: string; apartment: PlacedItem[]; products: PlacedItem[]; travel: TravelPoint[]; staticMeshes: number; lights?: HomvueLight[];
    /** 기본 레벨에 직접 놓인 Datasmith 메시 전부(주방·욕실·문·창호 등)를 레벨 좌표 그대로 묶은 GLB */
    static?: string | null };
  rooms: PlanRoom[];
}

/** 아파트·평면 선택 목록의 한 줄 */
export interface PlanIndexEntry {
  id: string;
  apt: PlanData['apt'];
  planName: string;
  alias: string | null;
  area: string | null;
  apartmentParts: number;
  products: number;
  unconvertedProducts: number;
  rooms: { type: string; label: string; modules: number }[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${HOMVUE_BASE}/${path}`);
  if (!res.ok) throw new Error(`${path} 를 불러오지 못했습니다 (${res.status}) — 변환 결과 서버(8791) 확인`);
  return res.json();
}

export const fetchPlans = () => getJson<PlanIndexEntry[]>('manifest/plans.json');
export const fetchCatalog = () => getJson<Catalog>('manifest/catalog.json');
export const fetchPlan = (id: string) => getJson<PlanData>(`manifest/plans/${id}.json`);

/** 평면의 언리얼 노출·해·하늘·후처리 (tools/build_env.py → manifest/env/<평면>.json) */
export interface HomvueEnvironment {
  plan: string;
  exposure: { method: string; bias: number; physical_camera: boolean; ev100: number; scale: number };
  sun: { lux: number; temperature: number | null; color: [number, number, number, number] | null; rotation_deg: [number, number, number] | null } | null;
  sky: { actor: string; intensity: number; source: string }[];
  post: { vignette: number; bloom: number; white_temp: number; lumen_indirect_intensity: number };
}
/** 평면 레벨 이름(Common_01_Base_01_43)의 끝 = 평면 이름(43) */
export const fetchEnvironment = (level: string) =>
  getJson<HomvueEnvironment>(`manifest/env/${level.split('_').pop()}.json`).catch(() => null);

/** 평면 표시 이름 — "43 · 2BAY (43㎡)" */
export function planLabel(p: { planName: string; alias: string | null; area: string | null }): string {
  return `${p.planName}${p.alias ? ` · ${p.alias}` : ''}${p.area ? ` (${p.area}㎡)` : ''}`;
}

/** 아파트 블루프린트 중 천장 — 천장 표시 토글 대상 */
export const isCeiling = (item: PlacedItem) => /cell?ing/i.test(item.blueprint);

/** 장면에 놓인 상품 — 기본 레벨 고정 설비 + 방마다 고른 모듈의 가구, 교체한 것은 교체본으로.
 *  key 는 상품 교체 기록(overrides)의 열쇠 — 모듈마다 다르므로 모듈을 바꿔도 다른 방의 교체는 유지된다. */
export function placedProducts(
  plan: PlanData,
  modules: Record<string, number>,
  overrides: Record<string, PlacedItem>,
): { key: string; item: PlacedItem }[] {
  const list = plan.base.products.map((item, i) => ({ key: `base-${i}`, item }));
  for (const room of plan.rooms) {
    const m = room.modules.find((x) => x.no === modules[room.type]);
    m?.products.forEach((item, i) => list.push({ key: `${room.type}-${m.no}-${i}`, item }));
  }
  return list.map(({ key, item }) => ({ key, item: overrides[key] ?? item }));
}

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 방 종류 — placedProducts 의 key 앞부분 (기본 레벨 상품은 null) */
export const roomOfKey = (key: string): string | null => (key.startsWith('base-') ? null : key.split('-')[0]);

/** 보여 줄 상품 — 언리얼 CachingAllShowableProducts: 마스터(ID·코드)가 있고 가격 > 0, 방마다 상품 코드로 중복 제거.
 *  투어 중 상품 점(WB_Dot)과 배치 상품 확인(WB_CheckProducts)이 쓴다. */
export function showableProducts(
  plan: PlanData,
  modules: Record<string, number>,
  overrides: Record<string, PlacedItem>,
): { key: string; room: string | null; item: PlacedItem }[] {
  const seen = new Set<string>();
  const out: { key: string; room: string | null; item: PlacedItem }[] = [];
  for (const { key, item } of placedProducts(plan, modules, overrides)) {
    const p = item.product;
    if (!p || p.id <= 0 || !p.code || p.price <= 0) continue;
    const room = roomOfKey(key);
    const k = `${room}|${p.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key, room, item });
  }
  return out;
}

/** 투어 중 상품 점을 띄울 방 — 거실·주방은 한 공간으로 본다 (UpdateShowableProductsDots) */
export function sameDotSpace(a: string | null, b: string | null): boolean {
  const open = (r: string | null) => r === 'Living01' || r === 'Kitchen01';
  return open(a) && open(b) ? true : a === b;
}
