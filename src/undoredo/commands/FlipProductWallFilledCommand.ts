import type { ICommand } from '../ICommand';
import { ProductWallFilledSnapshot } from './ProductWallFilledSnapshot';
import { WallPositionKey } from './WallPositionKey';

/**
 * 벽체 제품(문/창문) Flip 커맨드.
 *
 * Unity `FlipProductWallFilledCommand` 1:1 포팅. Drag와 동일한 before/after 스왑 패턴.
 */
export class FlipProductWallFilledCommand implements ICommand {
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
    const afterWall = this._afterWallKey.findWall();
    const filled = this._afterSnapshot.findInWall(afterWall);
    if (filled) filled.remove();

    const beforeWall = this._beforeWallKey.findWall();
    if (beforeWall) this._beforeSnapshot.restore(beforeWall);
  }

  redo(): void {
    const beforeWall = this._beforeWallKey.findWall();
    const filled = this._beforeSnapshot.findInWall(beforeWall);
    if (filled) filled.remove();

    const afterWall = this._afterWallKey.findWall();
    if (afterWall) this._afterSnapshot.restore(afterWall);
  }
}