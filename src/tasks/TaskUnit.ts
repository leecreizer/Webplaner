import { TaskBase } from './TaskBase';
import { TaskSwitcher } from './TaskSwitcher';

/**
 * 태스크 매개변수의 추상 베이스. 구체 SubTask가 자체 Params 인터페이스를 정의해 상속한다.
 * Unity `TaskUnit.TaskParams` 1:1 포팅.
 */
export abstract class TaskParams {
  // 마커 클래스 — 모든 Params는 본 클래스를 상속한다.
}

/**
 * 클래스 생성자 타입. `TaskSwitcher`의 type-key 등록에 사용.
 */
export type TaskClass<T extends TaskUnit = TaskUnit> = new (...args: never[]) => T;

/**
 * 개별 태스크 단위. `TaskBase`를 상속하며 서브태스크 관리를 포함한다.
 *
 * Unity `Framework.Task.TaskUnit` 1:1 포팅. 차이점:
 * - C# `typeof(T)`을 type-key로 쓰는 부분이 TS에서는 클래스 생성자 자체를 key로 사용
 * - 코루틴 `IsDone()` 패턴은 `_routine = this._isDoneIterator()`로 옮김 (generator)
 */
export class TaskUnit extends TaskBase {
  protected _clickOverUI: boolean = false;
  protected _enabledInterrupt: boolean = true;

  /** 앞으로 전환할 태스크의 클래스. */
  typeReserveTask: TaskClass | null = null;

  /** 앞으로 전환할 태스크의 매개변수. */
  paramsReserveTask: TaskParams | null = null;

  /** 서브태스크 전환 매니저. */
  protected _subTaskSwitcher: TaskSwitcher = new TaskSwitcher();

  /** 현재 태스크의 매개변수. */
  taskParams: TaskParams | null = null;

  constructor(routine?: Iterator<unknown> | null) {
    super(routine ?? null);
    if (routine === undefined || routine === null) {
      this._routine = this._isDoneIterator();
    }
  }

  /** 지정된 타입의 서브태스크로 전환. */
  switchSubTask<T extends TaskUnit>(taskClass: TaskClass<T>): void {
    this._subTaskSwitcher.switchTask(taskClass);
  }

  /** 지정된 타입의 등록된 서브태스크를 가져온다. */
  getSubTask<T extends TaskUnit>(taskClass: TaskClass<T>): T | null {
    return this._subTaskSwitcher.getTask(taskClass);
  }

  /**
   * Parent 의 SubTask를 종료하고 다음 SubTask로 전환을 예약한다.
   * Unity `QuitSubTask` 대응.
   */
  quitSubTask<T extends TaskUnit>(
    nextTaskClass: TaskClass<T>,
    taskParams: TaskParams | null = null,
  ): void {
    this._subTaskSwitcher.getCurrentTask()?.quit(nextTaskClass, taskParams);
  }

  /** 태스크 상태 초기화. */
  reset(): void {
    this._bQuit = false;
    this._clickOverUI = false;
    this.typeReserveTask = null;
    this.paramsReserveTask = null;
    this._subTaskSwitcher.clearCurrentTask();
    this._routine = this._isDoneIterator();
  }

  /** 매 프레임 진행 — 서브태스크 업데이트 + 본 태스크 진행. */
  override moveNext(): boolean {
    this._subTaskSwitcher.update();
    return super.moveNext();
  }

  /**
   * 종료될 때까지 매 프레임 `loopRoutine()`을 호출하는 기본 코루틴.
   * 하위 클래스가 자체 코루틴을 쓰지 않으면 본 코루틴이 default.
   */
  private *_isDoneIterator(): Generator<boolean, void, unknown> {
    while (!this._bQuit) {
      this.loopRoutine();
      yield true;
    }
  }

  /** 매 프레임 호출되는 메인 루프 — 하위 클래스에서 재정의. */
  protected loopRoutine(): void {}

  /** 태스크 진입 시 — 활성 서브태스크의 onEnter도 함께 호출. */
  onEnter(): void {
    this._subTaskSwitcher.getCurrentTask()?.onEnter();
  }

  /** 태스크 종료 시 — 활성 서브태스크의 onLeave도 함께 호출. */
  onLeave(): void {
    this._subTaskSwitcher.getCurrentTask()?.onLeave();
  }

  /**
   * 본 태스크를 종료하고 같은 계층의 다음 태스크로 전환을 예약한다.
   * Unity `Quit<T>(params)` 대응.
   */
  quit<T extends TaskUnit>(
    nextTaskClass: TaskClass<T> | null,
    taskParams: TaskParams | null = null,
  ): void {
    this._bQuit = true;
    this.typeReserveTask = nextTaskClass;
    this.paramsReserveTask = taskParams;
  }

  /** 현재 진행 중인 비동기 작업 취소 — 하위 클래스 구현. */
  cancelTasking(): boolean {
    return false;
  }

  /** 외부에서의 인터럽트 허용 여부. */
  isEnableInterrupt(): boolean {
    return this._enabledInterrupt;
  }

  /** 현재 활성 서브태스크를 SubTaskUnit으로 반환 (없으면 null). */
  getCurrentTask(): TaskUnit | null {
    return this._subTaskSwitcher.getCurrentTask();
  }
}