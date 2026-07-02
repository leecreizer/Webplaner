import {
  Object3D,
  Mesh,
  Box3,
  Vector3,
  BufferAttribute,
} from 'three';

/**
 * helper 영역 기반 메시 스트레치 — Unity `ProductStretchable` + `VertexScaler`의 웹(Three.js) 포팅.
 *
 * GLB(상품 모델)에 이미 포함된 `helper` 노드의 자식 박스 메시(L/R/T/B/F/K)가 정의하는 영역(AABB)
 * 안의 정점들을, 해당 축 바깥 방향으로 이동시켜 상품 크기를 조정한다.
 *
 * ### 설계룰 ("홈플래너 3.0 - 로직 제어 룰 정의" 상품 크기 조정)
 * - 몸통 메인 메시 + 일반 구성품(childContents) 메시를 helper 영역 기준으로 **함께** 변형한다.
 * - `replaceableW`/`replaceableH` 노드 및 그 하위는 변형 대상에서 **제외**(고정 유지)한다.
 *
 * ### 좌표/변형 방식
 * 영역의 축은 helper 자식 이름의 머릿글자로 결정한다(L/R→x, T/B→y, F/K→z). 바깥 방향(sign)은
 * 영역 중심이 전체 메시 중심 기준 어느 쪽에 있는지로 판정한다(이름 규약에 의존하지 않음).
 * 한 축에 양/음 영역이 모두 있으면 델타를 절반씩 나눠 중심을 고정한 채 양쪽으로 늘린다.
 *
 * 정점 변형은 메시의 로컬 geometry에 직접 적용하므로, 빌드 시점에 메시 월드 행렬이 회전/스케일을
 * 포함하지 않는다(상품 회전/위치는 상위 `<primitive>`에서 적용)고 가정한다.
 */
export class HelperScaler {
  private readonly origSize: Vector3;
  private readonly regions: ScaleRegion[];

  private constructor(origSize: Vector3, regions: ScaleRegion[]) {
    this.origSize = origSize;
    this.regions = regions;
  }

  /** 인식된 helper 영역 개수. 0이면 이 모델은 helper 스트레치 불가(스케일 폴백 판단용). */
  get regionCount(): number {
    return this.regions.length;
  }

  /**
   * applyResize 가 정점을 실제로 변형하게 될 메시 집합.
   * 호출자가 **이 메시들만** geometry.clone() 하면 공유 캐시 오염 없이 변형 가능 —
   * 전체 메시를 무조건 깊은 복제하던 비용(배치 시 멈춤)을 제거한다.
   * (applyResize 는 apply 시점에 mesh.geometry 를 다시 읽으므로, build 이후에
   *  geometry 를 교체해도 정점 인덱스가 동일해 안전하다.)
   */
  get mutatedMeshes(): Mesh[] {
    const set = new Set<Mesh>();
    for (const r of this.regions) for (const v of r.verts) set.add(v.mesh);
    return [...set];
  }

  /** 진단용 — 빌드 결과(원본 치수, 영역별 축/방향/캡처 정점 수/박스 범위)를 반환. */
  getDiagnostics(): {
    origSize: { x: number; y: number; z: number };
    regionCount: number;
    regions: Array<{
      axis: string;
      sign: number;
      vertCount: number;
      shareDivisor: number;
    }>;
  } {
    return {
      origSize: { x: this.origSize.x, y: this.origSize.y, z: this.origSize.z },
      regionCount: this.regions.length,
      regions: this.regions.map((r) => ({
        axis: r.axis.key,
        sign: r.sign,
        vertCount: r.verts.length,
        shareDivisor: r.shareDivisor,
      })),
    };
  }

  /** GLB 루트(또는 그 clone)를 분석해 스케일러를 구성한다. */
  static build(root: Object3D): HelperScaler {
    root.updateMatrixWorld(true);

    const hotspotNode = findByName(root, 'hotspot');

    // 모든 메시 수집 후 역할 분류.
    // GLB export가 helper/replaceable 그룹 노드를 평탄화·제거하므로(실측), 부모 노드가 아니라
    // 메시 이름으로 판별한다: L/R/T/B/F/K(+연번) = helper 영역, 순수 숫자 = replaceable 구성품.
    const allMeshes: Mesh[] = [];
    root.traverse((obj) => {
      if (obj instanceof Mesh) allMeshes.push(obj);
    });

    const regionMeshes = allMeshes.filter((m) => axisOfHelper(m.name) !== null);
    const targetMeshes = allMeshes.filter((m) => isTransformable(m));

    // 원본 치수 = 변형 대상 메시 합산 bounding box.
    const combined = new Box3();
    for (const m of targetMeshes) combined.expandByObject(m);
    const origSize = new Vector3();
    combined.getSize(origSize);
    const center = new Vector3();
    combined.getCenter(center);

    const regions: ScaleRegion[] = [];
    for (const regionMesh of regionMeshes) {
      const axis = axisOfHelper(regionMesh.name);
      if (!axis) continue;

      const box = new Box3().setFromObject(regionMesh);
      const regionCenter = new Vector3();
      box.getCenter(regionCenter);
      const sign = Math.sign(regionCenter[axis.key] - center[axis.key]) || 1;

      const verts = collectVertices(targetMeshes, box);
      const hotspots = hotspotNode ? collectHotspots(hotspotNode, box) : [];

      regions.push({ axis, sign, verts, hotspots, shareDivisor: 1 });
    }

    // 축별 distinct sign 수 — 델타 분배 기준 (양/음 모두 있으면 2 → 절반씩).
    for (const r of regions) {
      const signs = new Set(
        regions.filter((o) => o.axis.key === r.axis.key).map((o) => o.sign),
      );
      r.shareDivisor = signs.size;
    }

    return new HelperScaler(origSize, regions);
  }

  /** 목표 치수(m)에 맞춰 변형 대상 메시 정점과 hotspot 위치를 이동한다. */
  applyResize(target: Vector3): void {
    const delta = {
      x: target.x - this.origSize.x,
      y: target.y - this.origSize.y,
      z: target.z - this.origSize.z,
    };

    const dirtyGeoms = new Set<Mesh>();
    const tmp = new Vector3();

    for (const r of this.regions) {
      const d = delta[r.axis.key];
      if (d === 0) continue;
      const move = (d / r.shareDivisor) * r.sign; // 월드 단위, 월드 축 기준

      for (const v of r.verts) {
        const attr = v.mesh.geometry.getAttribute('position') as BufferAttribute;
        // 로컬 단위·축(mm·Z-up 등)과 월드 단위·축(m·Y-up)이 다를 수 있으므로
        // 월드공간으로 변환해 이동한 뒤 다시 로컬로 되돌린다.
        tmp.set(attr.getX(v.index), attr.getY(v.index), attr.getZ(v.index));
        v.mesh.localToWorld(tmp);
        tmp[r.axis.key] += move;
        v.mesh.worldToLocal(tmp);
        attr.setXYZ(v.index, tmp.x, tmp.y, tmp.z);
        dirtyGeoms.add(v.mesh);
      }
      for (const h of r.hotspots) {
        h.getWorldPosition(tmp);
        tmp[r.axis.key] += move;
        if (h.parent) h.parent.worldToLocal(tmp);
        h.position.copy(tmp);
      }
    }

    for (const m of dirtyGeoms) {
      const attr = m.geometry.getAttribute('position') as BufferAttribute;
      attr.needsUpdate = true;
      m.geometry.computeBoundingBox();
      m.geometry.computeBoundingSphere();
    }
  }
}

interface Axis {
  key: 'x' | 'y' | 'z';
  offset: 0 | 1 | 2;
}

interface VertRef {
  mesh: Mesh;
  index: number;
}

interface ScaleRegion {
  axis: Axis;
  sign: number;
  verts: VertRef[];
  hotspots: Object3D[];
  shareDivisor: number;
}

const AXIS_X: Axis = { key: 'x', offset: 0 };
const AXIS_Y: Axis = { key: 'y', offset: 1 };
const AXIS_Z: Axis = { key: 'z', offset: 2 };

// GLTFLoader는 같은 이름의 노드/프리미티브가 여러 개면 `_1`, `_2` 접미사를 붙인다
// (예: "1000" → "1000_1","1000_2", "L" → "L" 또는 "L_1"). 모든 규칙에서 이 접미사를 허용한다.
const GLTF_SUFFIX = '(?:_\\d+)?';

/** helper 영역 메시 이름 규칙: 머릿글자(L/R/T/B/F/K) + 선택적 연번(+GLTF 접미사). 예: L, R, L1, K2, L_1. */
const REGION_NAME = new RegExp(`^([LRTBFK])\\d*${GLTF_SUFFIX}$`, 'i');
/** replaceable 구성품 메시 이름 규칙: 순수 숫자(사이즈)(+GLTF 접미사). 예: 900, 1000, 1000_2. */
const NUMERIC_NAME = new RegExp(`^\\d+${GLTF_SUFFIX}$`);

/** 이름이 helper 영역 메시(L/R/T/B/F/K[+연번]) 규칙에 맞는지. 렌더 숨김 판정 등에 사용. */
export function isHelperRegionName(name: string): boolean {
  return REGION_NAME.test(name.trim());
}

/**
 * replaceable 구성품 메시의 사이즈 값. 순수 숫자 이름(+GLTF 접미사)이면 그 숫자, 아니면 null.
 * 예: "900" → 900, "1000_2" → 1000, "L" → null.
 */
export function replaceableSizeOf(name: string): number | null {
  const m = /^(\d+)(?:_\d+)?$/.exec(name.trim());
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 사용 가능한 replaceable 사이즈들 중 입력 치수에 노출할 사이즈를 고른다.
 * 규칙: 입력값 이하 중 가장 큰 사이즈(해당 구간), 없으면 가장 작은 사이즈. 없으면 null.
 */
export function pickReplaceableSize(
  available: Iterable<number>,
  value: number,
): number | null {
  const arr = [...new Set(available)].sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const leq = arr.filter((s) => s <= value);
  return leq.length ? leq[leq.length - 1] : arr[0];
}

/** helper 영역 메시 이름 → 변형 축. 규칙에 안 맞으면 null. (L/R=x, T/B=y, F/K=z) */
function axisOfHelper(name: string): Axis | null {
  const m = REGION_NAME.exec(name.trim());
  if (!m) return null;
  switch (m[1].toUpperCase()) {
    case 'L':
    case 'R':
      return AXIS_X;
    case 'T':
    case 'B':
      return AXIS_Y;
    case 'F':
    case 'K':
      return AXIS_Z;
    default:
      return null;
  }
}

const EXCLUDE_NAMES = new Set(['helper', 'hotspot', 'meshwireframe', 'wireframe']);

/**
 * 변형 대상(몸통·일반 구성품) 여부.
 * 제외: helper 영역 메시(L/R/T/B/F/K), replaceable 구성품(순수 숫자 이름),
 * helper/hotspot/wireframe/replaceable* 서브트리.
 */
function isTransformable(mesh: Mesh): boolean {
  const self = mesh.name.trim();
  if (REGION_NAME.test(self)) return false;
  if (NUMERIC_NAME.test(self)) return false;

  let node: Object3D | null = mesh;
  while (node) {
    const n = node.name.toLowerCase();
    if (EXCLUDE_NAMES.has(n)) return false;
    if (n.startsWith('replaceable')) return false;
    node = node.parent;
  }
  return true;
}

function findByName(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** 대상 메시들의 정점 중 영역 box(world) 안에 드는 (mesh, index) 수집. */
function collectVertices(meshes: Mesh[], box: Box3): VertRef[] {
  const out: VertRef[] = [];
  const world = new Vector3();
  for (const mesh of meshes) {
    const attr = mesh.geometry.getAttribute('position') as
      | BufferAttribute
      | undefined;
    if (!attr) continue;
    for (let i = 0; i < attr.count; i++) {
      world.set(attr.getX(i), attr.getY(i), attr.getZ(i));
      mesh.localToWorld(world);
      if (box.containsPoint(world)) out.push({ mesh, index: i });
    }
  }
  return out;
}

/** hotspot 자식 중 영역 box 안에 위치한 노드 수집. */
function collectHotspots(hotspotNode: Object3D, box: Box3): Object3D[] {
  const out: Object3D[] = [];
  const world = new Vector3();
  for (const child of hotspotNode.children) {
    child.getWorldPosition(world);
    if (box.containsPoint(world)) out.push(child);
  }
  return out;
}