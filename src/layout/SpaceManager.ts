import { Vector2, Vector3 } from 'three';
import { Wall, type Face, type SegmentInfo, WallType } from '../structures/Wall';
import { Node } from '../structures/Node';
import { Space } from '../structures/Space';
import { useLayoutStore, layoutRegistry } from '../structures/state';
import { buildSpaces } from './SpaceBuilder';
import { approximately } from '../utils/Math';

/**
 * 레이아웃 스타일 — 공간 분리 가이드라인 표시 방향.
 * Unity `SpaceManager.eLayoutStyle` 대응.
 */
export enum LayoutStyle {
  NONE = 0,
  LEFT = 1,
  RIGHT = 2,
  BOTH = 3,
}

/**
 * 공간 경계 상자 — 여러 벽면이 같은 직선을 이루는 경우를 누적하여 가구 배치용 영역으로 활용.
 *
 * Unity `SpaceManager.SpaceBoundingBox` 1:1 포팅.
 */
export class SpaceBoundingBox {
  center: Vector3 = new Vector3();
  /** 공간이 향하는 법선 방향. */
  normal: Vector3 = new Vector3();
  /** 누적 길이(벽체 방향). */
  length: number = 0;
  /** 벽 높이. */
  height: number = 0;

  /**
   * 지정된 벽체와 기준점으로 바운딩 박스를 병합한다.
   * Unity 원본 `SpaceBoundingBox.Merge(wall, pt)`.
   */
  merge(wall: Wall, pt: Vector3): void {
    const face: Face = wall.findNearestFace(pt);
    const start = face.start;
    const end = face.end;
    const center = start.clone().add(end).multiplyScalar(0.5);
    this.center = center
      .clone()
      .add(this.center.clone().sub(center).normalize().multiplyScalar(this.length * 0.5));
    this.length += end.clone().sub(start).length();
    this.normal = face.forward.clone();
    this.height = wall.wallHeight;
  }
}

/**
 * 벽·공간 라이프사이클을 묶어 노출하는 정적 매니저.
 *
 * Unity의 `SpaceManager` 싱글톤이지만, TS 포팅에서는 Zustand 스토어가 상태를 보유하므로
 * 본 클래스는 *순수 정적 함수 모음*으로만 유지한다.
 *
 * ### 포팅 상태
 * - **완료**: buildWall / clearWalls / flipHorizontal / flipVertical / restoreSpaceNames
 * - **TODO**: iterateConnectedWalls (Direction dot 평행 그룹 탐색) — 호출자 등장 시 추가
 * - **TODO**: layoutStyle 자동 결정 — UI 도구 포팅 후
 */
export class SpaceManager {
  /** 현재 레이아웃 스타일 (UI 가이드라인용). */
  static layoutStyle: LayoutStyle = LayoutStyle.NONE;

  /**
   * 세그먼트 배열로부터 벽과 공간을 한 번에 구성한다.
   * Unity `SpaceManager.BuildWall(segments)` 1:1 포팅.
   *
   * 기존 벽/공간/제품을 모두 정리한 뒤, 각 세그먼트로 노드/벽을 생성하고
   * `buildSpaces`로 폐쇄 공간을 자동 추출한다.
   */
  static buildWall(wallSegments: readonly SegmentInfo[]): void {
    SpaceManager.clearWalls();

    const registry = layoutRegistry;
    const nodeFactory = (position: Vector3) => Node.create(position, registry);

    for (const seg of wallSegments) {
      const startNode = nodeFactory(seg.start);
      const endNode = nodeFactory(seg.end);
      const wall = Wall.create(startNode, endNode, registry, seg.wallType === WallType.VIRTUAL);
      wall.wallThick = seg.thickness;
    }

    buildSpaces(useLayoutStore.getState().walls, registry);
  }

  /**
   * 모든 벽을 삭제한다 (공간/제품도 함께 정리).
   * Unity `SpaceManager.ClearWalls`.
   */
  static clearWalls(): void {
    const allWalls = [...useLayoutStore.getState().walls];
    for (const wall of allWalls) {
      Wall.delete(wall, layoutRegistry);
    }
    // TODO(port): productRoot 자식 정리 / ProductAssetManager.releaseAll() / MeshOctreeCache.clear() /
    //             SubTaskEditBase.clearAllPickedInfo() — Products/Tasks 모듈 포팅 시 추가
  }

  /**
   * 모든 노드를 X 좌표 기준(전체 바운딩의 가로 중심)으로 좌우 반전 후 공간을 재구성한다.
   * 공간 이름은 반전 전 중심점을 기준으로 자동 매칭/복원한다.
   *
   * Unity `SpaceManager.FlipHorizontal` 1:1 포팅.
   */
  static flipHorizontal(): void {
    const nodes = useLayoutStore.getState().nodes;
    if (nodes.length === 0) return;

    let minX = Number.MAX_VALUE;
    let maxX = -Number.MAX_VALUE;
    for (const node of nodes) {
      if (node.position.x < minX) minX = node.position.x;
      if (node.position.x > maxX) maxX = node.position.x;
    }
    const centerX = (minX + maxX) * 0.5;

    const spaceSnapshots: Array<{ center: Vector2; name: string }> = [];
    for (const s of useLayoutStore.getState().spaces) {
      s.updateCenter();
      spaceSnapshots.push({
        center: new Vector2(2 * centerX - s.center.x, s.center.z),
        name: s.name,
      });
    }

    for (const node of nodes) {
      const p = node.position.clone();
      p.x = 2 * centerX - p.x;
      node.position = p;
    }

    SpaceManager._rebuildSpacesPreservingNames(spaceSnapshots);
  }

  /**
   * 모든 노드를 Z 좌표 기준으로 상하 반전.
   * Unity `SpaceManager.FlipVertical`.
   */
  static flipVertical(): void {
    const nodes = useLayoutStore.getState().nodes;
    if (nodes.length === 0) return;

    let minZ = Number.MAX_VALUE;
    let maxZ = -Number.MAX_VALUE;
    for (const node of nodes) {
      if (node.position.z < minZ) minZ = node.position.z;
      if (node.position.z > maxZ) maxZ = node.position.z;
    }
    const centerZ = (minZ + maxZ) * 0.5;

    const spaceSnapshots: Array<{ center: Vector2; name: string }> = [];
    for (const s of useLayoutStore.getState().spaces) {
      s.updateCenter();
      spaceSnapshots.push({
        center: new Vector2(s.center.x, 2 * centerZ - s.center.z),
        name: s.name,
      });
    }

    for (const node of nodes) {
      const p = node.position.clone();
      p.z = 2 * centerZ - p.z;
      node.position = p;
    }

    SpaceManager._rebuildSpacesPreservingNames(spaceSnapshots);
  }

  /**
   * 공간을 재구성하면서 이름을 복원하는 공통 헬퍼.
   * 1. 기존 공간을 모두 삭제
   * 2. `suppressInitName = true`로 buildSpaces 호출 (자동 이름 부여 차단)
   * 3. `restoreSpaceNames`로 스냅샷 매칭
   */
  private static _rebuildSpacesPreservingNames(
    spaceSnapshots: Array<{ center: Vector2; name: string }>,
  ): void {
    const allSpaces = [...useLayoutStore.getState().spaces];
    for (const space of allSpaces) {
      Space.delete(space, layoutRegistry);
    }

    Space.suppressInitName = true;
    buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
    Space.suppressInitName = false;

    SpaceManager.restoreSpaceNames(spaceSnapshots);
  }

  /**
   * 스냅샷 (중심점·이름) 쌍을 이용해 재생성된 공간에 이름을 복원한다.
   *
   * - **1단계**: 스냅샷 중심점이 새 공간 폴리곤 내부면 즉시 이름 할당
   * - **2단계(폴백)**: 매칭 실패한 스냅샷은 거리 최소(동거리 시 면적 큰 쪽) 공간에 할당
   *
   * Unity `SpaceManager.RestoreSpaceNames` 1:1 포팅.
   */
  static restoreSpaceNames(spaceSnapshots: Array<{ center: Vector2; name: string }>): void {
    const renamedSpaces = new Set<Space>();
    const unmatchedSnapshots: Array<{ center: Vector2; name: string }> = [];

    // 1단계: IsInside 매칭
    for (const { center, name } of spaceSnapshots) {
      let matched = false;
      for (const newSpace of useLayoutStore.getState().spaces) {
        if (renamedSpaces.has(newSpace)) continue;
        if (newSpace.isInside(center)) {
          newSpace.name = name;
          renamedSpaces.add(newSpace);
          matched = true;
          break;
        }
      }
      if (!matched) unmatchedSnapshots.push({ center, name });
    }

    if (unmatchedSnapshots.length === 0) return;

    // 2단계: 거리 기반 매칭
    const unmatchedSpaces = useLayoutStore
      .getState()
      .spaces.filter((s) => !renamedSpaces.has(s));
    for (const s of unmatchedSpaces) {
      s.updateCenter();
    }

    for (const { center, name } of unmatchedSnapshots) {
      let best: Space | null = null;
      let bestDist = Number.MAX_VALUE;
      let bestArea = -1;

      for (const candidate of unmatchedSpaces) {
        if (renamedSpaces.has(candidate)) continue;
        const cCenter = new Vector2(candidate.center.x, candidate.center.z);
        const dist = cCenter.distanceTo(center);

        const closer = dist < bestDist;
        const sameDistLargerArea = approximately(dist, bestDist) && candidate.area > bestArea;

        if (closer || sameDistLargerArea) {
          best = candidate;
          bestDist = dist;
          bestArea = candidate.area;
        }
      }

      if (best !== null) {
        best.name = name;
        renamedSpaces.add(best);
      }
    }
  }
}

/**
 * 빈 스텁 — Unity `WallManager` 싱글톤은 사실상 빈 클래스라 동일하게 비워둔다.
 *
 * 벽 컬렉션은 {@link useLayoutStore}가 직접 관리하며, 본 클래스는 추후 벽 생성 옵션·기본값
 * 보관소가 필요해질 경우 확장한다.
 */
export class WallManager {
  // 의도적으로 비어있음.
}