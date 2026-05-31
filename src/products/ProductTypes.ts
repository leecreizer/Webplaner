/**
 * 제품 분류 enum 및 카탈로그 마스터 DTO 모음.
 *
 * Unity의 다음 클래스를 한 모듈로 통합:
 * - `ProductWallFilled.eType` / `.eDetailType` / `.eOpenDir`
 * - `ProductInfoParam.ePlaceType` (별도 파일에 흩어져 있음)
 * - `WebEventHandler.PlaceProductParam`
 */

/**
 * 벽 삽입 제품 유형 — 문 vs 창문.
 * Unity `ProductWallFilled.eType`.
 */
export enum FilledType {
  DOOR = 0,
  WINDOW = 1,
}

/**
 * 벽 삽입 제품 세부 유형.
 * Unity `ProductWallFilled.eDetailType`.
 */
export enum FilledDetailType {
  DoorOpening = 0,
  Window2WSliding = 1,
  WindowSliding = 2,
}

/**
 * 문 열림 방향.
 * Unity `ProductWallFilled.eOpenDir`. 문이 아닌 창문은 항상 `NONE`.
 */
export enum OpenDir {
  NONE = 0,
  RIGHT = 1,
  LEFT = 2,
}

/**
 * 제품 배치 타입 — 바닥/벽/천장.
 * Unity `ProductInfoParam.ePlaceType` 대응.
 */
export enum PlaceType {
  Floor = 'floor',
  Wall = 'wall',
  Ceiling = 'ceiling',
}

/**
 * 웹/콘텐츠 마스터에서 내려온 상품 파라미터 — 런타임 배치 입력용 인터페이스.
 *
 * Unity `WebEventHandler.PlaceProductParam` 1:1 포팅.
 *
 * 저장용 DTO인 `ContentsMasterData`(saveload/PlanSaveData.ts)와 필드가 동일하지만,
 * 용도가 다르다: 본 인터페이스는 *입력*(배치 명령), `ContentsMasterData`는 *저장*(persist).
 * 둘은 단순 객체 복사로 상호 변환 가능.
 */
export interface PlaceProductParam {
  brandCD: string | null;
  contentsCD2: string | null;
  contentsCD: string | null;
  gdsCD: string | null;
  contentsNM: string | null;
  /** 가로 치수(mm). */
  length: number;
  /** 깊이(mm). */
  depth: number;
  /** 높이(mm). */
  height: number;
  /** 배치 타입 문자열 (`"floor"`/`"wall"`/`"ceiling"`). */
  pos: string | null;
  contentsType: string | null;
  placeHeight: number;
  spec: string | null;
  mallURL: string | null;
  price: number;
  /** glTF 자산 URL (Unity의 Resources.Load 경로 → Three.js GLBLoader URL). */
  assetURL: string;
}

/**
 * `PlaceProductParam.pos` 문자열을 {@link PlaceType} enum으로 변환한다.
 * Unity `ButtonCreateProduct.ConvertPosToType` 대응.
 */
export function posStringToPlaceType(pos: string | null | undefined): PlaceType | null {
  const v = (pos ?? '').toLowerCase();
  if (v === 'floor') return PlaceType.Floor;
  if (v === 'wall') return PlaceType.Wall;
  if (v === 'ceiling') return PlaceType.Ceiling;
  return null;
}

/**
 * contentsCD → {@link FilledDetailType} 매핑. `"door"`/`"window"`/`"window2w"` 외에는 DoorOpening 기본값.
 * Unity `ProductWallFilled.InitSymbol` 내부 분기 로직 추출.
 */
export function contentsCDToDetailType(contentsCD: string | null | undefined): FilledDetailType {
  const v = (contentsCD ?? '').toLowerCase();
  if (v === 'window') return FilledDetailType.WindowSliding;
  if (v === 'window2w') return FilledDetailType.Window2WSliding;
  return FilledDetailType.DoorOpening; // default (door 포함)
}

/** {@link FilledDetailType} → {@link FilledType} 매핑 (DOOR vs WINDOW). */
export function detailTypeToFilledType(detail: FilledDetailType): FilledType {
  return detail === FilledDetailType.DoorOpening ? FilledType.DOOR : FilledType.WINDOW;
}