import { create } from 'zustand';
import type { ICommand } from './ICommand';

/**
 * Undo/Redo 스택 관리자.
 *
 * Unity `UndoRedo.UndoRedoManager` 1:1 포팅. 차이점:
 * - 싱글톤이 아닌 **Zustand 스토어**로 상태를 노출 — UI 컴포넌트가 `useUndoRedoStore`로 구독하면
 *   `canUndo`/`canRedo` 버튼 활성 상태가 자동 반응한다.
 * - Unity의 `WebEventHandler.Instance.UndoRedoWebEventCallback(...)`은 부모 React 호스트로의
 *   브로드캐스트였는데, 본 포팅에서는 {@link UndoRedoManager.onChange} 콜백으로 노출 —
 *   호스트 측이 원하는 메시지를 자유롭게 보낸다.
 *
 * ### 사용
 * ```ts
 * import { UndoRedoManager } from '@/undoredo/UndoRedoManager';
 * UndoRedoManager.executeCommand(new RenameSpaceCommand(space, '거실'));
 * // ...
 * UndoRedoManager.undo();
 * UndoRedoManager.redo();
 * ```
 */

/** UI 구독용 상태. */
interface UndoRedoState {
  /** 마지막 실행 이벤트 식별자 — 변경될 때마다 구독자에게 알림이 간다. */
  version: number;
  canUndo: boolean;
  canRedo: boolean;
}

export const useUndoRedoStore = create<UndoRedoState>(() => ({
  version: 0,
  canUndo: false,
  canRedo: false,
}));

/**
 * Undo/Redo 커맨드 이력 정적 매니저.
 *
 * 모든 메서드는 정적이며, 내부 스택은 모듈 스코프에서 관리된다.
 */
export class UndoRedoManager {
  /** 보관할 최대 이력 수. 초과 시 가장 오래된 항목이 제거된다. Unity 원본과 동일. */
  static maxHistoryCount = 50;

  /**
   * 모든 변화 후 호출되는 외부 콜백 (예: 부모 React 호스트 이벤트 브로드캐스트).
   *
   * Unity 원본 `WebEventHandler.Instance.UndoRedoWebEventCallback(string)` 대체.
   * 인자 형식은 `"커맨드명 Done"` 또는 `"UndoRedo Clear"`.
   */
  static onChange: ((message: string) => void) | null = null;

  /** Undo 실행 직후 호출되는 콜백. */
  static onUndo: ((command: ICommand) => void) | null = null;

  /** Redo 실행 직후 호출되는 콜백. */
  static onRedo: ((command: ICommand) => void) | null = null;

  private static _undoStack: ICommand[] = [];
  private static _redoStack: ICommand[] = [];

  /** Undo 가능 여부. */
  static get canUndo(): boolean {
    return UndoRedoManager._undoStack.length > 0;
  }

  /** Redo 가능 여부. */
  static get canRedo(): boolean {
    return UndoRedoManager._redoStack.length > 0;
  }

  /** 커맨드를 실행하고 Undo 스택에 푸시한다. */
  static executeCommand(command: ICommand): void {
    command.execute();
    UndoRedoManager.pushCommand(command);
  }

  /** 이미 실행된 커맨드를 Undo 스택에만 등록한다 (Manager의 Execute 우회용). */
  static pushCommand(command: ICommand): void {
    UndoRedoManager._undoStack.push(command);
    UndoRedoManager._redoStack.length = 0;
    UndoRedoManager._trimHistory();
    UndoRedoManager._notify(`${command.constructor.name} Done`);
  }

  /** 가장 최근 커맨드를 되돌리고 Redo 스택으로 이동한다. */
  static undo(): void {
    if (!UndoRedoManager.canUndo) return;
    const command = UndoRedoManager._undoStack.pop()!;
    command.undo();
    UndoRedoManager._redoStack.push(command);
    UndoRedoManager.onUndo?.(command);
    UndoRedoManager._notify(`${command.constructor.name} Done`);
  }

  /** 가장 최근 되돌린 커맨드를 다시 실행하고 Undo 스택으로 이동한다. */
  static redo(): void {
    if (!UndoRedoManager.canRedo) return;
    const command = UndoRedoManager._redoStack.pop()!;
    command.redo();
    UndoRedoManager._undoStack.push(command);
    UndoRedoManager.onRedo?.(command);
    UndoRedoManager._notify(`${command.constructor.name} Done`);
  }

  /** Undo/Redo 스택을 모두 비운다. */
  static clear(): void {
    UndoRedoManager._undoStack.length = 0;
    UndoRedoManager._redoStack.length = 0;
    UndoRedoManager._notify('UndoRedo Clear');
  }

  /** 현재 Undo 가능한 마지막 커맨드 (있으면). 디버깅·UI 표시용. */
  static peekUndo(): ICommand | undefined {
    return UndoRedoManager._undoStack[UndoRedoManager._undoStack.length - 1];
  }

  /** 현재 Redo 가능한 마지막 커맨드. */
  static peekRedo(): ICommand | undefined {
    return UndoRedoManager._redoStack[UndoRedoManager._redoStack.length - 1];
  }

  /** maxHistoryCount 초과 시 가장 오래된 항목을 잘라낸다. */
  private static _trimHistory(): void {
    while (UndoRedoManager._undoStack.length > UndoRedoManager.maxHistoryCount) {
      UndoRedoManager._undoStack.shift();
    }
  }

  /** 스토어와 외부 콜백에 변경을 알린다. */
  private static _notify(message: string): void {
    useUndoRedoStore.setState((s) => ({
      version: s.version + 1,
      canUndo: UndoRedoManager.canUndo,
      canRedo: UndoRedoManager.canRedo,
    }));
    UndoRedoManager.onChange?.(message);
  }
}