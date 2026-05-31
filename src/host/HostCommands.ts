import type { PlanSaveData } from '../saveload/PlanSaveData';
import type { PlaceProductParam } from '../products/ProductTypes';

/**
 * 부모 React 호스트 → HomePlanner3로 보내는 *incoming* 명령 인터페이스.
 *
 * Unity `WebEventHandler.cs` + `WebEventHandler.Layout.cs`의 public 메서드들을 모은 것.
 * 호스트가 `<HomePlanner3 ref={ref}>` 등으로 ref를 잡거나 {@link HostBridge}를 통해 직접 호출한다.
 *
 * 각 메서드의 동작은 기존 `useLayoutStore` / `UndoRedoManager` 등을 통해 도메인 상태를 변경한다.
 */
export interface HostCommands {
  // ===== 평면도 ================================================

  /**
   * 평면도 로드. 인자 없으면 기본 경로(저장된 JSON), 인자 있으면 그 JSON으로 복원.
   * Unity `LoadPlan(string)` 대응.
   */
  loadPlan(plan?: PlanSaveData | string): void;

  /** 현재 평면도 저장 — 직렬화된 JSON을 호스트에 전달. */
  savePlan(): void;

  /** 평면도 전체 삭제. Unity `DeletePlan` 대응. */
  deletePlan(): void;

  // ===== 모드 전환 ==============================================

  /** 평면도 그리기 모드. Unity `ChangeModeLayout` 대응. */
  changeModeLayout(): void;

  /** 상품 배치 모드. Unity `ChangeModeProduct` 대응. */
  changeModeProduct(): void;

  /**
   * 카메라 투영 전환 (Perspective ↔ Orthographic).
   * Unity `ToggleCameraProjection` 대응.
   */
  toggleCameraProjection(is2D: boolean): void;

  /** 렌더 모드 진입 — Snapit 렌더 캡처 준비. Unity `ActiveRenderMode` 대응. */
  activateRenderMode(): void;

  /** 렌더 모드 해제. Unity `DeactiveRenderMode` 대응. */
  deactivateRenderMode(): void;

  /** 와이어프레임 모드. Unity `SetWireModeTo*` 4종 대응. */
  setWireMode(mode: 'material' | 'wire' | 'matWire' | 'transparent'): void;

  // ===== 상품 ==================================================

  /** 바닥 상품 배치 시작. Unity `PlaceFloorProduct` 대응. */
  placeFloorProduct(): void;

  /** 천장 상품 배치 시작. Unity `PlaceCeilingProduct` 대응. */
  placeCeilingProduct(): void;

  /** 벽 상품 배치 시작. Unity `PlaceWallProduct` 대응. */
  placeWallProduct(): void;

  /** 카탈로그 상품을 직접 배치. Unity `PlaceProduct(jsonParam)` 대응. */
  placeProduct(param: PlaceProductParam): void;

  /** 문/창호 배치. Unity `PlaceWallFilled(jsonParam)` 대응. */
  placeWallFilled(param: PlaceProductParam): void;

  // ===== 평면도 편집 ============================================

  /** 벽 그리기 — JSON 형태의 세그먼트 데이터. Unity `DrawWall(jsonParam)` 대응. */
  drawWall(param: Record<string, unknown>): void;

  /** 공간 그리기. Unity `DrawSpace(jsonParam)` 대응. */
  drawSpace(param: Record<string, unknown>): void;

  /** 평면도 좌우 반전. */
  flipLayoutHorizontal(): void;

  /** 평면도 상하 반전. */
  flipLayoutVertical(): void;

  /** 공간 이름·단차 편집. Unity `EditSpace(jsonParam)` 대응. */
  editSpace(param: { spaceIndex: number; spaceName?: string; floorThickMM?: number }): void;

  /** 선택 해제. Unity `ReleaseSelectedObject` 대응. */
  releaseSelectedObject(): void;

  // ===== Undo/Redo =============================================

  /** Undo 실행. */
  undo(): void;

  /** Redo 실행. */
  redo(): void;

  // ===== 캡처 / 렌더 =============================================

  /** 캡처 FOV 설정. Unity `SetRenderCaptureFov` 대응. */
  setRenderCaptureFov(fov: number): void;

  /** 캡처 카메라 높이 설정. Unity `SetRenderCaptureHeight` 대응. */
  setRenderCaptureHeight(height: number): void;

  /**
   * 현재 화면을 캡처하여 base64 JPG로 호스트에 전달.
   * Unity `CaptureRenderImage` → `onCaptureRenderImage` 콜백.
   */
  captureRenderImage(): Promise<void>;

  // ===== UI 제어 ===============================================

  /** Unity의 내부 UGUI 숨기기. Three.js에서는 r3f가 직접 UI를 안 가지므로 no-op일 수 있다. */
  hideUGUI?(): void;
}