/**
 * 모든 Undo/Redo 가능한 커맨드가 구현하는 인터페이스.
 *
 * Unity `UndoRedo.ICommand` 1:1 포팅.
 *
 * @see UndoRedoManager — 인스턴스를 스택에 푸시·팝하며 Execute/Undo/Redo를 호출한다.
 */
export interface ICommand {
  /** 처음 실행. Manager가 스택에 푸시하기 직전 호출한다. */
  execute(): void;
  /** Undo — 본 커맨드의 효과를 되돌린다. */
  undo(): void;
  /**
   * Redo — Undo된 커맨드를 다시 적용한다.
   *
   * 대부분 `execute()`를 그대로 호출해도 무방하지만, "최초 실행 시점에만 캡처되는 상태"가
   * 있는 커맨드(예: `DeleteAllWallsCommand`의 결과 스냅샷)는 별도 구현이 필요하다.
   */
  redo(): void;
}