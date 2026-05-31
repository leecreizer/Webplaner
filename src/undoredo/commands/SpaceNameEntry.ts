import { Space } from '../../structures/Space';
import { useLayoutStore } from '../../structures/state';
import { WallPositionKey } from './WallPositionKey';

/**
 * 공간의 이름을 Undo/Redo 간에 보존하는 스냅샷.
 *
 * Unity `UndoRedo.Commands.SpaceNameEntry` (DrawWallCommand.cs:170) 1:1 포팅.
 *
 * 공간을 구성하는 벽의 좌표 키 집합으로 공간을 식별 — SpaceBuilder가 공간을 재생성한 후에도
 * 동일한 형태의 공간을 찾아 이름을 복원한다.
 */
export class SpaceNameEntry {
  private readonly _wallKeys: WallPositionKey[];
  private readonly _name: string;

  constructor(space: Space) {
    this._wallKeys = [];
    for (const [wall] of space.walls) {
      if (wall.startNode && wall.endNode) {
        this._wallKeys.push(new WallPositionKey(wall.startNode.position, wall.endNode.position));
      }
    }
    this._name = space.name;
  }

  /**
   * 현재 공간 목록 중 동일한 벽 구성을 가진 공간을 찾아 저장된 이름으로 복원한다.
   * 매칭 실패 시 조용히 무시.
   */
  tryRestore(): void {
    const matched = useLayoutStore.getState().spaces.find((s) => {
      if (s.walls.size !== this._wallKeys.length) return false;
      return this._wallKeys.every((key) => {
        const wall = key.findWall();
        return wall != null && s.walls.has(wall);
      });
    });
    if (matched) {
      matched.name = this._name;
    }
  }
}