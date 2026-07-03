import { Vector3 } from 'three';

/**
 * 평면도 전체의 저장 루트 DTO. 노드·벽·공간 3개 컬렉션과 orphan 제품 목록으로 구성된다.
 * 파일 저장 플로우(plan.json)의 루트이며, {@link RenderPlanSaveData}의 하위 구조로도 재사용된다.
 *
 * Unity `SaveLoad.PlanSaveData`와 JSON 호환 — 필드명/타입 모두 동일하게 유지한다.
 */
export interface PlanSaveData {
  Nodes: NodeData[];
  Walls: WallData[];
  Spaces: SpaceData[];
  /**
   * 어떤 Space에도 속하지 않는 떠있는 제품 목록 (Space.SpaceEmpty 소속).
   * 구버전 저장 파일과의 호환을 위해 null/undefined일 수 있다 — 로드 측에서 null 체크 필수.
   */
  OrphanProducts?: ProductData[] | null;
  /** 공간 모듈 목록 (선택 — 구버전 데이터 하위 호환). */
  spaceModules?: SpaceModuleData[];
}

/**
 * 파라메트릭 공간 모듈({@link SpaceModule})의 저장 DTO.
 * 모듈발 벽(`isModuleWall`)은 로드 시 `syncModuleWalls()`가 재생성하므로 별도 저장하지 않는다.
 */
export interface SpaceModuleData {
  id: string;
  kind: string;
  name: string;
  x: number;
  z: number;
  ry: number;
  w: number;
  d: number;
  wallH: number;
  openings: SpaceModuleOpeningData[];
}

/** {@link SpaceModuleData}의 개구부(문/오프닝) 저장 DTO. */
export interface SpaceModuleOpeningData {
  id: string;
  side: string;
  type: string;
  offset: number;
  width: number;
  height: number;
  /** 창호 하단 높이(m) — window 타입 전용. */
  sill?: number;
  suppressedBy?: string;
}

/**
 * 벽 끝점(꼭짓점)의 저장 DTO. `nodeIndex`는 {@link WallData.nodeIndices}가 참조하는 고유 키.
 */
export interface NodeData {
  nodeIndex: number;
  position: VectorData;
}

/**
 * 벽 세그먼트의 저장 DTO. `nodeIndices[0]→[1]`이 벽 진행방향을 정의하며,
 * `filledObjects`에 이 벽에 삽입된 문/창호 목록이 포함된다.
 */
export interface WallData {
  wallIndex: number;
  /** [시작노드, 끝노드] 인덱스. 벽 진행 방향 정의. */
  nodeIndices: [number, number];
  /** 가상벽(공간 분리용) 여부. true면 `eWallType.VIRTUAL`. */
  isVirtual: boolean;
  /** 벽 두께(m) */
  thickness: number;
  /** 벽 높이(m) */
  height: number;
  /** 구조 형식. `"NBW"`(비내력) / `"BW"`(내력) */
  bearingType: BearingTypeStr;
  /** 이 벽에 삽입된 문/창호 목록. */
  filledObjects: FilledObjectData[];
}

/** 내력벽 종류 — 직렬화 문자열 표현. */
export type BearingTypeStr = 'NBW' | 'BW';

/**
 * 벽들로 둘러싸인 공간의 저장 DTO. `wallIndices` 집합 비교로 로드 시 Space 매칭.
 * `products`에 공간에 배치된 제품(바닥/벽면/천장 등)이 포함된다.
 */
export interface SpaceData {
  spaceIndex: number;
  wallIndices: number[];
  spaceName: string;
  products: ProductData[];
}

/**
 * Space.AllProducts에 등록되는 제품(floor/wall-surface/ceiling)의 저장 DTO.
 * 벽에 박혀있지 않으므로 월드 좌표를 그대로 저장·복원한다.
 */
export interface ProductData {
  worldPosition: VectorData;
  worldRotationEuler: VectorData;
  /** `ProductStretchable.GetSize()` 결과. 없으면 (0,0,0). */
  size: VectorData;
  contentsMaster: ContentsMasterData;
}

/**
 * 벽에 삽입된 문/창호의 저장 DTO.
 *
 * `worldPosition`/`worldRotationEuler`는 참고/디버그용이며, 복원은 벽 기준 상대 오프셋
 * (`alongWall` + `worldY` + `facingRight`)을 사용한다.
 */
export interface FilledObjectData {
  /** `"DOOR"` 또는 `"WINDOW"` */
  filledObjectType: FilledObjectTypeStr;
  /** 참고용 월드 위치 (복원 시 사용 안 함). */
  worldPosition: VectorData;
  /** 참고용 월드 회전 (복원 시 사용 안 함). */
  worldRotationEuler: VectorData;

  /** StartNode로부터 벽 진행방향으로의 거리(m). */
  alongWall: number;
  /** 월드 Y 좌표(설치 높이, m). */
  worldY: number;
  /** 벽 진행방향 기준 오른쪽 법선을 향하면 true. */
  facingRight: boolean;

  /** 현재 크기(m). Init 후 다르면 Resize 재조정. */
  size: VectorData;
  /** 문 열림 방향. WINDOW는 항상 `"NONE"`. */
  openDir: OpenDirStr;
  contentsMaster: ContentsMasterData;
}

/** FilledObject 타입 문자열. */
export type FilledObjectTypeStr = 'DOOR' | 'WINDOW';

/** 문 열림 방향 — DOOR만 의미가 있고, WINDOW는 항상 `"NONE"`. */
export type OpenDirStr = 'NONE' | 'LEFT' | 'RIGHT';

/** 제품 배치 타입. 문/창호는 별도 저장이라 사용하지 않음(`null`). */
export type PosStr = 'floor' | 'wall' | 'ceiling' | null;

/**
 * 제품 마스터(카탈로그) 정보의 저장 DTO. `WebEventHandler.PlaceProductParam`과 1:1 매핑.
 *
 * **단위 주의** — 치수(length/depth/height/placeHeight)는 **밀리미터(mm)** 단위 (카탈로그 규격).
 * 반면 {@link ProductData.size}, {@link FilledObjectData.size}는 런타임 크기로 **미터(m)** 단위.
 *
 * 제품 종류에 따라 채워지는 필드가 다르며, `null`은 데이터 누락이 아니라
 * "해당 제품 유형에는 무의미한 필드"로 해석한다.
 */
export interface ContentsMasterData {
  brandCD: string | null;
  contentsCD2: string | null;
  contentsCD: string | null;
  gdsCD: string | null;
  contentsNM: string | null;
  /** 가로 치수(mm) */
  length: number;
  /** 깊이(mm) */
  depth: number;
  /** 높이(mm) */
  height: number;
  /** 배치 타입 구분 (`"floor"`/`"wall"`/`"ceiling"`). 문/창호는 `null`. */
  pos: PosStr;
  /** 상품 분류 (예: `"modeling"`). null이면 분류 미지정. */
  contentsType: string | null;
  /** 설치 기준 높이(mm) */
  placeHeight: number;
  spec: string | null;
  /** 제품 참조 이미지가 있는 웹사이트 URL. */
  mallURL: string | null;
  price: number;
  /** `Resources.Load` 경로 (Unity)였던 자산 키. Three.js에서는 GLB asset URL로 매핑. */
  assetURL: string;
}

/**
 * Vector3 직렬화 래퍼.
 * `{ x: number, y: number, z: number }` 형태로 JSON 저장된다.
 *
 * **좌표계 약속** — XZ는 평면, Y는 높이. Unity와 동일.
 * - `NodeData.position`, `*.worldPosition`, `CameraSaveData.position`: **미터(m)** 단위
 * - 회전은 모두 **오일러각(도)**.
 */
export interface VectorData {
  x: number;
  y: number;
  z: number;
}

/**
 * 렌더링 요청용 저장 DTO. 카메라 파라미터와 평면도 데이터를 함께 묶어 Snapit/Gemini 서버로 전달한다.
 *
 * Unity `PlanDataHandler.GenerateRenderPlanDataAsJsonString(w, h)` 출력의 1:1 대응.
 */
export interface RenderPlanSaveData {
  cameraSaveData: CameraSaveData;
  planSaveData: PlanSaveData;
}

/**
 * 렌더링 시 사용할 카메라 상태 DTO (위치·회전·투영·FOV·Clip·해상도).
 *
 * `renderWidth`/`renderHeight`는 호출자가 실제 캡처한 해상도(픽셀)를 넘겨받아 기록한다 —
 * 참조 이미지와 aspect/구도 매칭의 근거.
 */
export interface CameraSaveData {
  position: VectorData;
  rotationEuler: VectorData;
  /** 투영 방식. 현재 `"perspective"`로 고정 저장 (orthographic은 미반영). */
  projection: 'perspective' | 'orthographic';
  /** 수직 FOV(도). `projection === "perspective"`일 때 유효. */
  fieldOfView: number;
  nearClipPlane: number;
  farClipPlane: number;
  /** 캡처 이미지 가로 해상도(px). aspect 복원 및 이미지 매칭용. */
  renderWidth: number;
  /** 캡처 이미지 세로 해상도(px). */
  renderHeight: number;
}

// ============================================================
// 변환 헬퍼 — Vector3 ↔ VectorData
// Unity의 `VectorData(Vector3 v)` 생성자와 `ToVector3()` 메서드 대체.
// ============================================================

/** {@link VectorData}를 Three.js `Vector3`로 변환한다. */
export function vectorDataToVector3(v: VectorData): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

/** Three.js `Vector3`를 {@link VectorData}로 변환한다. */
export function vector3ToVectorData(v: Vector3): VectorData {
  return { x: v.x, y: v.y, z: v.z };
}

/** 영벡터 `{ x: 0, y: 0, z: 0 }`을 새로 생성한다. */
export function zeroVectorData(): VectorData {
  return { x: 0, y: 0, z: 0 };
}