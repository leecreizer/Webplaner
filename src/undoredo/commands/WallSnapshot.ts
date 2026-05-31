import { Vector3 } from 'three';
import { Wall, WallType, BearingType, type SegmentInfoDraw } from '../../structures/Wall';
import { Node } from '../../structures/Node';
import { layoutRegistry } from '../../structures/state';
import { WallPositionKey } from './WallPositionKey';

/**
 * Wall의 데이터 스냅샷 — 삭제된 Wall을 복원하기 위한 순수 값 보관.
 *
 * Unity `UndoRedo.Commands.WallSnapshot` (DrawWallCommand.cs:292) 1:1 포팅.
 *
 * Wall 참조 대신 좌표·치수·타입만 보관해 Destroy된 객체 참조 문제를 방지한다.
 *
 * ### 포팅 상태
 * - **완료**: 위치/두께/높이/가벽 여부/내력벽 타입 + restore()
 * - **TODO**: filledObjects (ProductWallFilled) / 좌·우 머티리얼 — Products 모듈 포팅 후 활성화
 */
export class WallSnapshot {
  private readonly _startPos: Vector3;
  private readonly _endPos: Vector3;
  private readonly _thickness: number;
  private readonly _wallType: WallType;
  private readonly _bearingType: BearingType;
  private readonly _wallHeight: number;

  /** TODO(port): `ProductWallFilledSnapshot[]` — Products 포팅 시 채움. */
  private readonly _filledSnapshots: unknown[] = [];

  /**
   * 현재 Wall의 상태로부터 스냅샷을 만든다.
   *
   * @throws Wall에 startNode 또는 endNode가 없으면 예외 (이미 delete된 Wall이라는 의미).
   */
  constructor(wall: Wall) {
    if (!wall.startNode || !wall.endNode) {
      throw new Error('WallSnapshot: wall has no start/end node (already deleted?)');
    }
    this._startPos = wall.startNode.position.clone();
    this._endPos = wall.endNode.position.clone();
    this._thickness = wall.wallThick;
    this._wallType = wall.isVirtual ? WallType.VIRTUAL : WallType.WALL;
    this._bearingType = wall.bearingType;
    this._wallHeight = wall.wallHeight;
    // TODO(port): wall.filledObjects → ProductWallFilledSnapshot[]
  }

  /** 이 스냅샷의 좌표로 {@link WallPositionKey}를 만든다. */
  toPositionKey(): WallPositionKey {
    return new WallPositionKey(this._startPos, this._endPos);
  }

  /**
   * 스냅샷의 좌표·치수로 Wall을 재생성한다.
   * 새 Wall은 현재 평면도(useLayoutStore)에 추가된다.
   *
   * @returns 재생성된 Wall
   */
  restore(): Wall {
    const info: SegmentInfoDraw = {
      start: this._startPos,
      end: this._endPos,
      thickness: this._thickness,
      wallType: this._wallType,
      height: this._wallHeight,
      bearingType: this._bearingType,
    };
    const nodeFactory = (position: Vector3) => Node.create(position, layoutRegistry);
    const wall = Wall.onLayoutStartDrawWithDetail(info, layoutRegistry, nodeFactory);
    // TODO(port): VIRTUAL이고 LayoutMode일 때 VirtualWallLine.create(wall) 호출
    // TODO(port): _filledSnapshots 복원 + 머티리얼 복원
    return wall;
  }
}