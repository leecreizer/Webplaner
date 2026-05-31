import {
  type Rect,
  rectOverlaps,
  rectContains,
} from './Geometry';

/**
 * XZ 평면 기반 QuadTree. AABB 영역 질의로 공간 분할 탐색을 제공한다.
 * 아이템의 바운드가 여러 자식 노드에 걸치면 부모 노드에 보관된다.
 *
 * Unity `Utils.QuadTree<T>` 1:1 포팅. 벽 충돌·교차 검색 등 광범위 도메인 검색의 성능 인덱스.
 *
 * @example
 * ```ts
 * const tree = new QuadTree<Wall>({ x: -50, y: -50, width: 100, height: 100 });
 * tree.insert(wall1, { x: 0, y: 0, width: 5, height: 1 });
 * const hits: Wall[] = [];
 * tree.query({ x: -1, y: -1, width: 3, height: 3 }, hits);
 * ```
 */
export class QuadTree<T extends object> {
  private static readonly DEFAULT_MAX_ITEMS = 8;
  private static readonly DEFAULT_MAX_DEPTH = 8;

  private readonly _maxItems: number;
  private readonly _maxDepth: number;
  private readonly _depth: number;
  private readonly _bounds: Rect;

  private readonly _items: Array<{ item: T; bounds: Rect }>;
  private _children: QuadTree<T>[] | null = null;

  /** 이 노드가 담당하는 XZ 평면 영역. */
  get bounds(): Readonly<Rect> {
    return this._bounds;
  }

  /**
   * 루트 노드 생성자.
   *
   * @param bounds 트리 전체 영역
   * @param maxItems 분할 전 노드당 최대 아이템 수 (기본 8)
   * @param maxDepth 최대 트리 깊이 (기본 8)
   */
  constructor(bounds: Rect, maxItems?: number, maxDepth?: number);
  /** 내부 재귀용 — 호출자는 위 시그니처를 사용한다. */
  constructor(bounds: Rect, depth: number, maxItems: number, maxDepth: number);
  constructor(
    bounds: Rect,
    a: number = QuadTree.DEFAULT_MAX_ITEMS,
    b: number = QuadTree.DEFAULT_MAX_DEPTH,
    c?: number,
  ) {
    if (c !== undefined) {
      this._bounds = bounds;
      this._depth = a;
      this._maxItems = b;
      this._maxDepth = c;
    } else {
      this._bounds = bounds;
      this._depth = 0;
      this._maxItems = a;
      this._maxDepth = b;
    }
    this._items = [];
  }

  /**
   * 아이템을 트리에 삽입한다. 영역 밖이면 무시.
   *
   * @param item 저장할 아이템 참조
   * @param itemBounds 아이템의 XZ AABB
   */
  insert(item: T, itemBounds: Rect): void {
    if (!rectOverlaps(this._bounds, itemBounds)) return;

    if (this._children !== null) {
      const child = this._findContainingChild(itemBounds);
      if (child >= 0) {
        this._children[child].insert(item, itemBounds);
        return;
      }
      this._items.push({ item, bounds: itemBounds });
      return;
    }

    this._items.push({ item, bounds: itemBounds });
    if (this._items.length > this._maxItems && this._depth < this._maxDepth) {
      this._subdivide();
    }
  }

  /**
   * 아이템을 트리에서 제거한다. 성공 시 true.
   * @param item 제거할 아이템 (참조 동일성 비교)
   */
  remove(item: T): boolean {
    for (let i = this._items.length - 1; i >= 0; i--) {
      if (this._items[i].item === item) {
        this._items.splice(i, 1);
        return true;
      }
    }
    if (this._children !== null) {
      for (let i = 0; i < 4; i++) {
        if (this._children[i].remove(item)) return true;
      }
    }
    return false;
  }

  /**
   * `region`과 겹치는 바운드를 가진 아이템을 `results`에 추가한다.
   */
  query(region: Rect, results: T[]): void {
    if (!rectOverlaps(this._bounds, region)) return;

    for (const entry of this._items) {
      if (rectOverlaps(entry.bounds, region)) results.push(entry.item);
    }
    if (this._children !== null) {
      for (let i = 0; i < 4; i++) this._children[i].query(region, results);
    }
  }

  /** 모든 아이템 제거 + 자식 노드 해제. */
  clear(): void {
    this._items.length = 0;
    this._children = null;
  }

  /** 아이템 바운드를 완전히 포함하는 자식 노드의 인덱스. 없으면 -1. */
  private _findContainingChild(itemBounds: Rect): number {
    if (this._children === null) return -1;
    for (let i = 0; i < 4; i++) {
      if (rectContains(this._children[i]._bounds, itemBounds)) return i;
    }
    return -1;
  }

  /** 현재 노드를 4개 자식으로 분할하고 기존 아이템을 재배치한다. */
  private _subdivide(): void {
    const halfW = this._bounds.width * 0.5;
    const halfH = this._bounds.height * 0.5;
    const x = this._bounds.x;
    const y = this._bounds.y;
    const childDepth = this._depth + 1;

    this._children = [
      new QuadTree<T>({ x, y, width: halfW, height: halfH }, childDepth, this._maxItems, this._maxDepth),
      new QuadTree<T>(
        { x: x + halfW, y, width: halfW, height: halfH },
        childDepth,
        this._maxItems,
        this._maxDepth,
      ),
      new QuadTree<T>(
        { x, y: y + halfH, width: halfW, height: halfH },
        childDepth,
        this._maxItems,
        this._maxDepth,
      ),
      new QuadTree<T>(
        { x: x + halfW, y: y + halfH, width: halfW, height: halfH },
        childDepth,
        this._maxItems,
        this._maxDepth,
      ),
    ];

    for (let i = this._items.length - 1; i >= 0; i--) {
      const child = this._findContainingChild(this._items[i].bounds);
      if (child >= 0) {
        this._children[child].insert(this._items[i].item, this._items[i].bounds);
        this._items.splice(i, 1);
      }
    }
  }
}