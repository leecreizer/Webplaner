import type { PlanSaveData } from '@/persistence/PlanSaveData';
import type { PlaceProductParam } from '@/domain/products/ProductTypes';

/**
 * HomePlanner3 → 부모 React 호스트로 전달되는 *outgoing* 이벤트 타입.
 *
 * Unity의 jslib bridge(`WebEventHandler.jslib` + `WebEventHandler_Layout.jslib` +
 * `CameraCaptureBridge.jslib`)에서 `window.dispatchReactUnityEvent("...", obj)`로 던지던
 * 모든 이벤트를 props/callback 형태로 통합한다.
 *
 * 본 인터페이스를 구현한 `HostEventHandlers` 객체를 `<App>` 또는 `<HostProvider>`에 props로
 * 넘기면, 도메인 측이 `HostBridge.emit*` 메서드로 이벤트를 발행할 때마다 해당 콜백이 호출된다.
 *
 * ### 페이로드 타입 정책
 * 일부 페이로드(예: `loadedPlan`)는 우리가 정확히 알고 있는 구조(`PlanSaveData`)로 strong-type.
 * 나머지는 Unity 측 JSON과 호환 유지를 위해 `Record<string, unknown>`으로 둔다 — 부모 호스트가
 * 자체 타입가드로 좁히면 된다.
 */

/** 결과 코드 + 메시지 — Unity가 모든 콜백 첫 인자로 보내던 표준 형태. */
export interface HostResult {
  resultCd: string;
  resultDesc: string;
}

/**
 * 모든 outgoing 이벤트 핸들러 인터페이스 (선택적).
 *
 * 부모 호스트는 자기가 관심 있는 콜백만 구현하면 된다 — 본 인터페이스의 모든 메서드는
 * optional이라 부분 구현을 허용한다.
 */
export interface HostEventHandlers {
  // ===== 평면도 로드/저장 ========================================

  /** Unity `OnLoadedPlanCallback` 대응 — 평면도 로드 완료 시. */
  onLoadedPlan?(result: HostResult, plan: PlanSaveData): void;

  /** Unity `OnSavePlanCallback` 대응 — 평면도 저장 완료 시 (페이로드는 호스트 협의에 따라). */
  onSavedPlan?(result: HostResult, payload: Record<string, unknown>): void;

  /** Unity `OnDeletePlanCallback` 대응. */
  onDeletedPlan?(result: HostResult): void;

  // ===== 상품 배치 / 선택 ========================================

  /** Unity `OnPlaceFloorProductCallback` — 바닥 상품 배치 완료. */
  onPlaceFloorProduct?(result: HostResult, product: PlaceProductParam): void;

  /** Unity `OnPlaceCeilingProductCallback`. */
  onPlaceCeilingProduct?(result: HostResult, product: PlaceProductParam): void;

  /** Unity `OnPlaceWallProductCallback`. */
  onPlaceWallProduct?(result: HostResult, product: PlaceProductParam): void;

  /** Unity `OnPlaceWallFilledCallback` — 문/창호 배치 완료. */
  onPlaceWallFilled?(result: HostResult, payload: Record<string, unknown>): void;

  /**
   * Unity `OnProductSelected` — 상품을 클릭/포인터로 선택했을 때.
   *
   * `contentsAttrib`는 Unity의 contentsCD + length/depth/height/placeHeight(mm).
   */
  onProductSelected?(result: HostResult, contentsAttrib: {
    contentsCD: string | null;
    length: number;
    depth: number;
    height: number;
    placeHeight: number;
  }): void;

  // ===== 모드 전환 ===============================================

  /** Unity `OnModeChangedLayout` — 평면도 그리기 모드 진입/이탈. */
  onModeChangedLayout?(payload: { isLayoutMode: boolean }): void;

  /** Unity `OnModeChangedProduct` — 상품 배치 모드. */
  onModeChangedProduct?(payload: { isProductMode: boolean }): void;

  /** Unity `OnRenderModeActivatedCallback`. */
  onRenderModeActivated?(result: HostResult): void;

  /** Unity `OnRenderModeDeactivatedCallback`. */
  onRenderModeDeactivated?(result: HostResult): void;

  /** Unity `OnCameraProjectionChanged` — Perspective ↔ Orthographic 전환. */
  onCameraProjectionChanged?(result: HostResult, is2D: boolean): void;

  /** Unity `OnWireModeChangedCallback` — 와이어프레임/머티리얼 모드. */
  onWireModeChanged?(payload: { mode: 'material' | 'wire' | 'matWire' | 'transparent' }): void;

  // ===== 캡처/렌더 ==============================================

  /** Unity `OnSetRenderCaptureFovCallback`. */
  onSetRenderCaptureFov?(result: HostResult, fov: number): void;

  /** Unity `OnSetRenderCaptureHeightCallback`. */
  onSetRenderCaptureHeight?(result: HostResult, height: number): void;

  /**
   * Unity `OnCaptureRenderImageCallback` — 캡처된 이미지(base64).
   * 본 콜백 직후 Snapit로 업로드하는 게 일반적.
   */
  onCaptureRenderImage?(result: HostResult, base64Jpg: string): void;

  /**
   * Unity의 `DownloadJpg` jslib 대응 — JPG 바이트를 브라우저 다운로드.
   *
   * 부모 호스트는 본 콜백에서 `<a download>` 트리거 또는 `URL.createObjectURL`을 사용.
   * 미구현 시 본 모듈이 직접 `Blob` 다운로드를 시도한다.
   */
  onDownloadJpg?(bytes: Uint8Array | Blob, filename: string): void;

  // ===== 평면도 편집 이벤트 =======================================

  /** Unity `OnDrawWallCallback` — 사용자가 벽 그리기를 완료한 직후. */
  onDrawWall?(result: HostResult, payload: Record<string, unknown>): void;

  /** Unity `OnFlipLayoutHorCallback`. */
  onFlipLayoutHorizontal?(result: HostResult): void;

  /** Unity `OnFlipLayoutVerCallback`. */
  onFlipLayoutVertical?(result: HostResult): void;

  /** Unity `OnRedoUndoCallback` (= `UndoRedoWebEventCallback`) — 커맨드 실행/되돌리기/다시. */
  onUndoRedo?(message: string): void;

  /** Unity `OnSpaceSelected` — 공간(방) 선택. */
  onSpaceSelected?(payload: {
    isSuccess: boolean;
    message: string;
    spaceName: string;
    floorThick: number | null;
  }): void;

  /** Unity `OnWallSegmentSelected` — 벽 세그먼트 선택. */
  onWallSegmentSelected?(payload: {
    wallType: string;
    wallThickMM: number;
    wallHeightMM: number;
    wallLengthMM: number;
  }): void;

  /** Unity `OnLevelSelected` — 층 선택 + 도면 속성(면적·천장 높이). */
  onLevelSelected?(result: HostResult, payload: Record<string, unknown>): void;
}