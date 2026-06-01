import { Vector2, Vector3 } from 'three';
import { ObjectBase } from '@/domain/structures/ObjectBase';
import type { Node } from '@/domain/structures/Node';
import { Wall, type WallSide } from '@/domain/structures/Wall';
import { EPSILON } from '@/lib/math/Math';
import type { ProductInfo } from '@/domain/products/ProductInfo';

// 외부 모듈이 `import { ProductInfo } from '@/structures/Space'`로 접근하던 기존 패턴을
// 유지하기 위해 re-export. 정식 정의는 `src/products/ProductInfo.ts`에 있다.
export type { ProductInfo };

/**
 * 공간(방) — 벽들로 둘러싸인 영역.
 *
 * Unity `Layout.Space` (709 LOC) 포팅 진행 중.
 *
 * ### 포팅 상태
 * - **완료**: 자료구조, 프로퍼티, 정적 카운터, 팩토리(`create`/`delete`), `dirtyUpdate`,
 *   기본 `cornerPoints` 추출(문 처리 제외 단순 버전), `updateArea`, `updateCenter`/
 *   Pole of Inaccessibility 알고리즘, `isInside`
 * - **TODO**: 문/창호(`ProductWallFilled`) 반영 cornerPoints, `MakeConcaveLine`,
 *   `GetFilledLine`, 천장/바닥 메시, ReflectionProbe(Three.js 환경맵으로 대체 예정)
 */
export class Space extends ObjectBase {
  /** 벽면 가시성 판단 시 카메라 방향과 법선의 내적 임계값. */
  static readonly VISIBILITY = 0;

  /** 기본 천장 높이(m). */
  static readonly DEFAULT_CEILING_HEIGHT = 2.4;
  /** 기본 바닥 높이(m). */
  static readonly DEFAULT_FLOOR_HEIGHT = 0;

  /** 공간 고유 인덱스. */
  readonly spaceIndex: number;

  /** 본 공간을 구성하는 벽체와 벽면 방향의 매핑. */
  private _walls: Map<Wall, WallSide> = new Map();

  /** 공간 이름 (예: "거실", "안방"). */
  private _name: string = '';

  /** 본 공간에 배치된 상품 목록. */
  private _products: ProductInfo[] = [];

  /** 외곽 다각형 꼭짓점 캐시. `dirtyUpdate`에서 재계산된다. */
  private _cornerPoints: Vector2[] | null = null;

  /** 공간의 시각적 중심(폴리곤 내부 최적점) 월드 좌표. */
  center: Vector3 = new Vector3();

  /** 공간 면적(m²). */
  area: number = 0;

  /** 단차 내림 높이(m). */
  floorThick: number = 0;

  /**
   * 신규 공간 기본 이름 번호용 정적 카운터. {@link initSpaceName}에서 자동 증가.
   * undo/redo에서 복원 가능 (saveSpaceNo / restoreSpaceNo).
   */
  private static _spaceNo: number = 1;

  /** true이면 `Space.create`에서 자동 이름 부여를 건너뛴다. 벽 분할 등 배치 작업 시 사용. */
  static suppressInitName: boolean = false;

  /** 공간 목록이 변경될 때 호출되는 리스너 목록. Unity `Space.OnSpaceListChanged` event 대응. */
  static readonly onSpaceListChanged: Array<() => void> = [];

  /** 현재 카운터 값을 반환. 직렬화 복원용. */
  static saveSpaceNo(): number {
    return Space._spaceNo;
  }

  /** 카운터를 지정 값으로 복원. */
  static restoreSpaceNo(value: number): void {
    Space._spaceNo = value;
  }

  /**
   * 단차 내림 높이를 mm로 환산해 반환한다.
   * Unity `Utils.Math.MToMM(FloorThick)` 대응.
   */
  get floorThickMM(): number {
    return Math.floor(this.floorThick * 1000 + 0.1);
  }

  /** 본 공간에 배치된 상품 목록 (readonly view). */
  get allProducts(): readonly ProductInfo[] {
    return this._products;
  }

  /** 상품 컬렉션 변경용 내부 API. */
  _internalProducts(): ProductInfo[] {
    return this._products;
  }

  /** 본 공간을 구성하는 벽체-벽면 방향 매핑. */
  get walls(): ReadonlyMap<Wall, WallSide> {
    return this._walls;
  }

  /** 벽 매핑 변경용 내부 API. */
  _internalWalls(): Map<Wall, WallSide> {
    return this._walls;
  }

  /** 공간 이름. */
  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = value;
  }

  /**
   * 캐싱된 외곽 다각형 꼭짓점 배열. 미초기화 시 최초 접근에서 lazy 초기화.
   */
  get cornerPoints(): Vector2[] {
    if (this._cornerPoints === null) {
      this._cornerPoints = this.getCornerPoints();
    }
    return this._cornerPoints;
  }

  /** 캐시된 cornerPoints를 무효화한다. Wall 변경/공간 재계산 시 호출. */
  invalidateCornerPoints(): void {
    this._cornerPoints = null;
  }

  /** 생성자는 {@link create}를 통해서만 호출하라. @internal */
  constructor(spaceIndex: number) {
    super();
    this.spaceIndex = spaceIndex;
  }

  // ===== 라이프사이클 ========================================

  /**
   * Dirty 상태일 때 호출 — 코너 포인트 캐시 재계산.
   * Unity의 `DirtyUpdate`에서 Ceiling/Floor도 Dirty 처리하지만, 본 포팅에서는 r3f 컴포넌트가
   * 데이터 변경을 자동 감지하므로 별도 트리거 불필요.
   */
  override dirtyUpdate(): void {
    this._cornerPoints = this.getCornerPoints();
    super.dirtyUpdate();
  }

  // ===== 이름 부여 ==========================================

  /**
   * 이름이 비어 있으면 기본 이름(`공간N`)을 부여하고 카운터 증가.
   * Unity `Space.InitSpaceName()`.
   */
  initSpaceName(): void {
    if (this._name === '' || this._name == null) {
      this._name = `공간${Space._spaceNo}`;
      Space._spaceNo += 1;
    }
  }

  // ===== 정적 팩토리 ========================================

  /**
   * 벽 목록으로 공간을 생성한다. 동일한 벽 구성의 기존 공간이 있으면 갱신하고, 없으면 새로 생성.
   * Unity `Space.Create(parent, wallSides)` 대응.
   *
   * @param wallSides 공간을 구성하는 벽-벽면 방향 매핑
   * @param registry 공간 레지스트리 (Zustand 스토어 어댑터)
   */
  static create(
    wallSides: Map<Wall, WallSide>,
    registry: SpaceRegistry,
  ): Space {
    let result: Space | null = null;

    // 기존 공간 중 *wall set이 완전히 일치*하는 것만 갱신 대상. 단순히 "wall 하나라도 속하면 갱신"
    // 으로 두면, 인접한 두 공간이 한 wall을 공유할 때 두 번째 face가 첫 번째 공간을 덮어버려
    // 한 wall이 여러 공간에 속할 수 없게 된다. 정상은 한 wall이 양쪽 두 공간 모두에 속하는 것.
    const newWallSet = new Set(wallSides.keys());
    outer: for (const [wall] of wallSides) {
      for (const oldSpace of wall.spaces) {
        if (oldSpace._walls.size !== newWallSet.size) continue;
        let allMatch = true;
        for (const ow of oldSpace._walls.keys()) {
          if (!newWallSet.has(ow)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          result = oldSpace;
          break outer;
        }
      }
    }

    if (result !== null) {
      // 기존 공간 갱신
      result._walls = wallSides;
      for (const [wall] of wallSides) {
        if (!wall.spaces.includes(result)) {
          wall._internalSpaces().push(result);
        }
      }
      result.setDirty();
    } else {
      // 새 공간 생성
      result = new Space(registry.nextSpaceIndex());
      result._walls = wallSides;
      for (const [wall] of wallSides) {
        wall._internalSpaces().push(result);
      }
      registry.addSpace(result);
      if (!Space.suppressInitName) {
        result.initSpaceName();
      }
      Space.onSpaceListChanged.forEach((cb) => cb());
    }

    return result;
  }

  /**
   * 공간을 삭제하고 연관된 벽들의 spaces 컬렉션에서 제거한다.
   * Unity `Space.Delete(space)` 대응.
   */
  static delete(space: Space, registry: SpaceRegistry): void {
    for (const [wall] of space._walls) {
      const idx = wall._internalSpaces().indexOf(space);
      if (idx >= 0) wall._internalSpaces().splice(idx, 1);
    }
    registry.removeSpace(space);
    Space.onSpaceListChanged.forEach((cb) => cb());
  }

  // ===== 외곽 폴리곤 추출 ====================================

  /**
   * 현재 공간을 구성하는 모든 코너 좌표를 계산해 반환한다 (비용 높음 — 외부에서는
   * 캐시된 {@link cornerPoints}를 사용).
   *
   * **현재 단순화 버전** — 문/창호 개구부 반영은 `ProductWallFilled` 포팅 후 추가된다.
   * 벽이 가상벽인 경우만 코너 교차 계산을 다르게 처리한다.
   *
   * Unity `Space.GetCornerPoints()` 단순화 포팅.
   */
  private getCornerPoints(): Vector2[] {
    const result: Vector2[] = [];
    if (this._walls.size < 3) return result;

    const wallList = Array.from(this._walls.keys());
    const xz = (v: Vector3) => new Vector2(v.x, v.z);
    const xzFromXY = (v: { x: number; z: number }) => new Vector2(v.x, v.z);

    // SpaceBuilder가 _walls Map을 폐쇄 곡선 순서로 채워주므로, 그 순서대로 노드를 추적해
    // 안정적으로 폴리곤을 구성한다. 이전 구현은 `face.start/end`를 그대로 push 했는데 face 끝점
    // 방향이 wall마다 일관되지 않아 폴리곤이 뒤틀려 mesh가 안 만들어지는 케이스가 있었다.
    const w0 = wallList[0];
    const w1 = wallList[1];
    if (!w0.startNode || !w0.endNode || !w1.startNode || !w1.endNode) return result;

    // 첫 벽의 두 노드 중 다음 벽과 공유 안 되는 노드를 시작점으로
    const sharedWithW1 =
      w0.startNode === w1.startNode || w0.startNode === w1.endNode
        ? w0.startNode
        : w0.endNode;
    let currentNode = w0.other(sharedWithW1);
    if (!currentNode) return result;

    // 폐쇄 곡선을 따라 노드 순회. 각 wall에 대해 currentNode와 매칭되는 face 끝점을 사용해
    // 두께 보정을 유지. face가 없거나 매칭 실패하면 노드 좌표로 fallback.
    const tryPushFromFace = (wall: Wall, node: Node, fallback: Vector3): void => {
      const wallSide = this._walls.get(wall);
      const face = wallSide !== undefined ? wall.faces[wallSide] : null;
      if (face) {
        const dStart = (face.start.x - node.position.x) ** 2 + (face.start.z - node.position.z) ** 2;
        const dEnd = (face.end.x - node.position.x) ** 2 + (face.end.z - node.position.z) ** 2;
        const picked = dStart <= dEnd ? face.start : face.end;
        Space._addUniqueCorner(result, xzFromXY(picked));
        return;
      }
      Space._addUniqueCorner(result, xz(fallback));
    };

    // 첫 코너 — 첫 벽의 currentNode 쪽 face 끝점
    tryPushFromFace(w0, currentNode, currentNode.position);

    for (const wall of wallList) {
      const next = wall.other(currentNode);
      if (!next) return result;
      // 현재 벽에 대한 next 노드 쪽 face 끝점이 다음 코너
      tryPushFromFace(wall, next, next.position);
      currentNode = next;
    }

    // 마지막 추가가 첫 노드와 같으면 중복 제거 (폐쇄)
    if (result.length >= 2) {
      const first = result[0];
      const last = result[result.length - 1];
      const dx = first.x - last.x;
      const dy = first.y - last.y;
      if (dx * dx + dy * dy < EPSILON * EPSILON) result.pop();
    }

    return result;
  }

  /**
   * 직전 코너와 EPSILON 이내로 일치하는 좌표를 걸러 폴리곤에 퇴화(degenerate) 정점이
   * 들어가지 않게 한다. Unity `Space.AddUniqueCorner` 대응.
   */
  private static _addUniqueCorner(corners: Vector2[], p: Vector2): void {
    if (corners.length > 0) {
      const last = corners[corners.length - 1];
      const dx = last.x - p.x;
      const dy = last.y - p.y;
      if (dx * dx + dy * dy < EPSILON * EPSILON) return;
    }
    corners.push(p.clone());
  }

  // ===== 중심 (Pole of Inaccessibility) =====================

  /**
   * 코너 점으로부터 시각적 중심을 다시 계산해 {@link center}에 반영.
   * Unity `Space.UpdateCenter()`.
   */
  updateCenter(): void {
    this.center = this._getCenter();
    // TODO(port): updateReflectionProbe() — Three.js EnvironmentMap으로 대체 예정.
  }

  /**
   * 공간 다각형의 Pole of Inaccessibility를 사용해 3D 중심 좌표를 구한다.
   * Unity `Space.GetCenter()`.
   */
  private _getCenter(): Vector3 {
    const pts = this.cornerPoints;
    if (pts === null || pts.length < 3) return this.center.clone();
    const poi = Space._getPoleOfInaccessibility(pts);
    return new Vector3(poi.x, this.center.y, poi.y);
  }

  /**
   * Polylabel 알고리즘 — 다각형 내부에서 경계까지 거리가 가장 먼 점.
   * 오목다각형(L자, ㄴ자 등)에서도 항상 가장 넓은 내부 영역의 중심을 반환한다.
   * Unity `Space.GetPoleOfInaccessibility(pts, precision)` 1:1 포팅.
   */
  private static _getPoleOfInaccessibility(pts: Vector2[], precision = 0.05): Vector2 {
    let minX = pts[0].x;
    let minY = pts[0].y;
    let maxX = pts[0].x;
    let maxY = pts[0].y;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width < Number.EPSILON || height < Number.EPSILON) return pts[0].clone();

    const cellSize = Math.min(width, height);
    let h = cellSize * 0.5;

    type Cell = { x: number; y: number; h: number; d: number; potential: number };
    const cells: Cell[] = [];
    for (let x = minX; x < maxX; x += cellSize) {
      for (let y = minY; y < maxY; y += cellSize) {
        const cx = x + h;
        const cy = y + h;
        const d = Space._signedDistToPolygon(new Vector2(cx, cy), pts);
        cells.push({ x: cx, y: cy, h, d, potential: d + h * 1.41422 });
      }
    }

    // 초기 최적 후보: 바운딩 박스 중심
    let bestX = (minX + maxX) * 0.5;
    let bestY = (minY + maxY) * 0.5;
    let bestD = Space._signedDistToPolygon(new Vector2(bestX, bestY), pts);

    while (cells.length > 0) {
      // potential이 가장 높은 셀을 꺼냄 (간이 최대 힙)
      let maxIdx = 0;
      for (let i = 1; i < cells.length; i++) {
        if (cells[i].potential > cells[maxIdx].potential) maxIdx = i;
      }
      const c = cells[maxIdx];
      cells[maxIdx] = cells[cells.length - 1];
      cells.pop();

      if (c.d > bestD) {
        bestX = c.x;
        bestY = c.y;
        bestD = c.d;
      }
      if (c.potential - bestD <= precision) continue;

      // 4분할
      const nh = c.h * 0.5;
      for (let dx = -1; dx <= 1; dx += 2) {
        for (let dy = -1; dy <= 1; dy += 2) {
          const nx = c.x + dx * nh;
          const ny = c.y + dy * nh;
          const d = Space._signedDistToPolygon(new Vector2(nx, ny), pts);
          cells.push({ x: nx, y: ny, h: nh, d, potential: d + nh * 1.41422 });
        }
      }
    }
    return new Vector2(bestX, bestY);
  }

  /**
   * 점에서 다각형 경계까지의 부호 있는 거리. 내부면 양수, 외부면 음수.
   * Unity `Space.SignedDistToPolygon`.
   */
  private static _signedDistToPolygon(pt: Vector2, polygon: Vector2[]): number {
    const inside = Space._isPointInsidePolygon(pt, polygon);
    let minDist = Number.MAX_VALUE;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i++) {
      minDist = Math.min(minDist, Space._distPointToSegment(pt, polygon[j], polygon[i]));
    }
    return inside ? minDist : -minDist;
  }

  /**
   * 점 p에서 선분 ab까지의 최단 거리.
   * Unity `Space.DistPointToSegment`.
   */
  private static _distPointToSegment(p: Vector2, a: Vector2, b: Vector2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < Number.EPSILON) return p.distanceTo(a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return p.distanceTo(new Vector2(a.x + t * dx, a.y + t * dy));
  }

  /** Ray casting으로 점이 다각형 내부에 있는지 판별. Unity `Space.IsPointInsidePolygon`. */
  private static _isPointInsidePolygon(point: Vector2, polygon: Vector2[]): boolean {
    const n = polygon.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const pi = polygon[i];
      const pj = polygon[j];
      if (
        pi.y > point.y !== pj.y > point.y &&
        point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ===== 면적 ==============================================

  /**
   * 다각형 꼭짓점으로 면적(m²) 계산 (신발끈 공식).
   * Unity `Space.UpdateArea()`.
   */
  updateArea(): void {
    const pts = this.cornerPoints;
    if (pts === null || pts.length < 3) {
      this.area = 0;
      return;
    }
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      area += a.x * b.y - b.x * a.y;
    }
    this.area = Math.abs(area) * 0.5;
  }

  // ===== 내부 판정 ==========================================

  /**
   * XZ 평면상 점이 본 공간의 외곽 다각형 내부에 있는지.
   * Unity `Space.IsInside(Vector2 xzPoint)`.
   */
  isInside(xzPoint: Vector2): boolean {
    const pts = this.cornerPoints;
    if (pts === null || pts.length < 3) return false;
    return Space._isPointInsidePolygon(xzPoint, pts);
  }
}

/**
 * Space 생성/삭제 시 필요한 레지스트리 작업.
 * 실제 구현은 `state.ts`의 `useLayoutStore` 어댑터가 제공한다.
 */
export interface SpaceRegistry {
  addSpace(space: Space): void;
  removeSpace(space: Space): void;
  nextSpaceIndex(): number;
}