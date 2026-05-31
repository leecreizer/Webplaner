import type { ICommand } from '../ICommand';
import { ProductWallFilledSnapshot } from './ProductWallFilledSnapshot';
import { WallPositionKey } from './WallPositionKey';

/**
 * 벽체 제품(문/창문) 드래그 이동 커맨드.
 *
 * Unity `DragProductWallFilledCommand` 1:1 포팅.
 *
 * 이동 시작·종료 시점의 (스냅샷 + 벽 키)를 저장. 드래그가 끝난 시점에 생성되므로 `execute()`는 no-op.
 * Undo/Redo는 두 상태 사이를 스왑한다.
 */
export class DragProductWallFilledCommand implements ICommand {
  private readonly _beforeSnapshot: ProductWallFilledSnapshot;
  private readonly _beforeWallKey: WallPositionKey;
  private readonly _afterSnapshot: ProductWallFilledSnapshot;
  private readonly _afterWallKey: WallPositionKey;

  constructor(
    beforeSnapshot: ProductWallFilledSnapshot,
    beforeWallKey: WallPositionKey,
    afterSnapshot: ProductWallFilledSnapshot,
    afterWallKey: WallPositionKey,
  ) {
    this._beforeSnapshot = beforeSnapshot;
    this._beforeWallKey = beforeWallKey;
    this._afterSnapshot = afterSnapshot;
    this._afterWallKey = afterWallKey;
  }

  execute(): void {
    // no-op
  }

  undo(): void {
    // after 상태의 제품 제거 → before 상태 복원
    const afterWall = this._afterWallKey.findWall();
    const filled = this._afterSnapshot.findInWall(afterWall);
    if (filled) filled.remove();

    const beforeWall = this._beforeWallKey.findWall();
    if (beforeWall) this._beforeSnapshot.restore(beforeWall);
  }

  redo(): void {
    // before 상태의 제품 제거 → after 상태 복원
    const beforeWall = this._beforeWallKey.findWall();
    const filled = this._beforeSnapshot.findInWall(beforeWall);
    if (filled) filled.remove();

    const afterWall = this._afterWallKey.findWall();
    if (afterWall) this._afterSnapshot.restore(afterWall);
  }
}