import { PerspectiveCamera, OrthographicCamera } from 'three';
import { useLayoutStore } from '@/domain/state/layoutStore';
import { vector3ToVectorData } from '@/persistence/PlanSaveData';
import type {
  CameraSaveData,
  PlanSaveData,
  RenderPlanSaveData,
  NodeData,
  WallData,
  SpaceData,
  ProductData,
  BearingTypeStr,
} from '@/persistence/PlanSaveData';
import { BearingType } from '@/domain/structures/Wall';
import type { Wall } from '@/domain/structures/Wall';
import type { Space } from '@/domain/structures/Space';
import type { ProductInfo } from '@/domain/products/ProductInfo';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { isModuleWall } from '@/features/spaceModules/syncModuleWalls';
import { modulesToSaveData } from '@/features/spaceModules/serialization';

/**
 * 현재 평면도 상태 + 카메라 상태 → `RenderPlanSaveData` JSON DTO 빌더.
 *
 * Unity `SaveLoad.PlanDataHandler.GenerateRenderPlanData(int renderWidth, int renderHeight)` 대응.
 *
 * 이 DTO는 Snapit `/process`에 `plan_data` 필드로 함께 전송되며, Gemini 프롬프트에 평면도
 * 컨텍스트(카메라 구도 + 노드/벽/공간 구조)를 주입하는 데 사용된다.
 *
 * ### 호출 예시
 * ```ts
 * import { generateRenderPlanData } from './RenderPlanBuilder';
 * const plan = generateRenderPlanData(camera, 1920, 1080);
 * await snapit.process({ ...renderOpts, plan_data: plan });
 * ```
 */

/**
 * 현재 평면도와 지정 카메라로부터 렌더 요청용 DTO를 만든다.
 *
 * @param camera Three.js Camera (perspective 또는 orthographic). 빈 `PerspectiveCamera`라도 OK.
 * @param renderWidth 캡처 가로 해상도(px)
 * @param renderHeight 캡처 세로 해상도(px)
 */
export function generateRenderPlanData(
  camera: PerspectiveCamera | OrthographicCamera,
  renderWidth: number,
  renderHeight: number,
): RenderPlanSaveData {
  return {
    cameraSaveData: buildCameraData(camera, renderWidth, renderHeight),
    planSaveData: buildPlanData(),
  };
}

/**
 * 카메라 객체로부터 {@link CameraSaveData}를 만든다.
 * Unity `PlanDataHandler.GenerateCameraData(renderWidth, renderHeight)` 대응.
 *
 * Orthographic 카메라는 Unity 원본도 `"perspective"`로 저장하지만, 본 구현은 실제 타입을 반영한다.
 */
export function buildCameraData(
  camera: PerspectiveCamera | OrthographicCamera,
  renderWidth: number,
  renderHeight: number,
): CameraSaveData {
  const isPersp = (camera as PerspectiveCamera).isPerspectiveCamera === true;
  const fov = isPersp ? (camera as PerspectiveCamera).fov : 0;
  const eulerDeg = {
    x: (camera.rotation.x * 180) / Math.PI,
    y: (camera.rotation.y * 180) / Math.PI,
    z: (camera.rotation.z * 180) / Math.PI,
  };

  return {
    position: vector3ToVectorData(camera.position),
    rotationEuler: eulerDeg,
    projection: isPersp ? 'perspective' : 'orthographic',
    fieldOfView: fov,
    nearClipPlane: camera.near,
    farClipPlane: camera.far,
    renderWidth,
    renderHeight,
  };
}

/**
 * 현재 Zustand 스토어의 노드/벽/공간 → {@link PlanSaveData}.
 * Unity `PlanDataHandler.GeneratePlanData()` 대응 — 파일 저장 플로우와도 동일한 루트.
 */
export function buildPlanData(): PlanSaveData {
  const { nodes, walls, spaces } = useLayoutStore.getState();

  // 모듈발 벽(그린 벽 아님)은 로드 시 syncModuleWalls()가 spaceModules로부터 재생성하므로
  // 저장 대상에서 제외한다 — 안 그러면 로드 때 중복 생성된다.
  const nonModuleWalls = walls.filter((w) => !isModuleWall(w));
  const nonModuleWallSet = new Set(nonModuleWalls);

  // 모듈 벽에만 연결되어 저장 시 참조할 곳이 없어지는 orphan 노드도 함께 제외한다.
  const Nodes: NodeData[] = nodes
    .filter((n) => n.walls.some((w) => nonModuleWallSet.has(w)))
    .map((n) => ({
      nodeIndex: n.nodeIndex,
      position: vector3ToVectorData(n.position),
    }));

  const Walls: WallData[] = nonModuleWalls.map(wallToData);

  const Spaces: SpaceData[] = spaces.map(spaceToData);

  // OrphanProducts — 아직 SpaceEmpty 개념 미포팅이라 빈 배열
  const OrphanProducts: ProductData[] = [];

  const spaceModules = modulesToSaveData(useSpaceModuleStore.getState().modules);

  return { Nodes, Walls, Spaces, OrphanProducts, spaceModules };
}

// ============================================================
// 내부 변환 헬퍼
// ============================================================

function wallToData(wall: Wall): WallData {
  return {
    wallIndex: wall.wallIndex,
    nodeIndices: [wall.startNode?.nodeIndex ?? -1, wall.endNode?.nodeIndex ?? -1],
    isVirtual: wall.isVirtual,
    thickness: wall.wallThick,
    height: wall.wallHeight,
    bearingType: bearingTypeToStr(wall.bearingType),
    // TODO(port): ProductWallFilled 포팅 후 wall.filledObjects → FilledObjectData[]
    filledObjects: [],
  };
}

function spaceToData(space: Space): SpaceData {
  // wallIndices: 본 공간을 구성하는 벽 인덱스 목록
  const wallIndices: number[] = [];
  for (const [wall] of space.walls) {
    wallIndices.push(wall.wallIndex);
  }

  return {
    spaceIndex: space.spaceIndex,
    wallIndices,
    spaceName: space.name,
    products: space.allProducts.map(productInfoToData),
  };
}

function productInfoToData(p: ProductInfo): ProductData {
  const cm = p.contentsMaster;
  return {
    worldPosition: vector3ToVectorData(p.position),
    worldRotationEuler: vector3ToVectorData(p.rotationEuler),
    size: vector3ToVectorData(p.size),
    contentsMaster: cm
      ? {
          brandCD: cm.brandCD,
          contentsCD2: cm.contentsCD2,
          contentsCD: cm.contentsCD,
          gdsCD: cm.gdsCD,
          contentsNM: cm.contentsNM,
          length: cm.length,
          depth: cm.depth,
          height: cm.height,
          // PlaceProductParam.pos는 string | null, ContentsMasterData.pos는 PosStr (좁은 union)
          pos: (cm.pos as 'floor' | 'wall' | 'ceiling' | null) ?? null,
          contentsType: cm.contentsType,
          placeHeight: cm.placeHeight,
          spec: cm.spec,
          mallURL: cm.mallURL,
          price: cm.price,
          assetURL: cm.assetURL,
        }
      : {
          brandCD: null,
          contentsCD2: null,
          contentsCD: null,
          gdsCD: null,
          contentsNM: null,
          length: 0,
          depth: 0,
          height: 0,
          pos: null,
          contentsType: null,
          placeHeight: 0,
          spec: null,
          mallURL: null,
          price: 0,
          assetURL: '',
        },
  };
}

function bearingTypeToStr(b: BearingType): BearingTypeStr {
  return b === BearingType.BW ? 'BW' : 'NBW';
}