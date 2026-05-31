import type { ICommand } from '../ICommand';
import type { ProductWallFilled } from '../../products/ProductWallFilled';
import { ProductWallFilledSnapshot } from './ProductWallFilledSnapshot';
import { WallPositionKey } from './WallPositionKey';

/**
 * 벽체 제품(문/창문) 삭제 커맨드.
 *
 * Unity `DeleteProductWallFilledCommand` 1:1 포팅.
 *
 * Execute에서 실제로 삭제하고, Undo에서 스냅샷으로 복원한다.
 */
export class DeleteProductWallFilledCommand implements ICommand {
  private readonly _snapshot: ProductWallFilledSnapshot;
  private readonly _parentWallKey: WallPositionKey;

  constructor(filled: ProductWallFilled) {
    if (!filled.parent || !filled.parent.startNode || !filled.parent.endNode) {
      throw new Error('DeleteProductWallFilledCommand: filled has no valid parent wall');
    }
    this._snapshot = new ProductWallFilledSnapshot(filled);
    this._parentWallKey = new WallPositionKey(
      filled.parent.startNode.position,
      filled.parent.endNode.position,
    );
  }

  execute(): void {
    const wall = this._parentWallKey.findWall();
    const filled = this._snapshot.findInWall(wall);
    if (filled) filled.remove();
  }

  undo(): void {
    const wall = this._parentWallKey.findWall();
    if (wall) this._snapshot.restore(wall);
  }

  redo(): void {
    this.execute();
  }
}