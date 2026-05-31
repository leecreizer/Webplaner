import { Vector3 } from 'three';
import { Wall } from '../../structures/Wall';
import { useLayoutStore } from '../../structures/state';
import { EPSILON } from '../../utils/Math';

/**
 * Wall을 좌표 기반으로 식별하는 stable 키.
 *
 * Unity `UndoRedo.Commands.WallPositionKey` (DrawWallCommand.cs:254) 1:1 포팅.
 *
 * Wall 참조(ref)를 직접 보관하면 Undo/Redo로 Wall이 Destroy→재생성될 때 stale reference가
 * 되어 문제가 생긴다. 시작·끝 좌표만 보관하고 조회 시점에 현재 `useLayoutStore.walls`에서
 * 매칭한다. 방향이 반대인 경우(start↔end)도 동일 벽으로 인식한다.
 */
export class WallPositionKey {
  private readonly _start: Vector3;
  private readonly _end: Vector3;

  constructor(start: Vector3, end: Vector3) {
    this._start = start.clone();
    this._end = end.clone();
  }

  /** 시작 좌표 (방어적 복사). */
  get start(): Vector3 {
    return this._start.clone();
  }

  /** 끝 좌표 (방어적 복사). */
  get end(): Vector3 {
    return this._end.clone();
  }

  /**
   * 현재 레이아웃에서 이 키와 일치하는 Wall을 반환한다.
   * 방향 반대도 동일 벽으로 본다.
   */
  findWall(): Wall | undefined {
    const eps2 = EPSILON * EPSILON;
    const start = this._start;
    const end = this._end;
    return useLayoutStore.getState().walls.find((w) => {
      const sn = w.startNode;
      const en = w.endNode;
      if (!sn || !en) return false;
      const matchForward =
        sn.position.distanceToSquared(start) < eps2 && en.position.distanceToSquared(end) < eps2;
      const matchReverse =
        sn.position.distanceToSquared(end) < eps2 && en.position.distanceToSquared(start) < eps2;
      return matchForward || matchReverse;
    });
  }
}