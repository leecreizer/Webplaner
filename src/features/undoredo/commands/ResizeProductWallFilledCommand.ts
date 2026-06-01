import type { ICommand } from '../ICommand';
import { ProductWallFilledSnapshot } from './ProductWallFilledSnapshot';
import { WallPositionKey } from './WallPositionKey';

/**
 * 벽체 제품(문/창문) 크기 변경 커맨드.
 *
 * Unity `ResizeProductWallFilledCommand` 1:1 포팅. 크기 변경 직전/직후 스냅샷 스왑 패턴.
 * 부모 벽은 변경되지 않으므로 단일 `parentWallKey`만 보관.
 */
export class ResizeProductWallFilledCommand implements ICommand {
  private readonly _beforeSnapshot: ProductWallFilledSnapshot;
  private readonly _afterSnapshot: ProductWallFilledSnapshot;
  private readonly _parentWallKey: WallPositionKey;

  constructor(
    beforeSnapshot: ProductWallFilledSnapshot,
    afterSnapshot: ProductWallFilledSnapshot,
    parentWallKey: WallPositionKey,
  ) {
    this._beforeSnapshot = beforeSnapshot;
    this._afterSnapshot = afterSnapshot;
    this._parentWallKey = parentWallKey;
  }

  execute(): void {
    // no-op
  }

  undo(): void {
    const wall = this._parentWallKey.findWall();
    const filled = this._afterSnapshot.findInWall(wall);
    if (filled) filled.remove();
    if (wall) this._beforeSnapshot.restore(wall);
  }

  redo(): void {
    const wall = this._parentWallKey.findWall();
    const filled = this._beforeSnapshot.findInWall(wall);
    if (filled) filled.remove();
    if (wall) this._afterSnapshot.restore(wall);
  }
}