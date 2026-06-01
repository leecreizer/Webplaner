import { Vector3 } from 'three';
import type { ICommand } from '../ICommand';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';
import { Space } from '@/domain/structures/Space';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { LayoutSplitWallsResolver } from '@/domain/layout/LayoutSplitWallsResolver';
import { EPSILON } from '@/lib/math/Math';
import { WallPositionKey } from './WallPositionKey';
import { WallSnapshot } from './WallSnapshot';
import { SpaceNameEntry } from './SpaceNameEntry';

/**
 * 노드 드래그 커맨드.
 *
 * Unity `UndoRedo.Commands.DragNodeCommand` 1:1 포팅. SubTaskDragNode가 드래그 완료 시
 * 생성한다. 다른 커맨드와 달리 두 가지를 동시에 추적:
 *
 * 1. 노드 이동으로 위치가 바뀐 벽들 (SplitResolver 없이도 위치 변동)
 * 2. SplitResolver로 생성/삭제된 벽들 (교차 발생 시)
 *
 * 이 때문에 SubTaskDragNode의 OnEnter 시점에 *이동 전* 벽 스냅샷을 미리 캡처해두고
 * 커맨드 생성 시 전달받아야 한다.
 *
 * ### 보류 (TODO)
 * - `LayoutSplitWallsResolver`의 minLengthSqr 상수 — Unity는 `Task2DModeIdle.WALL_MINLENGTH_SQR`
 *   (Tasks 모듈 포팅 후 import). 임시로 `0.01`(=10cm²) 사용.
 * - `WallNodeSymbol.createForAllNodes()` — Symbols 모듈 포팅 후
 */
export class DragNodeCommand implements ICommand {
  /** 분할 결과 세그먼트의 최소 길이 제곱(m²). TODO(port): Task2DModeIdle.WALL_MINLENGTH_SQR로 교체. */
  static MIN_LENGTH_SQR: number = 0.01;

  private readonly _originalPos: Vector3;
  private readonly _newPos: Vector3;
  private readonly _movedWallOriginalSnaps: readonly WallSnapshot[];

  /** 최초 Execute 시 이미 이동된 노드를 재활용 (사용 후 null). */
  private _preMovedNode: Node | null;

  private _splitCreatedKeys: WallPositionKey[] = [];
  private _survivingMovedWallKeys: WallPositionKey[] = [];
  private _splitDestroyedNonMovedSnaps: WallSnapshot[] = [];

  /** Execute 직전 공간 이름 스냅샷 (Undo 후 복원용). */
  private _spaceNamesBeforeCommand: SpaceNameEntry[] = [];

  /** 첫 Execute 완료 후 공간 이름 스냅샷 (Redo 시 사용). */
  private _spaceNamesAfterCommand: SpaceNameEntry[] | null = null;

  /**
   * @param movedNode 이미 이동 완료된 드래그 대상 노드
   * @param originalPos 드래그 시작 위치 (SubTaskDragNode.onEnter 시점 캡처)
   * @param movedWallOriginalSnaps 이동 전 연결 벽 스냅샷 (SubTaskDragNode.onEnter 시점 캡처)
   */
  constructor(
    movedNode: Node,
    originalPos: Vector3,
    movedWallOriginalSnaps: readonly WallSnapshot[],
  ) {
    this._preMovedNode = movedNode;
    this._originalPos = originalPos.clone();
    this._newPos = movedNode.position.clone();
    this._movedWallOriginalSnaps = movedWallOriginalSnaps;
  }

  execute(): void {
    // Execute 직전 현재 공간 이름 저장
    this._spaceNamesBeforeCommand = useLayoutStore
      .getState()
      .spaces.map((s) => new SpaceNameEntry(s));

    this._splitCreatedKeys.length = 0;
    this._survivingMovedWallKeys.length = 0;
    this._splitDestroyedNonMovedSnaps.length = 0;

    let movedWalls: Wall[];
    if (this._preMovedNode !== null) {
      // 최초 Execute: 이미 이동된 노드 재활용 (SplitResolver만 실행)
      movedWalls = [...this._preMovedNode.walls];
      this._preMovedNode = null;
    } else {
      // Redo: _originalPos에서 노드를 찾아 _newPos로 이동
      const eps2 = EPSILON * EPSILON;
      const node = useLayoutStore
        .getState()
        .nodes.find((n) => n.position.distanceToSquared(this._originalPos) < eps2);
      if (!node) return;
      node.position = this._newPos;
      movedWalls = [...node.walls];
    }

    const movedWallSet = new Set(movedWalls);
    const wallsBefore = new Set(useLayoutStore.getState().walls);

    // SplitResolver 전에 non-moved 벽 스냅샷 저장 (moved 벽은 이미 이동된 위치라 의미 없음)
    const nonMovedSnapshots = new Map<Wall, WallSnapshot>();
    for (const w of wallsBefore) {
      if (!movedWallSet.has(w)) {
        nonMovedSnapshots.set(w, new WallSnapshot(w));
      }
    }

    const splitResolver = new LayoutSplitWallsResolver(DragNodeCommand.MIN_LENGTH_SQR);
    splitResolver.resolveSplitWallsByMovedWalls(movedWalls);

    const wallsAfter = new Set(useLayoutStore.getState().walls);

    // SplitResolver가 새로 생성한 벽 (moved 벽 포함)
    this._splitCreatedKeys = useLayoutStore
      .getState()
      .walls.filter((w) => !wallsBefore.has(w))
      .map((w) => new WallPositionKey(w.startNode!.position, w.endNode!.position));

    // SplitResolver에서 살아남은 moved 벽 (새 위치에 있음)
    this._survivingMovedWallKeys = movedWalls
      .filter((w) => wallsAfter.has(w))
      .map((w) => new WallPositionKey(w.startNode!.position, w.endNode!.position));

    // SplitResolver가 삭제한 non-moved 벽 (원래 위치 스냅샷)
    this._splitDestroyedNonMovedSnaps = Array.from(wallsBefore)
      .filter((w) => !wallsAfter.has(w) && !movedWallSet.has(w))
      .map((w) => nonMovedSnapshots.get(w)!)
      .filter((s) => s !== undefined);

    // 첫 Execute에서만 결과 공간 이름 캡처
    if (this._spaceNamesAfterCommand === null) {
      this._spaceNamesAfterCommand = useLayoutStore
        .getState()
        .spaces.map((s) => new SpaceNameEntry(s));
    }
    // TODO(port): WallNodeSymbol.createForAllNodes() — Symbols 포팅 후
  }

  undo(): void {
    const savedSpaceNo = Space.saveSpaceNo();

    // 1. SplitResolver가 새로 생성한 벽 삭제
    for (const key of this._splitCreatedKeys) {
      const wall = key.findWall();
      if (wall) Wall.delete(wall, layoutRegistry);
    }
    this._splitCreatedKeys.length = 0;

    // 2. 새 위치의 surviving moved 벽 삭제 (4단계에서 원래 위치로 복원할 예정)
    for (const key of this._survivingMovedWallKeys) {
      const wall = key.findWall();
      if (wall) Wall.delete(wall, layoutRegistry);
    }
    this._survivingMovedWallKeys.length = 0;

    // 3. SplitResolver가 삭제한 non-moved 벽 복원 (원래 위치로)
    for (const snap of this._splitDestroyedNonMovedSnaps) {
      snap.restore();
    }
    this._splitDestroyedNonMovedSnaps.length = 0;

    // 4. 이동된 벽들을 드래그 전 원래 위치로 복원
    for (const snap of this._movedWallOriginalSnaps) {
      snap.restore();
    }

    // 공간 자동 재검출
    if (useLayoutStore.getState().walls.length > 0) {
      buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
    }

    // Execute 직전 이름 복원
    for (const entry of this._spaceNamesBeforeCommand) {
      entry.tryRestore();
    }

    Space.restoreSpaceNo(savedSpaceNo);
    // TODO(port): WallNodeSymbol.createForAllNodes()
  }

  redo(): void {
    const savedSpaceNo = Space.saveSpaceNo();
    this.execute();
    Space.restoreSpaceNo(savedSpaceNo);

    if (this._spaceNamesAfterCommand !== null) {
      for (const entry of this._spaceNamesAfterCommand) {
        entry.tryRestore();
      }
    }
  }
}