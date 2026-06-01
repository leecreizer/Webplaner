import type { ICommand } from '../ICommand';
import { Space } from '@/domain/structures/Space';
import { useLayoutStore } from '@/domain/state/layoutStore';
import { WallPositionKey } from './WallPositionKey';

/**
 * 공간 이름 변경 커맨드.
 *
 * Unity `UndoRedo.Commands.RenameSpaceCommand` 1:1 포팅.
 *
 * Space 참조 대신 벽 좌표 키 집합으로 공간을 식별 — 이후 DrawWall/DeleteWall 등의 Undo/Redo로
 * Space가 destroy→재생성되어도 동일한 형태의 공간을 안전하게 찾아 이름을 적용한다.
 */
export class RenameSpaceCommand implements ICommand {
  private readonly _oldName: string;
  private readonly _newName: string;
  private readonly _spaceWallKeys: WallPositionKey[];

  /**
   * @param space 이름을 변경할 공간
   * @param newName 변경할 이름
   */
  constructor(space: Space, newName: string) {
    this._oldName = space.name;
    this._newName = newName;
    this._spaceWallKeys = [];
    for (const [wall] of space.walls) {
      if (wall.startNode && wall.endNode) {
        this._spaceWallKeys.push(
          new WallPositionKey(wall.startNode.position, wall.endNode.position),
        );
      }
    }
  }

  execute(): void {
    this._setName(this._newName);
  }

  undo(): void {
    this._setName(this._oldName);
  }

  redo(): void {
    this.execute();
  }

  /** 벽 좌표 키 집합으로 공간을 식별해 이름을 설정한다. */
  private _setName(name: string): void {
    const resolvedWalls = this._spaceWallKeys.map((key) => key.findWall());
    if (resolvedWalls.some((w) => w == null)) return;

    const wallSet = new Set(resolvedWalls);
    const target = useLayoutStore.getState().spaces.find((s) => {
      if (s.walls.size !== wallSet.size) return false;
      for (const w of wallSet) {
        if (!w || !s.walls.has(w)) return false;
      }
      return true;
    });
    if (target) target.name = name;
  }
}