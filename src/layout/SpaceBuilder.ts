import { Wall, WallSide } from '../structures/Wall';
import type { Node } from '../structures/Node';
import { Space, type SpaceRegistry } from '../structures/Space';

/**
 * 벽체 목록으로부터 폐쇄 공간(Space)을 자동 구성하는 빌더.
 *
 * Unity `Utils.SpaceBuilder` 1:1 포팅.
 *
 * 알고리즘 — Half-Edge 기반 평면 그래프 면 분해:
 * 1. 차수 1 노드에 연결된 막다른 벽을 반복 제거 (`filterDanglingEdges`)
 * 2. 각 Wall을 양방향 반변 2개로 분해 (`HalfEdge`)
 * 3. 각 노드에서 출발하는 반변을 angle순(`Math.atan2`)으로 정렬
 * 4. 각 반변에 대해 next 포인터 설정 (twin의 직전 반변)
 * 5. next 체인을 따라 모든 면을 추적하고 signedArea > 0(CCW = 내부) 면만 Space 생성
 *
 * `Wall.onLayoutComplete()` / `Wall.delete()` / `SpaceManager.buildWall` 등에서 호출된다.
 */

/**
 * Half-Edge(반변) 자료구조 — 각 Wall의 한 방향을 나타낸다.
 * @internal
 */
interface HalfEdge {
  origin: Node;
  target: Node;
  wall: Wall;
  twin: HalfEdge | null;
  next: HalfEdge | null;
  visited: boolean;
}

/**
 * 벽 목록을 받아 폐쇄 공간을 자동 구성한다.
 *
 * @param walls 후보 벽 목록. 본 함수는 입력 배열을 수정하지 않는다.
 * @param registry Space 생성에 사용할 레지스트리 (`useLayoutStore` 어댑터)
 * @returns 본 호출에서 새로 생성되거나 갱신된 Space 목록
 */
export function buildSpaces(walls: readonly Wall[], registry: SpaceRegistry): Space[] {
  // 바닥/천정 생성을 위해 벽면 정보 업데이트
  for (const wall of walls) {
    wall.updateWallFace();
  }
  return _buildSpaceHalfEdge([...walls], registry);
}

/**
 * 차수 1인 노드에 연결된 벽(막다른 벽)을 반복적으로 제거한다.
 * 폐쇄 곡선을 구성할 수 없는 막다른 벽을 사전 필터링.
 */
function _filterDanglingEdges(walls: readonly Wall[]): Wall[] {
  let result = [...walls];
  let changed = true;
  while (changed) {
    changed = false;
    const nodeDegree = new Map<Node, number>();
    for (const wall of result) {
      if (wall.startNode) {
        nodeDegree.set(wall.startNode, (nodeDegree.get(wall.startNode) ?? 0) + 1);
      }
      if (wall.endNode) {
        nodeDegree.set(wall.endNode, (nodeDegree.get(wall.endNode) ?? 0) + 1);
      }
    }
    for (let i = result.length - 1; i >= 0; i--) {
      const w = result[i];
      const startDeg = w.startNode ? (nodeDegree.get(w.startNode) ?? 0) : 0;
      const endDeg = w.endNode ? (nodeDegree.get(w.endNode) ?? 0) : 0;
      if (startDeg < 2 || endDeg < 2) {
        result.splice(i, 1);
        changed = true;
      }
    }
  }
  return result;
}

/**
 * Half-Edge 기반으로 벽체 그래프의 모든 최소 면을 한 번에 탐색한다.
 * Unity `SpaceBuilder.BuildSpace` 1:1 포팅.
 */
function _buildSpaceHalfEdge(walls: Wall[], registry: SpaceRegistry): Space[] {
  const validWalls = _filterDanglingEdges(walls);
  if (validWalls.length < 3) return [];

  const halfEdges: HalfEdge[] = [];
  for (const wall of validWalls) {
    if (!wall.startNode || !wall.endNode) continue;
    const h1: HalfEdge = {
      origin: wall.startNode,
      target: wall.endNode,
      wall,
      twin: null,
      next: null,
      visited: false,
    };
    const h2: HalfEdge = {
      origin: wall.endNode,
      target: wall.startNode,
      wall,
      twin: null,
      next: null,
      visited: false,
    };
    h1.twin = h2;
    h2.twin = h1;
    halfEdges.push(h1, h2);
  }

  // 각 노드에서 출발하는 반변들을 angle순 정렬
  const outgoingMap = new Map<Node, HalfEdge[]>();
  for (const he of halfEdges) {
    const list = outgoingMap.get(he.origin) ?? [];
    list.push(he);
    outgoingMap.set(he.origin, list);
  }
  for (const list of outgoingMap.values()) {
    list.sort((a, b) => {
      const angleA = Math.atan2(
        a.target.position.z - a.origin.position.z,
        a.target.position.x - a.origin.position.x,
      );
      const angleB = Math.atan2(
        b.target.position.z - b.origin.position.z,
        b.target.position.x - b.origin.position.x,
      );
      return angleA - angleB;
    });
  }

  // next = twin의 직전(angle 기준 prev) 반변
  for (const he of halfEdges) {
    const outgoing = outgoingMap.get(he.target);
    if (!outgoing || !he.twin) continue;
    const twinIdx = outgoing.indexOf(he.twin);
    const prevIdx = (twinIdx - 1 + outgoing.length) % outgoing.length;
    he.next = outgoing[prevIdx];
  }

  const createdSpaces: Space[] = [];
  for (const startHe of halfEdges) {
    if (startHe.visited) continue;

    const faceEdges: HalfEdge[] = [];
    let current: HalfEdge | null = startHe;
    do {
      if (!current || current.visited) break;
      current.visited = true;
      faceEdges.push(current);
      current = current.next;
    } while (current !== startHe);

    // Signed area로 CCW(내부) 판정
    let signedArea = 0;
    for (const he of faceEdges) {
      const a = he.origin.position;
      const b = he.target.position;
      signedArea += a.x * b.z - b.x * a.z;
    }
    signedArea *= 0.5;

    if (signedArea > 0) {
      const faceWalls = faceEdges.map((he) => he.wall);
      faceWalls.reverse();
      const space = _generateFloor(faceWalls, registry);
      if (space) createdSpaces.push(space);
    }
  }
  return createdSpaces;
}

/**
 * 순서대로 정렬된 벽 목록으로 Space를 생성한다.
 * 순회 방향(CW/CCW)을 기반으로 각 벽의 공간 쪽 면을 결정해 `wallSides` 매핑을 구성한다.
 *
 * Unity `SpaceBuilder.GenerateFloor` 1:1 포팅.
 *
 * @param walls 폐쇄 곡선을 따라 정렬된 벽 목록
 * @param registry Space 레지스트리
 */
function _generateFloor(walls: Wall[], registry: SpaceRegistry): Space | null {
  const wallCount = walls.length;
  if (wallCount < 3) return null;

  const wallSides = new Map<Wall, WallSide>();

  // 1) 벽체 순회 순서에 맞는 연속 노드 리스트 구성
  const nodes: Node[] = [];
  const w0 = walls[0];
  const w1 = walls[1];
  if (!w0.startNode || !w0.endNode || !w1.startNode || !w1.endNode) return null;

  let sharedNode: Node;
  if (w0.startNode === w1.startNode || w0.startNode === w1.endNode) {
    sharedNode = w0.startNode;
  } else {
    sharedNode = w0.endNode;
  }

  let current = w0.other(sharedNode);
  if (!current) return null;
  nodes.push(current);

  for (let i = 0; i < wallCount; i++) {
    const next = walls[i].other(current);
    if (!next) return null;
    current = next;
    nodes.push(current);
  }

  // 2) Signed Area(Shoelace)로 순회 방향 판별
  let signedArea = 0;
  for (let i = 0; i < wallCount; i++) {
    const a = nodes[i].position;
    const b = nodes[i + 1].position;
    signedArea += a.x * b.z - b.x * a.z;
  }
  signedArea *= 0.5;
  const isCW = signedArea < 0;

  // 3) 순회 방향과 각 벽의 진행방향 관계로 공간 쪽 벽면 결정
  for (let i = 0; i < wallCount; i++) {
    const wall = walls[i];
    const sameDirection = nodes[i] === wall.startNode;
    wallSides.set(wall, sameDirection === isCW ? WallSide.RIGHT : WallSide.LEFT);
  }

  return Space.create(wallSides, registry);
}