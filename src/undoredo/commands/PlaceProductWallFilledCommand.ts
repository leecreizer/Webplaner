import type { ICommand } from '../ICommand';
import type { Wall } from '../../structures/Wall';
import type { ProductWallFilled } from '../../products/ProductWallFilled';
import { ProductWallFilledSnapshot } from './ProductWallFilledSnapshot';
import { WallPositionKey } from './WallPositionKey';

/**
 * 벽체 제품(문/창문) 배치 커맨드.
 *
 * Unity `PlaceProductWallFilledCommand` 1:1 포팅.
 *
 * 이미 배치가 완료된 상태에서 생성되므로 `execute()`는 no-op. Undo로 제품을 제거하고,
 * Redo로 스냅샷에서 복원한다.
 */
export class PlaceProductWallFilledCommand implements ICommand {
  private readonly _snapshot: ProductWallFilledSnapshot;
  private readonly _parentWallKey: WallPositionKey;

  constructor(filled: ProductWallFilled, parentWall: Wall) {
    if (!parentWall.startNode || !parentWall.endNode) {
      throw new Error('PlaceProductWallFilledCommand: parentWall has no start/end node');
    }
    this._snapshot = new ProductWallFilledSnapshot(filled);
    this._parentWallKey = new WallPositionKey(
      parentWall.startNode.position,
      parentWall.endNode.position,
    );
  }

  execute(): void {
    // no-op
  }

  undo(): void {
    const wall = this._parentWallKey.findWall();
    const filled = this._snapshot.findInWall(wall);
    if (filled) filled.remove();
  }

  redo(): void {
    const wall = this._parentWallKey.findWall();
    if (wall) this._snapshot.restore(wall);
  }
}