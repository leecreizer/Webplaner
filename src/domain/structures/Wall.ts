import { Vector2, Vector3, Quaternion } from 'three';
import { ObjectBase } from '@/domain/structures/ObjectBase';
import type { Node } from '@/domain/structures/Node';
import type { Space } from '@/domain/structures/Space';
import type { ProductWallFilled } from '@/domain/products/ProductWallFilled';
import { findAngle3D, segmentsIntersectPoint, footOfPerpendicular } from '@/lib/math/Geometry';

/**
 * 벽체 속성 — 일반 벽 vs 가벽(시각화 안 함).
 * Unity `Wall.eWallType` 대응. JSON 직렬화 시 `isVirtual: boolean`으로만 저장된다.
 */
export enum WallType {
  WALL = 0,
  VIRTUAL = 1,
}

/**
 * 벽체 정렬(설계) 방식 — 두께가 시작·끝 노드를 기준으로 어느 쪽에 붙는지.
 * Unity `Wall.WallAlign` 대응.
 */
export enum WallAlign {
  INNER = 0,
  CENTER = 1,
  OUTTER = 2,
}

/**
 * 벽면 종류 — 벽의 진행 방향 기준 좌/우.
 * Unity `Wall.WallSide` 대응.
 */
export enum WallSide {
  LEFT = 0,
  RIGHT = 1,
}

/**
 * 내력벽 구분 — NBW(비내력) / BW(내력).
 * Unity `Wall.BearingType` 대응. JSON에는 `"NBW"`/`"BW"` 문자열로 저장.
 */
export enum BearingType {
  NBW = 0,
  BW = 1,
}

/** 벽 세그먼트 정보 — 그리기 입력 자료구조. Unity `Wall.SegmentInfo` 대응. */
export interface SegmentInfo {
  start: Vector3;
  end: Vector3;
  thickness: number;
  wallType: WallType;
}

/** 확장 세그먼트(높이·내력벽 타입 포함). Unity `Wall.SegmentInfoDraw` 대응. */
export interface SegmentInfoDraw extends SegmentInfo {
  height: number;
  bearingType: BearingType;
}

/**
 * 벽면(Face) 정보.
 *
 * Unity에서는 `GameObject`/`Node` 참조를 직접 들고 있었으나, TS 포팅판은 데이터 클래스
 * 기준으로만 보관한다. 시각화 측 r3f 컴포넌트가 본 정보를 사용해 메시를 생성한다.
 */
export interface Face {
  wall: Wall;
  node: Node;
  start: Vector3;
  end: Vector3;
  forward: Vector3;
}

/**
 * 벽체 클래스 — 시작/끝 노드, 두께, 높이, 벽면(Face) 관리.
 *
 * Unity `Layout.Wall` (1229 LOC) 포팅 진행 중.
 *
 * ### 포팅 상태
 * - **완료**: 자료구조 / enum / 프로퍼티 / 노드 연결 / 정적 팩토리 / 노드 그래프 탐색
 *   (other, connectedWall, findNearestWall, findNearestFace) / Face & border 계산
 *   (updateWallFace, buildBorderInfo) / 그리기 라이프사이클(onLayoutStartDraw/Update/Complete)
 * - **TODO**: 메시 생성(updateWallMesh / buildSideSegments / buildOpeningBorder /
 *   updateVirtualWallMesh / updateMeshWireFrame / updateMeasureComponent) — r3f 컴포넌트가
 *   본 클래스의 `border`/`faces`를 구독해 메시를 생성하는 형태로 대체된다.
 *   문/창호 관련 메서드(insert/remove/onSizeDelta)는 `ProductWallFilled` 포팅 후 활성화.
 */
export class Wall extends ObjectBase {
  /** 기본 벽 두께(m). Unity `Wall.DEFAULT_THICK`. */
  static readonly DEFAULT_THICK = 0.2;

  /**
   * 기본 벽 높이(m). Unity는 `Space.DEFAULT_CEILING_HEIGHT - Space.DEFAULT_FLOOR_HEIGHT`로
   * 계산하지만, 순환 import 회피를 위해 동일 상수값(2.4)을 직접 둔다.
   * 정의 위치가 바뀌면 `Space.DEFAULT_CEILING_HEIGHT`와 동기화 필요.
   */
  static readonly DEFAULT_HEIGHT = 2.4;

  /** 벽 고유 인덱스. {@link SpaceData.wallIndices}가 참조. */
  readonly wallIndex: number;

  /** 내력벽 종류. Unity `WallBearingType` 대응. 기본값 NBW. */
  bearingType: BearingType = BearingType.NBW;

  private _start: Node | null = null;
  private _end: Node | null = null;
  private _thickness: number = Wall.DEFAULT_THICK;
  private _height: number = Wall.DEFAULT_HEIGHT;
  private _align: WallAlign = WallAlign.CENTER;
  private _isHidden: boolean = false;
  private _spaces: Space[] = [];

  /** 벽면 정보 [0=left, 1=right]. {@link updateWallFace} 호출 후 채워진다. */
  private _faces: [Face | null, Face | null] = [null, null];

  /**
   * 벽체 둘레 점 6개 — `buildBorderInfo`의 결과를 저장한다.
   * 인덱스 매핑:
   * ```
   *   EndNode
   *   3 - 4 - 5
   *   |       |
   *   2 - 1 - 0
   *   StartNode
   * ```
   * Wall 로컬 좌표계(StartNode가 원점, EndNode 방향이 +Z). 메시 생성 시 사용.
   */
  private _border: Vector3[] = [];

  /** 본 벽에 삽입된 문/창호 목록. {@link insert}/{@link remove}로 조작. */
  filledObjects: ProductWallFilled[] = [];

  /**
   * 뒷면 숨김 여부 (정적, 모든 벽 공통).
   * Unity 원본 `Wall.HideBackFace`.
   */
  static hideBackFace: boolean = true;

  /** 파괴 진행 중 플래그 — 콜백/지연된 작업이 destroyed wall에 접근하는 것을 막기 위함. */
  isDestroying: boolean = false;

  /**
   * 생성자는 직접 호출하지 말고 {@link create}를 사용하라.
   * @internal
   */
  constructor(wallIndex: number) {
    super();
    this.wallIndex = wallIndex;
  }

  // ===== 노드 연결 ============================================

  /** 시작 노드. 변경 시 양쪽 노드의 `walls` 컬렉션을 동기화한다. */
  get startNode(): Node | null {
    return this._start;
  }

  set startNode(value: Node | null) {
    if (this._start) {
      const idx = this._start.walls.indexOf(this);
      if (idx >= 0) this._start.walls.splice(idx, 1);
    }
    this._start = value;
    if (this._start) {
      if (!this._start.walls.includes(this)) this._start.walls.push(this);
      for (const w of this._start.walls) w.setDirty();
    }
  }

  /** 끝 노드. 변경 시 양쪽 노드의 `walls` 컬렉션을 동기화한다. */
  get endNode(): Node | null {
    return this._end;
  }

  set endNode(value: Node | null) {
    if (this._end) {
      const idx = this._end.walls.indexOf(this);
      if (idx >= 0) this._end.walls.splice(idx, 1);
    }
    this._end = value;
    if (this._end) {
      if (!this._end.walls.includes(this)) this._end.walls.push(this);
      for (const w of this._end.walls) w.setDirty();
    }
  }

  // ===== 기하 프로퍼티 ========================================

  /**
   * 벽의 정규화 진행 방향 벡터. start → end.
   * 양 끝점이 동일하면 0벡터.
   */
  get direction(): Vector3 {
    if (!this._start || !this._end) return new Vector3();
    return this._end.position.clone().sub(this._start.position).normalize();
  }

  /** 벽 두께(m). 가상벽일 때는 setter가 무시된다. */
  get wallThick(): number {
    return this._thickness;
  }

  set wallThick(value: number) {
    if (this.isVirtual) return;
    this._thickness = value;
    if (this._start) for (const w of this._start.walls) w.setDirty();
    if (this._end) for (const w of this._end.walls) w.setDirty();
  }

  /** 벽 높이(m). */
  get wallHeight(): number {
    return this._height;
  }

  set wallHeight(value: number) {
    this._height = value;
    this.setDirty();
  }

  /** 벽 정렬 방식. */
  get align(): WallAlign {
    return this._align;
  }

  set align(value: WallAlign) {
    this._align = value;
    this.setDirty();
  }

  /** 가벽 여부 — 두께가 0이면 가벽으로 본다. Unity 원본 동일. */
  get isVirtual(): boolean {
    return this._thickness === 0;
  }

  /**
   * 가벽 플래그를 설정한다. true면 두께 0, false면 기본 두께({@link DEFAULT_THICK})로 복원.
   * Unity 원본은 private setter였으나 {@link create}에서 초기화 용도로 사용하기 위해 노출.
   */
  setVirtual(value: boolean): void {
    this._thickness = value ? 0 : Wall.DEFAULT_THICK;
  }

  /** 벽이 숨겨진 상태인지 (투명 처리). 변경 시 삽입된 문/창호의 활성 상태도 갱신. */
  get isHidden(): boolean {
    return this._isHidden;
  }

  set isHidden(value: boolean) {
    this._isHidden = value;
    // TODO(port): FilledObject 포팅 후 활성/비활성 토글 구현.
    //   Unity 원본 (Wall.cs:254-258):
    //     foreach (var filled in FilledObjects) filled.gameObject.SetActive(!_isHidden);
  }

  /** 벽면 정보 [left, right]. {@link updateWallFace} 호출 후에만 유효. */
  get faces(): readonly [Face | null, Face | null] {
    return this._faces;
  }

  /** 벽 둘레 점 6개 (Wall 로컬 좌표). {@link updateWallFace} 호출 후 채워진다. */
  get border(): readonly Vector3[] {
    return this._border;
  }

  /** 본 벽이 속한 공간 목록. */
  get spaces(): readonly Space[] {
    return this._spaces;
  }

  /** {@link spaces} 컬렉션 변경용 내부 API. */
  _internalSpaces(): Space[] {
    return this._spaces;
  }

  // ===== 노드 관계 헬퍼 ======================================

  /**
   * 본 벽의 두 노드 중 인자로 받은 노드의 *반대쪽* 노드를 반환한다.
   *
   * @param node 본 벽의 두 노드 중 하나
   * @returns 반대쪽 노드. 인자가 본 벽의 노드가 아니면 `null`.
   */
  other(node: Node): Node | null {
    if (node === this._start) return this._end;
    if (node === this._end) return this._start;
    return null;
  }

  /**
   * 지정된 노드에 연결된 다른 벽체들(본 벽 제외)을 반환한다.
   * Unity `Wall.ConnectedWall(node)` 대응.
   */
  connectedWall(node: Node): Wall[] {
    return node.walls.filter((w) => w !== this);
  }

  /**
   * 노드를 기준으로 시계(또는 반시계) 방향에 있는 가장 가까운 벽을 찾는다.
   *
   * Unity `Wall.FindNearestWall(node, targetWall, cw, out result, includeVirtual)` 1:1 포팅.
   *
   * @param node 기준 노드 (본 벽의 두 노드 중 하나)
   * @param targetWalls 후보 벽 배열
   * @param cw true면 시계방향(up벡터 +Y 기준), false면 반시계
   * @param includeVirtual 가벽도 검색 대상에 포함할지
   * @returns `{ nearest: 각도(deg, -180~180), result: 가장 가까운 벽 or null }`
   */
  findNearestWall(
    node: Node,
    targetWalls: readonly Wall[],
    cw: boolean,
    includeVirtual = true,
  ): { nearest: number; result: Wall | null } {
    let nearest = 360;
    let result: Wall | null = null;

    for (const wall of targetWalls) {
      if (wall.isVirtual && !includeVirtual) continue;

      const otherSelf = this.other(node);
      const otherWall = wall.other(node);
      if (!otherSelf || !otherWall) continue;

      let degree = findAngle3D(
        otherSelf.position,
        node.position,
        otherWall.position,
        cw ? new Vector3(0, 1, 0) : new Vector3(0, -1, 0),
      );
      if (degree < 0) degree += 360;

      if (degree < nearest) {
        result = wall;
        nearest = degree;
      }
    }

    nearest = nearest > 180 ? nearest - 360 : nearest;
    // 이어지는 벽체가 평행할 때 (180° 또는 0°) → 0 처리
    if (nearest % 180 === 0) nearest = 0;
    return { nearest, result };
  }

  /**
   * 점에서 가장 가까운 벽면(left 또는 right)을 반환한다.
   * Unity `Wall.FindNearestFace(pt)` 대응.
   *
   * @throws Faces가 채워지지 않은 상태에서 호출하면 예외.
   */
  findNearestFace(pt: Vector3): Face {
    if (!this._start || !this._end) throw new Error('Wall: nodes not set');
    if (!this._faces[0] || !this._faces[1]) throw new Error('Wall: faces not initialized (call updateWallFace first)');

    const dir = this._end.position.clone().sub(this._start.position).normalize();
    const center = this._start.position.clone().add(this._end.position).multiplyScalar(0.5);
    // Quaternion.Euler(0, -90, 0) * dir → XZ 평면에서 dir을 -90° 회전 (벽의 좌측 법선)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
    const normal = dir.clone().applyQuaternion(q);
    const dirToPoint = pt.clone().sub(center);
    return normal.dot(dirToPoint) > 0 ? this._faces[0] : this._faces[1];
  }

  // ===== 벽면·둘레 계산 =====================================

  /**
   * 벽면(Face) 정보를 갱신한다. 메시 생성 전 반드시 호출되어야 한다.
   * Unity `Wall.UpdateWallFace()` 대응.
   *
   * 내부적으로 {@link buildBorderInfo}로 6개 둘레 점을 계산하고, left/right Face 두 개를
   * 본 벽의 진행 방향에 맞춰 회전·평행 이동한 결과를 `_faces`에 저장한다.
   */
  updateWallFace(): void {
    if (!this._start || !this._end) return;

    this._border = this.buildBorderInfo();

    const dirRot = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), this.direction);
    const startPos = this._start.position;

    this._faces = [
      {
        wall: this,
        node: this._end,
        start: this._border[3].clone().applyQuaternion(dirRot).add(startPos),
        end: this._border[2].clone().applyQuaternion(dirRot).add(startPos),
        forward: new Vector3(-1, 0, 0).applyQuaternion(dirRot),
      },
      {
        wall: this,
        node: this._start,
        start: this._border[0].clone().applyQuaternion(dirRot).add(startPos),
        end: this._border[5].clone().applyQuaternion(dirRot).add(startPos),
        forward: new Vector3(1, 0, 0).applyQuaternion(dirRot),
      },
    ];
  }

  /**
   * 벽체 둘레 6점을 Wall 로컬 좌표계로 계산한다.
   * Unity `Wall.BuildBorderInfo()` 1:1 포팅.
   *
   * 인접 벽과의 교차(코너 처리)를 반영하며, 가상벽은 단순한 직사각형을 반환한다.
   *
   * @returns 6개 점 배열. 인덱스 매핑은 {@link _border} 주석 참고.
   */
  private buildBorderInfo(): Vector3[] {
    if (!this._start || !this._end) return [];

    const startPos = this._start.position.clone();
    const endPos = this._end.position.clone();
    const norm = endPos.clone().sub(startPos).normalize();
    const dirRot = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), norm);
    let right = new Vector3(1, 0, 0).applyQuaternion(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    );
    // = (0, 0, 1) rotated 90° around Y axis = (1, 0, 0) — actually let me follow Unity's literal:
    // Unity: Quaternion.Euler(0, 90, 0) * norm
    // We get a Vector3 right.
    right = norm.clone().applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));

    const halfThick = this.wallThick * 0.5;
    const staRht = startPos.clone().add(right.clone().multiplyScalar(halfThick));
    const endRht = endPos.clone().add(right.clone().multiplyScalar(halfThick));
    const staLft = startPos.clone().sub(right.clone().multiplyScalar(halfThick));
    const endLft = endPos.clone().sub(right.clone().multiplyScalar(halfThick));

    // XZ projection helpers (Vector3 → Vector2 of XZ)
    const xz = (v: Vector3) => new Vector2(v.x, v.z);
    const xzInv = (v: Vector2, y: number) => new Vector3(v.x, y, v.y);

    let ptSR = xz(staRht);
    let ptER = xz(endRht);
    let ptSL = xz(staLft);
    let ptEL = xz(endLft);

    if (!this.isVirtual) {
      const prevWalls = this.connectedWall(this._start);
      const nextWalls = this.connectedWall(this._end);

      const rhtPrev = this.findNearestWall(this._start, prevWalls, true, false);
      const lftPrev = this.findNearestWall(this._start, prevWalls, false, false);
      const rhtNext = this.findNearestWall(this._end, nextWalls, false, false);
      const lftNext = this.findNearestWall(this._end, nextWalls, true, false);

      // Start-Right
      if (rhtPrev.nearest * 0.5 !== 0 && rhtPrev.result && !rhtPrev.result.isVirtual) {
        const prevStaCen = rhtPrev.result.other(this._start);
        if (prevStaCen) {
          const prevEndCen = rhtPrev.result.other(prevStaCen);
          if (prevEndCen) {
            const r = prevEndCen.position
              .clone()
              .sub(prevStaCen.position)
              .normalize()
              .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
            const prevStaRht = prevStaCen.position.clone().add(r.clone().multiplyScalar(rhtPrev.result.wallThick * 0.5));
            const prevEndRht = prevEndCen.position.clone().add(r.clone().multiplyScalar(rhtPrev.result.wallThick * 0.5));
            const res = segmentsIntersectPoint(xz(prevStaRht), xz(prevEndRht), xz(staRht), xz(endRht));
            if (res.valid) ptSR = res.point;
          }
        }
      }

      // Start-Left
      if (lftPrev.nearest * 0.5 !== 0 && lftPrev.result && !lftPrev.result.isVirtual) {
        const prevStaCen = lftPrev.result.other(this._start);
        if (prevStaCen) {
          const prevEndCen = lftPrev.result.other(prevStaCen);
          if (prevEndCen) {
            const r = prevEndCen.position
              .clone()
              .sub(prevStaCen.position)
              .normalize()
              .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
            const prevStaLft = prevStaCen.position.clone().sub(r.clone().multiplyScalar(lftPrev.result.wallThick * 0.5));
            const prevEndLft = prevEndCen.position.clone().sub(r.clone().multiplyScalar(lftPrev.result.wallThick * 0.5));
            const res = segmentsIntersectPoint(xz(prevStaLft), xz(prevEndLft), xz(staLft), xz(endLft));
            if (res.valid) ptSL = res.point;
          }
        }
      }

      // End-Right
      if (rhtNext.nearest * 0.5 !== 0 && rhtNext.result && !rhtNext.result.isVirtual) {
        const nextEndCen = rhtNext.result.other(this._end);
        if (nextEndCen) {
          const nextStaCen = rhtNext.result.other(nextEndCen);
          if (nextStaCen) {
            const r = nextEndCen.position
              .clone()
              .sub(nextStaCen.position)
              .normalize()
              .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
            const nextStaRht = nextStaCen.position.clone().add(r.clone().multiplyScalar(rhtNext.result.wallThick * 0.5));
            const nextEndRht = nextEndCen.position.clone().add(r.clone().multiplyScalar(rhtNext.result.wallThick * 0.5));
            const res = segmentsIntersectPoint(xz(staRht), xz(endRht), xz(nextStaRht), xz(nextEndRht));
            if (res.valid) ptER = res.point;
          }
        }
      }

      // End-Left
      if (lftNext.nearest * 0.5 !== 0 && lftNext.result && !lftNext.result.isVirtual) {
        const nextEndCen = lftNext.result.other(this._end);
        if (nextEndCen) {
          const nextStaCen = lftNext.result.other(nextEndCen);
          if (nextStaCen) {
            const r = nextEndCen.position
              .clone()
              .sub(nextStaCen.position)
              .normalize()
              .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
            const nextStaLft = nextStaCen.position.clone().sub(r.clone().multiplyScalar(lftNext.result.wallThick * 0.5));
            const nextEndLft = nextEndCen.position.clone().sub(r.clone().multiplyScalar(lftNext.result.wallThick * 0.5));
            const res = segmentsIntersectPoint(xz(staLft), xz(endLft), xz(nextStaLft), xz(nextEndLft));
            if (res.valid) ptEL = res.point;
          }
        }
      }
    }

    // Local-space 변환: dirRot의 역회전을 적용해 StartNode를 원점으로 한 로컬 좌표 6점 반환
    const invRot = dirRot.clone().invert();
    const startY = startPos.y;
    const to = (p2: Vector2) =>
      xzInv(p2, startY).clone().sub(startPos).applyQuaternion(invRot);

    return [
      to(ptSR),
      new Vector3().applyQuaternion(invRot), // zero
      to(ptSL),
      to(ptEL),
      endPos.clone().sub(startPos).applyQuaternion(invRot),
      to(ptER),
    ];
  }

  // ===== 정적 팩토리 =========================================

  /**
   * 새 벽을 생성하여 레지스트리에 등록한다.
   *
   * Unity `Wall.Create(parent, start, end, isVirtual)` 대응. `parent` Transform 인자는 제거,
   * 시각화 부모는 r3f 컴포넌트가 결정한다.
   *
   * @param start 시작 노드
   * @param end 끝 노드
   * @param registry 벽 레지스트리
   * @param isVirtual 가벽 여부 (기본값 false)
   */
  static create(start: Node, end: Node, registry: WallRegistry, isVirtual = false): Wall {
    const wall = new Wall(registry.nextWallIndex());
    wall.startNode = start;
    wall.endNode = end;
    wall.setVirtual(isVirtual);
    registry.addWall(wall);
    return wall;
  }

  /**
   * 벽을 삭제한다. 양쪽 노드의 연결이 끊기며, 연결 노드가 더 이상 어디에도
   * 속하지 않으면 해당 노드도 함께 삭제된다.
   *
   * TODO(port): Space 재계산 (Unity 원본 Wall.cs:468의 `SpaceBuilder` 호출 대응)을
   * Layout 모듈 포팅 시 추가한다.
   */
  static delete(wall: Wall, registry: WallRegistry): void {
    const startNode = wall._start;
    const endNode = wall._end;
    wall.startNode = null;
    wall.endNode = null;
    wall.isDestroying = true;

    if (startNode && startNode.walls.length === 0) {
      registry.removeNode(startNode);
    } else if (startNode) {
      startNode.setDirty();
    }

    if (endNode && endNode.walls.length === 0) {
      registry.removeNode(endNode);
    } else if (endNode) {
      endNode.setDirty();
    }

    // 본 벽이 속한 모든 Space 삭제
    const targetSpaces = [...wall._spaces];
    for (const space of targetSpaces) {
      registry.removeSpace(space);
    }

    registry.removeWall(wall);

    // TODO(port): SpaceBuilder 재호출로 새 폐쇄영역 검출
    //   Unity 원본 Wall.cs:468 — var builder = new Utils.SpaceBuilder(AllWalls);
  }

  // ===== 그리기 라이프사이클 =================================

  /**
   * Layout 편집 시 벽을 새로 그리기 시작 — 시작/끝 노드와 벽을 함께 생성한다.
   * Unity `Wall.OnLayoutStartDraw(SegmentInfo)` 대응.
   *
   * @param wallSegment 시작/끝 좌표 + 두께 + 가상벽 여부
   * @param registry NodeRegistry + WallRegistry를 모두 지원하는 통합 레지스트리
   */
  static onLayoutStartDraw(
    wallSegment: SegmentInfo,
    registry: WallRegistry & {
      findByPosition(p: Vector3): Node | undefined;
      addNode(n: Node): void;
      nextNodeIndex(): number;
    },
    nodeFactory: (position: Vector3) => Node,
  ): Wall {
    const startNode = nodeFactory(wallSegment.start);
    const endNode = nodeFactory(wallSegment.end);
    const wall = Wall.create(startNode, endNode, registry, wallSegment.wallType === WallType.VIRTUAL);
    wall.wallThick = wallSegment.thickness;
    return wall;
  }

  /**
   * 확장 세그먼트(높이/내력벽 타입 포함)로 벽을 시작한다.
   * Unity `Wall.OnLayoutStartDraw(SegmentInfoDraw)` 오버로드.
   */
  static onLayoutStartDrawWithDetail(
    info: SegmentInfoDraw,
    registry: WallRegistry & {
      findByPosition(p: Vector3): Node | undefined;
      addNode(n: Node): void;
      nextNodeIndex(): number;
    },
    nodeFactory: (position: Vector3) => Node,
  ): Wall {
    const wall = Wall.onLayoutStartDraw(info, registry, nodeFactory);
    wall.wallHeight = info.height;
    wall.bearingType = info.bearingType;
    return wall;
  }

  /**
   * 드래그 중 벽 끝점이 움직일 때 호출 — 시작/끝 노드 위치를 즉시 갱신.
   * Unity `Wall.OnLayoutUpdateDraw(SegmentInfo)`.
   */
  onLayoutUpdateDraw(wallSegment: SegmentInfo): void {
    if (this._start) this._start.position = wallSegment.start;
    if (this._end) this._end.position = wallSegment.end;
  }

  /**
   * 벽 그리기 완료 시 호출 — 폐쇄영역(공간) 자동 검출 트리거.
   *
   * TODO(port): `SpaceBuilder` 포팅 완료 후 활성화.
   * Unity 원본: `var builder = new Utils.SpaceBuilder(AllWalls);`
   */
  onLayoutComplete(): void {
    // TODO(port): SpaceBuilder(allWalls) 트리거 — 호출자(SpaceManager)가 buildSpaces() 직접 호출
  }

  // ===== 문/창호 삽입·제거 ==================================

  /**
   * 본 벽에 문/창호 제품을 삽입한다. 이미 포함된 제품이면 무시.
   *
   * 삽입 시 제품의 위치를 본 벽 진행 직선에 수직 투영(foot of perpendicular)으로 옮긴다 —
   * 사용자가 벽 근처에 놓은 제품이 벽 위로 자동 스냅된다.
   *
   * Unity `Wall.Insert(ProductWallFilled)` 1:1 포팅.
   */
  insert(filled: ProductWallFilled): void {
    if (this.filledObjects.includes(filled)) return;
    if (!this._start) return;

    filled.parent = this;
    this.filledObjects.push(filled);

    // 벽 시작점 + Direction(진행방향)을 레이로 보고, 제품 위치를 그 위로 수직 투영
    const foot = footOfPerpendicular(this._start.position, this.direction, filled.position);
    foot.y = filled.position.y; // 높이는 유지
    filled.position.copy(foot);

    this.setDirty();
  }

  /**
   * 본 벽에서 문/창호 제품을 제거한다. 포함되지 않은 제품이면 무시.
   * Unity `Wall.Remove(ProductWallFilled)` 1:1 포팅.
   */
  remove(filled: ProductWallFilled): void {
    const idx = this.filledObjects.indexOf(filled);
    if (idx < 0) return;
    this.filledObjects.splice(idx, 1);
    filled.parent = null;
    this.setDirty();
  }
}

/**
 * 벽 생성/삭제 시 필요한 레지스트리 작업 인터페이스.
 *
 * `Wall` 클래스가 Zustand 스토어에 직접 의존하지 않고 본 인터페이스만 의존하게 하여
 * 테스트 가능성을 확보한다. 실제 구현은 `state.ts`의 `useLayoutStore`가 제공한다.
 */
export interface WallRegistry {
  addWall(wall: Wall): void;
  removeWall(wall: Wall): void;
  removeNode(node: Node): void;
  removeSpace(space: Space): void;
  nextWallIndex(): number;
}