import type { HostEventHandlers, HostResult } from './HostEvents';
import type { HostCommands } from './HostCommands';
import type { PlanSaveData } from '../saveload/PlanSaveData';
import type { PlaceProductParam } from '../products/ProductTypes';
import { SpaceManager } from '../layout/SpaceManager';
import { UndoRedoManager } from '../undoredo/UndoRedoManager';
import { LoadPlanCommand } from '../undoredo/commands/LoadPlanCommand';
import { DeleteAllWallsCommand } from '../undoredo/commands/DeleteAllWallsCommand';
import { buildPlanData } from '../networking/RenderPlanBuilder';

/**
 * HomePlanner3 ↔ 부모 React 호스트 통신 브리지.
 *
 * Unity의 jslib + `WebEventHandler.cs`를 합친 역할을 한다:
 * - **호스트 → 도메인 (commands)**: 호스트가 본 클래스의 메서드를 호출 → `useLayoutStore`/
 *   `UndoRedoManager` 등을 통해 도메인 상태 변경
 * - **도메인 → 호스트 (events)**: 도메인 코드가 `bridge.emit*()` 호출 → 등록된 핸들러로 콜백
 *
 * 사용 패턴:
 * ```tsx
 * const bridge = new HostBridge({
 *   onLoadedPlan: (res, plan) => console.log('loaded', plan),
 *   onProductSelected: (res, attr) => updateUI(attr),
 * });
 * // 호스트가 명령:
 * bridge.loadPlan(myPlanJson);
 * // 도메인이 이벤트 발행:
 * bridge.emitProductSelected({ resultCd: '0000', resultDesc: 'OK' }, contentsAttr);
 * ```
 *
 * 본 클래스는 일반적으로 **App 최상단에서 1개 인스턴스**만 만들고 React Context로 전달한다.
 */
export class HostBridge implements HostCommands {
  /** 등록된 outgoing 이벤트 핸들러. 부분 구현 허용. */
  readonly handlers: HostEventHandlers;

  constructor(handlers: HostEventHandlers = {}) {
    this.handlers = handlers;

    // UndoRedoManager의 onChange를 호스트의 onUndoRedo로 라우팅
    UndoRedoManager.onChange = (msg) => {
      this.emitUndoRedo(msg);
    };
  }

  // ============================================================
  // HostCommands 구현 — 부모 → 도메인
  // ============================================================

  loadPlan(plan?: PlanSaveData | string): void {
    if (plan === undefined) {
      // TODO(port): 호스트에서 저장된 plan을 가져오는 정책이 필요. 기본은 no-op.
      return;
    }
    UndoRedoManager.executeCommand(new LoadPlanCommand(plan));
  }

  savePlan(): void {
    const plan = buildPlanData();
    this.emitSavedPlan({ resultCd: '0000', resultDesc: 'OK' }, plan as unknown as Record<string, unknown>);
  }

  deletePlan(): void {
    UndoRedoManager.executeCommand(new DeleteAllWallsCommand());
    this.emitDeletedPlan({ resultCd: '0000', resultDesc: 'OK' });
  }

  changeModeLayout(): void {
    // TODO(port): 모드 전환 자체는 호스트가 r3f Canvas의 상태로 관리. 본 메서드는 호스트에 알림.
    this.emit('onModeChangedLayout', { isLayoutMode: true });
  }

  changeModeProduct(): void {
    this.emit('onModeChangedProduct', { isProductMode: true });
  }

  toggleCameraProjection(is2D: boolean): void {
    // TODO(port): r3f의 카메라 토글 — Canvas 컴포넌트가 카메라 prop을 바꿈
    this.emitCameraProjectionChanged({ resultCd: '0000', resultDesc: 'OK' }, is2D);
  }

  activateRenderMode(): void {
    this.emitRenderModeActivated({ resultCd: '0000', resultDesc: 'OK' });
  }

  deactivateRenderMode(): void {
    this.emitRenderModeDeactivated({ resultCd: '0000', resultDesc: 'OK' });
  }

  setWireMode(mode: 'material' | 'wire' | 'matWire' | 'transparent'): void {
    this.emit('onWireModeChanged', { mode });
  }

  placeFloorProduct(): void {
    // TODO(port): 도메인에서 SubTaskPlaceFloor* 진입 — Tasks 구체 SubTask 포팅 후
  }

  placeCeilingProduct(): void {
    // TODO(port): 위와 동일
  }

  placeWallProduct(): void {
    // TODO(port): 위와 동일
  }

  placeProduct(_param: PlaceProductParam): void {
    // TODO(port): SubTaskPlaceProductSurface 진입 — Tasks 구체 SubTask 포팅 후
  }

  placeWallFilled(_param: PlaceProductParam): void {
    // TODO(port): SubTaskPlaceProductWallFilled 진입
  }

  drawWall(_param: Record<string, unknown>): void {
    // TODO(port): SubTaskDrawWall 진입
  }

  drawSpace(_param: Record<string, unknown>): void {
    // TODO(port): SubTaskDrawSpace 진입
  }

  flipLayoutHorizontal(): void {
    SpaceManager.flipHorizontal();
    this.emitFlipLayoutHorizontal({ resultCd: '0000', resultDesc: 'OK' });
  }

  flipLayoutVertical(): void {
    SpaceManager.flipVertical();
    this.emitFlipLayoutVertical({ resultCd: '0000', resultDesc: 'OK' });
  }

  editSpace(_param: { spaceIndex: number; spaceName?: string; floorThickMM?: number }): void {
    // TODO(port): RenameSpaceCommand + floorThick 변경
  }

  releaseSelectedObject(): void {
    // TODO(port): 선택 상태 store에서 클리어
  }

  undo(): void {
    UndoRedoManager.undo();
  }

  redo(): void {
    UndoRedoManager.redo();
  }

  setRenderCaptureFov(fov: number): void {
    // TODO(port): 카메라 fov 적용 (CameraFov.ts 사용)
    this.emitSetRenderCaptureFov({ resultCd: '0000', resultDesc: 'OK' }, fov);
  }

  setRenderCaptureHeight(height: number): void {
    // TODO(port): 카메라 Y 위치 조정
    this.emitSetRenderCaptureHeight({ resultCd: '0000', resultDesc: 'OK' }, height);
  }

  async captureRenderImage(): Promise<void> {
    // TODO(port): r3f Canvas의 `gl.domElement.toDataURL('image/jpeg')` 사용 — Canvas ref 필요.
    // 호스트가 Canvas ref를 등록해두면 본 메서드가 실제 캡처 가능.
    this.emitCaptureRenderImage({ resultCd: '0000', resultDesc: 'OK' }, '');
  }

  hideUGUI(): void {
    // r3f에는 자체 UGUI가 없음. no-op.
  }

  // ============================================================
  // 도메인 → 호스트 — emit* 메서드들
  // ============================================================

  /** 일반 emit 헬퍼 — 등록된 핸들러가 있으면 호출. */
  private emit<K extends keyof HostEventHandlers>(
    name: K,
    ...args: Parameters<NonNullable<HostEventHandlers[K]>>
  ): void {
    const fn = this.handlers[name];
    if (typeof fn === 'function') {
      // TypeScript는 핸들러 시그니처를 통일하기 어려워 cast 사용
      (fn as (...a: unknown[]) => void)(...args);
    }
  }

  emitLoadedPlan(result: HostResult, plan: PlanSaveData): void {
    this.emit('onLoadedPlan', result, plan);
  }

  emitSavedPlan(result: HostResult, payload: Record<string, unknown>): void {
    this.emit('onSavedPlan', result, payload);
  }

  emitDeletedPlan(result: HostResult): void {
    this.emit('onDeletedPlan', result);
  }

  emitPlaceFloorProduct(result: HostResult, product: PlaceProductParam): void {
    this.emit('onPlaceFloorProduct', result, product);
  }

  emitPlaceCeilingProduct(result: HostResult, product: PlaceProductParam): void {
    this.emit('onPlaceCeilingProduct', result, product);
  }

  emitPlaceWallProduct(result: HostResult, product: PlaceProductParam): void {
    this.emit('onPlaceWallProduct', result, product);
  }

  emitPlaceWallFilled(result: HostResult, payload: Record<string, unknown>): void {
    this.emit('onPlaceWallFilled', result, payload);
  }

  emitProductSelected(
    result: HostResult,
    contentsAttrib: {
      contentsCD: string | null;
      length: number;
      depth: number;
      height: number;
      placeHeight: number;
    },
  ): void {
    this.emit('onProductSelected', result, contentsAttrib);
  }

  emitCameraProjectionChanged(result: HostResult, is2D: boolean): void {
    this.emit('onCameraProjectionChanged', result, is2D);
  }

  emitRenderModeActivated(result: HostResult): void {
    this.emit('onRenderModeActivated', result);
  }

  emitRenderModeDeactivated(result: HostResult): void {
    this.emit('onRenderModeDeactivated', result);
  }

  emitSetRenderCaptureFov(result: HostResult, fov: number): void {
    this.emit('onSetRenderCaptureFov', result, fov);
  }

  emitSetRenderCaptureHeight(result: HostResult, height: number): void {
    this.emit('onSetRenderCaptureHeight', result, height);
  }

  emitCaptureRenderImage(result: HostResult, base64Jpg: string): void {
    this.emit('onCaptureRenderImage', result, base64Jpg);
  }

  emitDrawWall(result: HostResult, payload: Record<string, unknown>): void {
    this.emit('onDrawWall', result, payload);
  }

  emitFlipLayoutHorizontal(result: HostResult): void {
    this.emit('onFlipLayoutHorizontal', result);
  }

  emitFlipLayoutVertical(result: HostResult): void {
    this.emit('onFlipLayoutVertical', result);
  }

  emitUndoRedo(message: string): void {
    this.emit('onUndoRedo', message);
  }

  emitSpaceSelected(payload: {
    isSuccess: boolean;
    message: string;
    spaceName: string;
    floorThick: number | null;
  }): void {
    this.emit('onSpaceSelected', payload);
  }

  emitWallSegmentSelected(payload: {
    wallType: string;
    wallThickMM: number;
    wallHeightMM: number;
    wallLengthMM: number;
  }): void {
    this.emit('onWallSegmentSelected', payload);
  }

  emitLevelSelected(result: HostResult, payload: Record<string, unknown>): void {
    this.emit('onLevelSelected', result, payload);
  }

  /**
   * JPG 다운로드 — 호스트가 직접 처리할 수 있으면 핸들러 호출, 아니면 본 메서드가 표준 download anchor 처리.
   *
   * Unity `CameraCaptureBridge.DownloadJpg` 대응.
   */
  downloadJpg(bytes: Uint8Array | Blob, filename: string): void {
    if (this.handlers.onDownloadJpg) {
      this.handlers.onDownloadJpg(bytes, filename);
      return;
    }
    // 기본 처리: Blob URL + anchor click
    const blob =
      bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}