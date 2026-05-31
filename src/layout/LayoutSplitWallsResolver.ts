import { Vector2, Vector3 } from 'three';
import { Wall, WallType, type SegmentInfoDraw } from '../structures/Wall';
import { Node } from '../structures/Node';
import { Space } from '../structures/Space';
import { useLayoutStore, layoutRegistry } from '../structures/state';
import { buildSpaces } from './SpaceBuilder';
import { getLineSegmentIntersection } from '../utils/LineSegmentIntersection';
import { approximately, EPSILON } from '../utils/Math';
import type { ProductWallFilled } from '../products/ProductWallFilled';

/**
 * 이동된 벽과 다른 벽 사이의 교차를 감지해 모든 벽을 분할/재구성하는 리졸버.
 *
 * Unity `Layout.LayoutSplitWallsResolver` 1:1 포팅 (마테리얼 보존 부분은 보류 — Material 시스템
 * 포팅 시 추가). 노드/벽 도메인 + 공간 이름 보존까지는 동일하게 동작.
 *
 * ### 알고리즘 단계
 * 1. **길이 검증** — `minLengthSqr` 미만 movedWall은 즉시 삭제
 * 2. **교차 수집** — 기존 wall과 movedWall 사이의 교차점/평행겹침 수집
 * 3. **분할** — 교차점이 있는 벽을 세그먼트로 분할 → `resultSegments`
 * 4. **중복 제거** — 같은 세그먼트가 두 번 생성된 경우 제거
 * 5. **삭제 + 재생성** — deleted 벽들의 도어/창호를 분리 보존 → 벽 재생성 → 도어 재삽입
 * 6. **공간 이름 복원** — 1단계 IsInside 매칭 + 2단계 거리 폴백
 *
 * `Wall.delete`/`Wall.onLayoutComplete` 등이 본 클래스를 호출하면 폐쇄 공간 자동 재검출까지
 * 한 번에 처리한다.
 *
 * ### 보류 (TODO)
 * - **벽/공간 마테리얼 스냅샷·복원** — Material 모듈 포팅 후
 * - **VirtualWallLine 생성** — Layout/VirtualWallLine 포팅 후
 * - **WallNodeSymbol 생성** — Symbols 모듈 포팅 후
 */
export class LayoutSplitWallsResolver {
  private readonly _minLengthSqr: number;

  /** @param minLengthSqr 분할 결과 세그먼트의 최소 길이 제곱(m²) — Unity Task2DModeIdle.WALL_MINLENGTH_SQR와 동일 값 */
  constructor(minLengthSqr: number) {
    this._minLengthSqr = minLengthSqr;
  }

  /**
   * 메인 진입점 — 이동된 벽들로 인해 발생한 교차를 모두 해소한다.
   *
   * @param movedWalls 사용자가 드래그 등으로 이동시킨 벽 목록
   */
  resolveSplitWallsByMovedWalls(movedWalls: readonly Wall[]): void {
    const resultSegments: WallSegment[] = [];
    const movedWallTs: Map<Wall, number[]> = new Map();
    const deletedWalls: Set<Wall> = new Set();

    // 0단계: 길이가 최솟값 미만인 movedWall 삭제
    this._removeInvalidMovedWalls(movedWalls, deletedWalls);

    // 1단계: 교차 수집 + 기존 wall 분할
    this._collectIntersections(movedWalls, movedWallTs, deletedWalls, resultSegments);

    // 2단계: 교차점이 기록된 movedWall도 동일하게 분할
    for (const [wall, ts] of movedWallTs) {
      this._splitWallByTs(wall, ts, resultSegments);
      deletedWalls.add(wall);
    }

    // 3단계: 중복 세그먼트 제거
    this._removeDuplicateSegments(resultSegments);

    // 4단계: 공간 이름 스냅샷 → 삭제 + 재생성 → 이름 복원
    const spaceSnapshots = this._snapshotSpaceNames();

    Space.suppressInitName = true;
    this._deleteAndRecreateWalls(deletedWalls, resultSegments);
    Space.suppressInitName = false;

    this._restoreSpaceNames(spaceSnapshots);

    for (const space of useLayoutStore.getState().spaces) {
      space.initSpaceName();
    }
  }

  // ===== 1단계: 길이 검증 ===================================

  private _removeInvalidMovedWalls(
    movedWalls: readonly Wall[],
    deletedWalls: Set<Wall>,
  ): void {
    for (const movedWall of movedWalls) {
      if (!movedWall.startNode || !movedWall.endNode) continue;
      const b1 = new Vector2(movedWall.startNode.position.x, movedWall.startNode.position.z);
      const b2 = new Vector2(movedWall.endNode.position.x, movedWall.endNode.position.z);
      if (b2.clone().sub(b1).lengthSq() < this._minLengthSqr) {
        deletedWalls.add(movedWall);
      }
    }
  }

  // ===== 2단계: 교차 수집 ===================================

  private _collectIntersections(
    movedWalls: readonly Wall[],
    movedWallTs: Map<Wall, number[]>,
    deletedWalls: Set<Wall>,
    resultSegments: WallSegment[],
  ): void {
    const movedSet = new Set(movedWalls);

    for (const wall of useLayoutStore.getState().walls) {
      if (movedSet.has(wall)) continue;
      if (!wall.startNode || !wall.endNode) continue;

      const a1 = new Vector2(wall.startNode.position.x, wall.startNode.position.z);
      const a2 = new Vector2(wall.endNode.position.x, wall.endNode.position.z);

      const ts: number[] = [];

      for (const movedWall of movedWalls) {
        if (deletedWalls.has(movedWall)) continue;
        if (!movedWall.startNode || !movedWall.endNode) continue;

        const b1 = new Vector2(movedWall.startNode.position.x, movedWall.startNode.position.z);
        const b2 = new Vector2(movedWall.endNode.position.x, movedWall.endNode.position.z);

        const r = getLineSegmentIntersection(a1, a2, b1, b2);

        if (r.isParallel) {
          if (r.isOverlap) {
            this._handleParallelOverlap(wall, movedWall, a1, a2, b1, b2, ts, movedWallTs, deletedWalls);
          }
        } else if (r.intersects) {
          const endpointThreshold = 1e-3;
          if (r.t > endpointThreshold && r.t < 1 - endpointThreshold) ts.push(r.t);
          this._addMovedWallT(movedWallTs, movedWall, r.u);
        }
      }

      if (ts.length === 0) continue;

      this._splitWallByTs(wall, ts, resultSegments);
      deletedWalls.add(wall);
    }
  }

  private _handleParallelOverlap(
    wall: Wall,
    movedWall: Wall,
    a1: Vector2,
    a2: Vector2,
    b1: Vector2,
    b2: Vector2,
    ts: number[],
    movedWallTs: Map<Wall, number[]>,
    deletedWalls: Set<Wall>,
  ): void {
    const r1 = LayoutSplitWallsResolver._isBetween(a1, a2, b1);
    const r2 = LayoutSplitWallsResolver._isBetween(a1, a2, b2);
    const r3 = LayoutSplitWallsResolver._isBetween(b1, b2, a1);
    const r4 = LayoutSplitWallsResolver._isBetween(b1, b2, a2);

    if (r1.between) ts.push(r1.t);
    if (r2.between) ts.push(r2.t);
    if (r3.between) this._addMovedWallT(movedWallTs, movedWall, r3.t);
    if (r4.between) this._addMovedWallT(movedWallTs, movedWall, r4.t);

    // movedWall가 wall에 완전히 포함되면 movedWall 삭제
    if (r1.between && r2.between && !r3.between && !r4.between) {
      deletedWalls.add(movedWall);
    }
    // 반대로 wall이 movedWall에 완전히 포함되면 wall 삭제
    if (r3.between && r4.between && !r1.between && !r2.between) {
      deletedWalls.add(wall);
    }
  }

  // ===== 3단계: 벽 분할 ====================================

  private _splitWallByTs(wall: Wall, ts: readonly number[], result: WallSegment[]): void {
    if (!wall.startNode || !wall.endNode) return;

    // 중복 제거 후 정렬 (0과 1 포함)
    const sorted = Array.from(new Set([0, 1, ...ts])).sort((a, b) => a - b);
    const wallType = wall.isVirtual ? WallType.VIRTUAL : WallType.WALL;
    const sn = wall.startNode.position;
    const en = wall.endNode.position;

    let lastT = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const p1 = sn.clone().lerp(en, lastT);
      const p2 = sn.clone().lerp(en, sorted[i]);

      if (p2.clone().sub(p1).lengthSq() > this._minLengthSqr) {
        result.push({
          start: p1,
          end: p2,
          wallType,
          thickness: wall.wallThick,
          height: wall.wallHeight,
          bearingType: wall.bearingType,
        });
        lastT = sorted[i];
      } else if (i === sorted.length - 1 && result.length > 0) {
        // 마지막 토막이 너무 짧으면 직전 세그먼트의 end를 늘려 흡수
        const last = result[result.length - 1];
        result[result.length - 1] = { ...last, end: p2 };
      }
    }
  }

  // ===== 4단계: 중복 제거 ==================================

  private _removeDuplicateSegments(segments: WallSegment[]): void {
    const dupThresholdSqr = EPSILON;
    for (let i = segments.length - 1; i >= 0; i--) {
      for (let j = 0; j < i; j++) {
        const a = segments[i];
        const b = segments[j];
        const sameDir =
          a.start.distanceToSquared(b.start) < dupThresholdSqr &&
          a.end.distanceToSquared(b.end) < dupThresholdSqr;
        const revDir =
          a.start.distanceToSquared(b.end) < dupThresholdSqr &&
          a.end.distanceToSquared(b.start) < dupThresholdSqr;
        if (sameDir || revDir) {
          segments.splice(i, 1);
          break;
        }
      }
    }
  }

  // ===== 5단계: 삭제 + 재생성 + 도어 재삽입 ===================

  private _deleteAndRecreateWalls(
    deletedWalls: Set<Wall>,
    resultSegments: readonly WallSegment[],
  ): void {
    // 삭제 전 공간 이름 스냅샷 — DeleteAndRecreateWalls 내부 보존용 (Unity는 별도)
    const innerSpaceSnapshots = this._snapshotSpaceNames();

    // 삭제 대상 벽의 도어/창호를 분리하여 보존 (Wall.delete 시 함께 사라지지 않도록)
    const orphanedProducts: ProductWallFilled[] = [];
    for (const wall of deletedWalls) {
      // wall.filledObjects를 변경하면서 순회하지 않도록 복사
      const filledCopy = [...wall.filledObjects];
      for (const filled of filledCopy) {
        wall.remove(filled);
        orphanedProducts.push(filled);
      }
    }

    // TODO(port): 벽/공간 마테리얼 스냅샷 — Material 모듈 포팅 후

    // 삭제
    for (const wall of deletedWalls) {
      Wall.delete(wall, layoutRegistry);
    }

    // 재생성
    const nodeFactory = (position: Vector3) => Node.create(position, layoutRegistry);
    for (const seg of resultSegments) {
      const p1 = seg.start.clone();
      p1.y = 0;
      const p2 = seg.end.clone();
      p2.y = 0;

      const info: SegmentInfoDraw = {
        start: p1,
        end: p2,
        thickness: seg.thickness,
        wallType: seg.wallType,
        height: seg.height,
        bearingType: seg.bearingType,
      };
      Wall.onLayoutStartDrawWithDetail(info, layoutRegistry, nodeFactory);
      // TODO(port): VIRTUAL이면 VirtualWallLine.create(wall) — Layout/VirtualWallLine 포팅 후
      // TODO(port): WallNodeSymbol.create() — Symbols 포팅 후
    }

    // 분리된 도어/창호를 가장 적합한 새 벽에 재삽입
    for (const product of orphanedProducts) {
      const bestWall = LayoutSplitWallsResolver._findBestWallForProduct(product);
      if (bestWall !== null) {
        bestWall.insert(product);
      }
      // bestWall null이면 product를 폐기 — Unity는 GameObject.Destroy(filled.gameObject)
    }

    // 폐쇄 공간 자동 재검출
    if (useLayoutStore.getState().walls.length > 0) {
      buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
    }

    // 이름 복원 (DeleteAndRecreateWalls 내부)
    this._restoreSpaceNames(innerSpaceSnapshots);
  }

  // ===== 6단계: 공간 이름 스냅샷·복원 =========================

  private _snapshotSpaceNames(): Array<{ center: Vector2; name: string }> {
    const result: Array<{ center: Vector2; name: string }> = [];
    for (const s of useLayoutStore.getState().spaces) {
      s.updateCenter();
      result.push({ center: new Vector2(s.center.x, s.center.z), name: s.name });
    }
    return result;
  }

  private _restoreSpaceNames(spaceSnapshots: ReadonlyArray<{ center: Vector2; name: string }>): void {
    const renamed = new Set<Space>();
    const unmatched: Array<{ center: Vector2; name: string }> = [];

    // 1단계: IsInside 매칭
    for (const snap of spaceSnapshots) {
      let matched = false;
      for (const newSpace of useLayoutStore.getState().spaces) {
        if (renamed.has(newSpace)) continue;
        if (newSpace.isInside(snap.center)) {
          newSpace.name = snap.name;
          renamed.add(newSpace);
          matched = true;
          break;
        }
      }
      if (!matched) unmatched.push(snap);
    }
    if (unmatched.length === 0) return;

    // 2단계 폴백: 가장 가까운 + (동거리 시) 면적이 큰 공간
    const unmatchedSpaces = useLayoutStore.getState().spaces.filter((s) => !renamed.has(s));
    for (const s of unmatchedSpaces) s.updateCenter();

    for (const snap of unmatched) {
      let best: Space | null = null;
      let bestDist = Number.MAX_VALUE;
      let bestArea = -1;
      for (const cand of unmatchedSpaces) {
        if (renamed.has(cand)) continue;
        const c2 = new Vector2(cand.center.x, cand.center.z);
        const dist = c2.distanceTo(snap.center);
        const closer = dist < bestDist;
        const sameDistLargerArea = approximately(dist, bestDist) && cand.area > bestArea;
        if (closer || sameDistLargerArea) {
          best = cand;
          bestDist = dist;
          bestArea = cand.area;
        }
      }
      if (best !== null) {
        best.name = snap.name;
        renamed.add(best);
      }
    }
  }

  // ===== 보조 유틸 =========================================

  private _addMovedWallT(movedWallTs: Map<Wall, number[]>, wall: Wall, t: number): void {
    const list = movedWallTs.get(wall) ?? [];
    list.push(t);
    movedWallTs.set(wall, list);
  }

  /**
   * 2D 점 `value`가 선분 `s→e` 위에 있는지 + 매개변수 `t` 반환 (Unity 원본의 IsBetween).
   * x축 또는 y축 중 변화가 더 큰 축을 기준으로 판정한다.
   */
  private static _isBetween(s: Vector2, e: Vector2, value: Vector2): { between: boolean; t: number } {
    if (!approximately(s.x, e.x)) {
      return LayoutSplitWallsResolver._isBetweenScalar(s.x, e.x, value.x);
    }
    return LayoutSplitWallsResolver._isBetweenScalar(s.y, e.y, value.y);
  }

  private static _isBetweenScalar(s: number, e: number, value: number): { between: boolean; t: number } {
    const min = Math.min(s, e);
    const max = Math.max(s, e);
    const between = value >= min && value <= max;
    const t = (value - s) / (e - s);
    return { between, t };
  }

  /**
   * 제품 위치를 수용 가능한 가장 가까운 (가벽 아닌) 벽을 찾는다.
   * 분할 지점이 제품 폭을 가로지르면 어느 쪽 벽에도 안 들어가므로 null.
   */
  private static _findBestWallForProduct(product: ProductWallFilled): Wall | null {
    const pos = product.position;
    const halfW = product.currentSize.x * 0.5;
    const tolerance = 0.01;

    let bestWall: Wall | null = null;
    let bestDist = Number.MAX_VALUE;

    for (const wall of useLayoutStore.getState().walls) {
      if (wall.isVirtual) continue;
      if (!wall.startNode || !wall.endNode) continue;

      const start = wall.startNode.position;
      const end = wall.endNode.position;
      const dir = end.clone().sub(start);
      const length = dir.length();
      if (length < Number.EPSILON) continue;
      dir.divideScalar(length);

      const t = pos.clone().sub(start).dot(dir);
      if (t - halfW < -tolerance || t + halfW > length + tolerance) continue;

      const tc = Math.max(0, Math.min(length, t));
      const projected = start.clone().add(dir.clone().multiplyScalar(tc));
      const dist = Math.sqrt(
        (pos.x - projected.x) * (pos.x - projected.x) +
          (pos.z - projected.z) * (pos.z - projected.z),
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestWall = wall;
      }
    }

    return bestWall !== null && bestDist < bestWall.wallThick * 2 ? bestWall : null;
  }
}

/** 분할 결과 세그먼트의 내부 자료구조. */
interface WallSegment {
  start: Vector3;
  end: Vector3;
  wallType: WallType;
  thickness: number;
  height: number;
  bearingType: Wall['bearingType'];
}