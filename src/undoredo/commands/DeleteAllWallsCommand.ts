import type { ICommand } from '../ICommand';
import { Space } from '../../structures/Space';
import { useLayoutStore, layoutRegistry } from '../../structures/state';
import { SpaceManager } from '../../layout/SpaceManager';
import { buildSpaces } from '../../layout/SpaceBuilder';
import { WallSnapshot } from './WallSnapshot';
import { SpaceNameEntry } from './SpaceNameEntry';

/**
 * 전체 벽 삭제 커맨드.
 *
 * Unity `UndoRedo.Commands.DeleteAllWallsCommand` 1:1 포팅. SplitResolver가 관여하지 않아
 * 구조가 단순하다.
 *
 * - **execute**: 현재 모든 벽 스냅샷 저장 → SpaceManager.clearWalls()
 * - **undo**: 저장된 스냅샷으로 모든 벽 복원 → buildSpaces() → 공간 이름 복원
 * - **redo**: execute() 재호출 (스냅샷 갱신 후 전체 삭제)
 */
export class DeleteAllWallsCommand implements ICommand {
  private _wallSnapshots: WallSnapshot[] = [];
  private _spaceNamesBeforeCommand: SpaceNameEntry[] = [];
  /** 첫 execute 완료 후 결과 공간 이름 스냅샷. 두 번째 이후 redo에서 재사용. */
  private _spaceNamesAfterCommand: SpaceNameEntry[] | null = null;

  execute(): void {
    // execute 직전 현재 공간 이름 저장 (undo 후 복원에 사용)
    this._spaceNamesBeforeCommand = useLayoutStore
      .getState()
      .spaces.map((s) => new SpaceNameEntry(s));

    // clearWalls 호출 전에 스냅샷 저장 (Wall.delete가 startNode/endNode를 null로 만들기 때문)
    this._wallSnapshots = useLayoutStore.getState().walls.map((w) => new WallSnapshot(w));

    SpaceManager.clearWalls();

    if (this._spaceNamesAfterCommand === null) {
      this._spaceNamesAfterCommand = useLayoutStore
        .getState()
        .spaces.map((s) => new SpaceNameEntry(s));
    }
  }

  undo(): void {
    const savedSpaceNo = Space.saveSpaceNo();

    for (const snap of this._wallSnapshots) {
      snap.restore();
    }

    // 모든 벽 재생성 후 공간 자동 검출
    if (useLayoutStore.getState().walls.length > 0) {
      buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
    }

    // execute 직전 이름 복원
    for (const entry of this._spaceNamesBeforeCommand) {
      entry.tryRestore();
    }

    Space.restoreSpaceNo(savedSpaceNo);

    // TODO(port): WallNodeSymbol.createForAllNodes() — Symbols 모듈 포팅 후
  }

  redo(): void {
    const savedSpaceNo = Space.saveSpaceNo();
    this.execute();
    Space.restoreSpaceNo(savedSpaceNo);

    if (this._spaceNamesAfterCommand) {
      for (const entry of this._spaceNamesAfterCommand) {
        entry.tryRestore();
      }
    }
  }
}