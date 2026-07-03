import type { ICommand } from '../ICommand';
import { Space } from '@/domain/structures/Space';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { SpaceManager } from '@/domain/layout/SpaceManager';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { isModuleWall, syncModuleWalls } from '@/features/spaceModules/syncModuleWalls';
import { WallSnapshot } from './WallSnapshot';
import { SpaceNameEntry } from './SpaceNameEntry';

/**
 * 전체 벽 삭제 커맨드.
 *
 * Unity `UndoRedo.Commands.DeleteAllWallsCommand` 1:1 포팅. SplitResolver가 관여하지 않아
 * 구조가 단순하다.
 *
 * - **execute**: 현재 "그린" 벽(모듈발 벽 제외) 스냅샷 저장 → SpaceManager.clearWalls() → syncModuleWalls()
 * - **undo**: 저장된 스냅샷으로 그린 벽만 복원 → buildSpaces() → syncModuleWalls() → 공간 이름 복원
 * - **redo**: execute() 재호출 (스냅샷 갱신 후 전체 삭제)
 *
 * 모듈발 벽(syncModuleWalls의 MODULE_TAG)은 SpaceManager.clearWalls()가 무차별로 지워버리므로
 * "전체 삭제"의 의미를 "사용자가 그린 벽만 삭제, 모듈은 유지"로 해석한다. 모듈 자체를
 * 지우고 싶다면 모듈 UI에서 개별적으로 삭제하면 된다. 이렇게 하지 않으면 clearWalls() 직후
 * 모듈에서 파생된 슬래브/개구부가 벽 없이 렌더링되고, undo 시 모듈 벽이 태그 없는 "그린 벽"으로
 * 복원되어 다음 모듈 동기화에서 중복 생성된다.
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
    // 모듈발 벽은 제외 — syncModuleWalls()가 재생성을 책임지므로 그린 벽만 undo 대상으로 삼는다.
    this._wallSnapshots = useLayoutStore
      .getState()
      .walls.filter((w) => !isModuleWall(w))
      .map((w) => new WallSnapshot(w));

    SpaceManager.clearWalls();

    // 모듈발 벽 즉시 재동기화 — clearWalls()가 모듈 벽까지 지웠으므로 모듈 슬래브가
    // 벽 없이 남지 않도록 바로 재생성한다.
    syncModuleWalls();

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

    // 모듈발 벽 재동기화 — execute()에서 이미 존재하지만 syncModuleWalls()는 멱등이므로
    // (태그된 벽 삭제 후 재생성) 안전하게 다시 호출해 그린 벽 복원과의 정합성을 보장한다.
    syncModuleWalls();

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