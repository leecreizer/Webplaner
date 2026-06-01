import { Vector3 } from 'three';
import { ObjectBase } from '@/domain/structures/ObjectBase';
import { EPSILON } from '@/lib/math/Math';
import { flatSqrDistance } from '@/lib/math/VectorExtensions';
import type { Wall } from '@/domain/structures/Wall';

/**
 * 벽체 연결점(노드). 위치 정보와 연결된 벽체 목록을 관리한다.
 *
 * Unity `Layout.Node` 1:1 포팅. 차이점:
 * - Unity에서는 `MonoBehaviour`로 `transform.position`을 통해 위치를 보관했으나,
 *   TS 포팅판은 데이터 클래스로 분리하여 위치를 직접 필드에 저장한다.
 * - 정적 `AllNodes` 레지스트리는 {@link useLayoutStore}(Zustand)로 옮겼다.
 *   본 클래스는 인스턴스 동작만 책임진다.
 */
export class Node extends ObjectBase {
  /** 노드 고유 인덱스 (저장/로드 시 {@link WallData.nodeIndices}가 참조). */
  readonly nodeIndex: number;

  /** 이 노드에 연결된 벽체 목록. */
  walls: Wall[] = [];

  /** 노드의 3D 위치 (m). 내부 직접 접근 금지 — {@link position} getter/setter 사용. */
  private _position: Vector3;

  /** 노드를 시각적으로 표시할 때 사용하는 기본 반지름(m). */
  static readonly DRAW_RADIUS = 0.1;

  /**
   * 팩토리 메서드({@link create})를 통해서만 생성한다.
   * 외부 직접 `new Node(...)`는 권장하지 않음(중복 노드 방지 로직 우회됨).
   *
   * @internal
   */
  constructor(nodeIndex: number, position: Vector3) {
    super();
    this.nodeIndex = nodeIndex;
    this._position = position.clone();
  }

  /**
   * 노드의 3D 위치를 가져온다. 반환되는 Vector3는 노드 내부 상태의 복사본이 아니라
   * **참조**이므로, 직접 mutate하지 말 것 — 위치를 변경할 때는 {@link position}.set을 통해 setter를 호출하라.
   */
  get position(): Vector3 {
    return this._position;
  }

  /**
   * 노드의 3D 위치를 설정한다. 위치 변경 시 본 노드 및 연결된 벽체의 반대쪽 노드까지
   * 모두 Dirty 상태로 설정한다 (Unity 원본과 동일한 cascading 동작).
   */
  set position(value: Vector3) {
    this._position.copy(value);
    this.setDirty();
    for (const wall of this.walls) {
      const other = wall.other(this);
      if (other) other.setDirty();
    }
  }

  /**
   * 노드를 Dirty 상태로 설정한다. 이미 Dirty면 단락하여 무한 재귀를 방지하며,
   * 연결된 모든 벽체도 Dirty로 설정한다.
   */
  override setDirty(): void {
    if (this.isDirty) return;
    super.setDirty();
    for (const wall of this.walls) {
      wall.setDirty();
    }
  }

  /**
   * 동일 위치({@link EPSILON} 이내)에 기존 노드가 있으면 그것을 반환하고,
   * 없으면 새 노드를 생성하여 레지스트리에 등록한다.
   *
   * Unity의 `Node.Create(parent, position)` 대응. `parent` Transform 인자는 Three.js에서
   * 불필요해 제거했다 (씬 그래프 부모는 r3f 컴포넌트에서 결정).
   *
   * @param position 노드의 월드 좌표(m)
   * @param registry 노드 레지스트리. 미지정 시 {@link useLayoutStore} 기본 인스턴스 사용.
   */
  static create(position: Vector3, registry: NodeRegistry): Node {
    const existing = registry.findByPosition(position);
    if (existing) return existing;

    const node = new Node(registry.nextNodeIndex(), position);
    registry.addNode(node);
    return node;
  }

  /**
   * 지정된 노드와 그에 연결된 모든 벽체를 삭제한다.
   *
   * @param node 삭제할 노드
   * @param registry 노드/벽 레지스트리
   */
  static delete(node: Node, registry: NodeRegistry): void {
    // walls 리스트를 복사한 뒤 순회 — 삭제 도중 원본이 변경되는 것을 막기 위함.
    const wallsCopy = [...node.walls];
    for (const wall of wallsCopy) {
      registry.removeWall(wall);
    }
    registry.removeNode(node);
  }
}

/**
 * 노드 생성/삭제 시 필요한 레지스트리 작업 인터페이스.
 *
 * `Node` 클래스가 Zustand 스토어에 직접 의존하지 않고 본 인터페이스만 의존하게 하여,
 * 테스트 시 메모리 기반 mock 레지스트리를 주입할 수 있게 한다.
 *
 * 실제 구현은 `state.ts`의 `useLayoutStore`가 제공한다.
 */
export interface NodeRegistry {
  /** 위치가 일치하는 노드를 찾는다 (XZ 평면, EPSILON 이내). */
  findByPosition(position: Vector3): Node | undefined;
  /** 새 노드를 등록한다. */
  addNode(node: Node): void;
  /** 노드를 제거한다 (연결 벽은 별도 호출자가 정리). */
  removeNode(node: Node): void;
  /** 벽을 제거한다 (양쪽 노드의 walls 배열에서도 제거). */
  removeWall(wall: Wall): void;
  /** 다음에 할당할 nodeIndex 값을 반환한다 (호출 시 카운터 증가). */
  nextNodeIndex(): number;
}

/**
 * 인메모리 노드 레지스트리 구현. 정적 컬렉션만 사용하는 단순 버전이며,
 * Zustand 스토어와 동기화하지 않는다. 테스트 또는 도구 스크립트용.
 */
export class InMemoryNodeRegistry implements NodeRegistry {
  readonly nodes: Node[] = [];
  readonly walls: Wall[] = [];
  private _nextNodeIdx = 0;

  findByPosition(position: Vector3): Node | undefined {
    const eps2 = EPSILON * EPSILON;
    return this.nodes.find((n) => flatSqrDistance(n.position, position) < eps2);
  }

  addNode(node: Node): void {
    this.nodes.push(node);
  }

  removeNode(node: Node): void {
    const idx = this.nodes.indexOf(node);
    if (idx >= 0) this.nodes.splice(idx, 1);
  }

  removeWall(wall: Wall): void {
    const idx = this.walls.indexOf(wall);
    if (idx >= 0) this.walls.splice(idx, 1);
    // 노드의 walls 배열에서도 제거
    for (const node of this.nodes) {
      const wi = node.walls.indexOf(wall);
      if (wi >= 0) node.walls.splice(wi, 1);
    }
  }

  nextNodeIndex(): number {
    return this._nextNodeIdx++;
  }
}