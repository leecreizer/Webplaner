import { TaskUnit } from './TaskUnit';

/**
 * 부모 태스크에 종속된 서브태스크.
 *
 * Unity `SubTaskUnit` 1:1 포팅. 부모 참조만 추가한다.
 *
 * @example
 * ```ts
 * class SubTask2DModeIdle extends SubTaskUnit { ... }
 * const sub = new SubTask2DModeIdle(parent);
 * ```
 */
export class SubTaskUnit extends TaskUnit {
  protected _parentTask: TaskUnit;

  constructor(parentTask: TaskUnit, routine?: Iterator<unknown> | null) {
    super(routine);
    this._parentTask = parentTask;
  }

  /** 부모 태스크 (protected 접근자 외부 노출용). */
  get parentTask(): TaskUnit {
    return this._parentTask;
  }
}