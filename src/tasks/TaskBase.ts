/**
 * 코루틴 기반 태스크의 기본 베이스.
 *
 * Unity `Framework.Task.YieldTask` + `TaskBase` 1:1 포팅. Unity의 `IEnumerator` 패턴이
 * JavaScript의 generator(`function*`/`yield`)로 자연스럽게 매핑된다.
 *
 * ### 매핑
 * - C# `IEnumerator MoveNext()` ↔ JS `Iterator.next()` (`{ value, done }`)
 * - C# `yield return X;` ↔ JS `yield X;` (또는 Promise-기반 `await`)
 * - C# `IDisposable.Dispose()` ↔ TS `dispose()`
 */
export class TaskBase implements Disposable {
  /** 태스크의 generator(또는 iterator). */
  protected _routine: Iterator<unknown> | null = null;

  /** 태스크의 종료 여부 플래그. */
  protected _bQuit: boolean = false;

  constructor(routine: Iterator<unknown> | null = null) {
    this._routine = routine;
  }

  /**
   * 태스크를 다음 단계로 진행한다.
   *
   * @returns 태스크가 계속 진행 가능하면 true, 완료되었으면 false.
   */
  moveNext(): boolean {
    if (this._routine === null) return false;
    const result = this._routine.next();
    return !result.done;
  }

  /** 태스크가 종료되었는지 확인한다. */
  isQuit(): boolean {
    return this._bQuit;
  }

  /** 태스크를 종료 상태로 설정한다. */
  quitTask(): void {
    this._bQuit = true;
  }

  /** 태스크 시작 훅 — 하위 클래스에서 재정의. */
  start(): void {}

  /** 리소스 해제. */
  dispose(): void {
    this._routine = null;
  }

  /** TS 5+ Disposable 패턴 (using/await using). */
  [Symbol.dispose](): void {
    this.dispose();
  }
}