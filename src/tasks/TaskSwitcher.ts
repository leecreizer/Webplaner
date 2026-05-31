import type { TaskClass, TaskUnit } from './TaskUnit';

/**
 * 태스크 간 전환을 관리하는 매니저.
 *
 * Unity `Framework.Task.TaskSwitcher` 1:1 포팅. C#의 `typeof(T)` 기반 dictionary가
 * 클래스 생성자 자체를 key로 쓰는 `Map<TaskClass, TaskUnit>`로 매핑된다.
 *
 * ### 사용
 * ```ts
 * const switcher = new TaskSwitcher();
 * switcher.setTask(MyTaskA, () => new MyTaskA());
 * switcher.setTask(MyTaskB, () => new MyTaskB());
 * switcher.switchTask(MyTaskA);
 * // 매 프레임:
 * switcher.update();
 * ```
 */
export class TaskSwitcher {
  private readonly _mapTasks: Map<TaskClass, TaskUnit> = new Map();
  private _activeTask: TaskUnit | null = null;

  /**
   * 태스크 등록 — 팩토리 함수로 lazy 생성된 인스턴스를 보관한다.
   *
   * Unity 원본은 `Activator.CreateInstance(typeof(T))`로 reflection 호출했지만, TS는
   * 명시적 팩토리를 받는다 (생성자 인자 차이 처리에 더 안전).
   *
   * @param taskClass 등록할 태스크 클래스 (key)
   * @param factory 인스턴스 생성 팩토리
   */
  setTask<T extends TaskUnit>(taskClass: TaskClass<T>, factory: () => T): void {
    if (this._mapTasks.has(taskClass)) return;
    this._mapTasks.set(taskClass, factory());
  }

  /** 현재 활성 태스크. */
  getCurrentTask(): TaskUnit | null {
    return this._activeTask;
  }

  /** 지정된 클래스의 등록된 태스크 인스턴스를 가져온다. */
  getTask<T extends TaskUnit>(taskClass: TaskClass<T>): T | null {
    return (this._mapTasks.get(taskClass) as T) ?? null;
  }

  /** 지정된 클래스의 태스크로 전환. */
  switchTask<T extends TaskUnit>(taskClass: TaskClass<T>): void {
    if (!this._mapTasks.has(taskClass)) return;

    const taskNext = this._mapTasks.get(taskClass)!;
    if (this._activeTask !== null) {
      // 다음 태스크로 매개변수 전달
      taskNext.taskParams = this._activeTask.paramsReserveTask;
      this._activeTask.onLeave();
    }

    taskNext.reset();
    this._activeTask = taskNext;
    this._activeTask.onEnter();
  }

  /**
   * 매 프레임 업데이트 — 활성 태스크 진행 + 완료 시 예약된 다음 태스크로 자동 전환.
   * Unity 원본은 Update()였으나 TS에서는 명시적으로 호출.
   */
  update(): void {
    if (this._activeTask === null) return;

    if (!this._activeTask.moveNext()) {
      const nextClass = this._activeTask.typeReserveTask;
      if (nextClass === null) {
        this._activeTask = null;
        return;
      }
      this.switchTask(nextClass);
    }
  }

  /** 현재 활성 태스크 해제 (다음 update에서 작업 안 함). */
  clearCurrentTask(): void {
    this._activeTask = null;
  }
}