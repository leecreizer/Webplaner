import { Vector2, Vector3, Matrix4, Quaternion, BufferGeometry, BufferAttribute } from 'three';
import { Triangulator } from '../utils/Triangulator';

/**
 * BufferGeometry 빌더 모음.
 *
 * Unity `MeshGenerator`(588 LOC) 1:1 포팅. Unity의 `Mesh.vertices`/`uv`/`triangles` 패턴이
 * Three.js의 `BufferGeometry.setAttribute('position', ...)` 패턴으로 옮겨졌다. 본 함수들이
 * 반환하는 `BufferGeometry`는 r3f의 `<mesh><primitive .../></mesh>` 또는 `<bufferGeometry>`
 * JSX로 바로 바인딩할 수 있다.
 *
 * UV 매핑 / winding 순서 등은 모두 Unity 원본과 동일하게 유지한다.
 */

// ============================================================
// 평면 / 쿼드
// ============================================================

/**
 * 너비·높이로 평면 메시를 생성한다. Unity `MeshGenerator.Plane`.
 *
 * @param width 가로
 * @param height 세로
 * @param offset 위치 오프셋
 * @param direction 평면의 정면 방향 (기본 +Z)
 * @param uvMult UV 좌표 배율
 */
export function planeGeometry(
  width: number,
  height: number,
  offset: Vector3 = new Vector3(),
  direction: Vector3 = new Vector3(0, 0, 1),
  uvMult: number = 1,
): BufferGeometry {
  const rot = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction.clone().normalize());
  const w2 = width / 2;
  const h2 = height / 2;

  const v0 = offset.clone().add(new Vector3(-w2, +h2, 0).applyQuaternion(rot));
  const v1 = offset.clone().add(new Vector3(-w2, -h2, 0).applyQuaternion(rot));
  const v2 = offset.clone().add(new Vector3(+w2, -h2, 0).applyQuaternion(rot));
  const v3 = offset.clone().add(new Vector3(+w2, +h2, 0).applyQuaternion(rot));

  const vert = new Float32Array([
    v0.x, v0.y, v0.z,
    v1.x, v1.y, v1.z,
    v2.x, v2.y, v2.z,
    v3.x, v3.y, v3.z,
  ]);
  const uv = new Float32Array([
    -w2 * uvMult,  h2 * uvMult,
    -w2 * uvMult, -h2 * uvMult,
     w2 * uvMult, -h2 * uvMult,
     w2 * uvMult,  h2 * uvMult,
  ]);
  const tri = new Uint32Array([0, 1, 2, 0, 2, 3]);

  return buildGeometry(vert, uv, tri);
}

/** 4개 정점으로 사각형 메시. Unity `MeshGenerator.SimpleQuad`. */
export function simpleQuadGeometry(quads: readonly Vector3[]): BufferGeometry {
  if (quads.length < 4) throw new Error('simpleQuadGeometry: quads.length must be >= 4');
  const vert = new Float32Array([
    quads[0].x, quads[0].y, quads[0].z,
    quads[1].x, quads[1].y, quads[1].z,
    quads[2].x, quads[2].y, quads[2].z,
    quads[3].x, quads[3].y, quads[3].z,
  ]);
  const uv = new Float32Array([1, 0, 0, 0, 0, 1, 1, 1]);
  const tri = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return buildGeometry(vert, uv, tri);
}

// ============================================================
// 폴리곤 → 메시 (Triangulator 사용)
// ============================================================

/** 메시 정보 — 정점 + 삼각형 인덱스. Unity `MeshGenerator.MESHINFO`. */
export interface MeshInfo {
  vert: Vector3[];
  tri: number[];
}

/**
 * 2D 폴리곤 점 → 메시 정보 (단면, 두께 없음).
 * Unity `MeshGenerator.GeneratePolyToMeshInfo(points, origin, forward, reverse)`.
 *
 * @param points 폴리곤 꼭짓점 (XZ 평면)
 * @param origin 메시 원점
 * @param forward 메시 전방
 * @param reverse 삼각형 winding 반전
 */
export function polyToMeshInfo(
  points: readonly Vector2[],
  origin: Vector3,
  forward: Vector3,
  reverse: boolean = false,
): MeshInfo {
  // 2D point (x, y) → 3D world point. (x, 0, y)에 origin translation + forward rotation 적용.
  // 이전 구현은 *invTrans*를 적용해 origin이 0이 아니면 좌표가 역변환되는 버그가 있었음
  // (예: ceiling의 origin=(0, 2.4, 0) → invTrans 적용 시 y=-2.4로 떨어짐).
  const trans = new Matrix4().compose(
    origin,
    new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), forward.clone().normalize()),
    new Vector3(1, 1, 1),
  );

  const triangulator = new Triangulator(points as Vector2[]);
  let tri = triangulator.triangulate();

  const vert: Vector3[] = points.map((p) =>
    new Vector3(p.x, 0, p.y).applyMatrix4(trans),
  );

  if (reverse) tri = tri.slice().reverse();
  return { vert, tri };
}

/**
 * 2D 폴리곤 점 → 두께를 가진 메시 정보 (윗면/아랫면/측면 포함).
 * Unity `MeshGenerator.GeneratePolyToMeshInfo(..., thickness, ...)`.
 *
 * 측면은 별도의 정점을 사용해 hard edge 노멀을 지원한다.
 *
 * @param thickness Y축 음의 방향으로 압출되는 두께
 */
export function polyToMeshInfoExtruded(
  points: readonly Vector2[],
  origin: Vector3,
  forward: Vector3,
  thickness: number,
  reverse: boolean = false,
): MeshInfo {
  const trans = new Matrix4().compose(
    origin,
    new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), forward.clone().normalize()),
    new Vector3(1, 1, 1),
  );

  const triangulator = new Triangulator(points as Vector2[]);
  const faceTri = triangulator.triangulate();

  const n = points.length;
  const sideVertStart = n * 2;
  const totalVertCount = n * 2 + n * 4;
  const vert: Vector3[] = new Array(totalVertCount);

  for (let i = 0; i < n; i++) {
    vert[i] = new Vector3(points[i].x, 0, points[i].y).applyMatrix4(trans);
  }
  for (let i = 0; i < n; i++) {
    vert[n + i] = new Vector3(points[i].x, -thickness, points[i].y).applyMatrix4(trans);
  }

  // CCW/CW 판정 — signed area
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    signedArea += points[i].x * points[next].y - points[next].x * points[i].y;
  }
  const isCCW = signedArea > 0;

  let tri: number[] = [];

  for (let i = 0; i < faceTri.length; i++) tri.push(faceTri[i]);
  for (let i = faceTri.length - 1; i >= 0; i--) tri.push(faceTri[i] + n);

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const sv = sideVertStart + i * 4;
    vert[sv + 0] = new Vector3(points[i].x, 0, points[i].y).applyMatrix4(trans);
    vert[sv + 1] = new Vector3(points[next].x, 0, points[next].y).applyMatrix4(trans);
    vert[sv + 2] = new Vector3(points[next].x, -thickness, points[next].y).applyMatrix4(trans);
    vert[sv + 3] = new Vector3(points[i].x, -thickness, points[i].y).applyMatrix4(trans);

    if (isCCW) {
      tri.push(sv + 0, sv + 1, sv + 2, sv + 0, sv + 2, sv + 3);
    } else {
      tri.push(sv + 2, sv + 1, sv + 0, sv + 3, sv + 2, sv + 0);
    }
  }

  if (reverse) tri = tri.slice().reverse();
  return { vert, tri };
}

/**
 * 2D 폴리곤 점 → BufferGeometry (단면).
 * Unity `MeshGenerator.GeneratePolyToMesh(points, origin, forward, reverse)`.
 */
export function polyGeometry(
  points: readonly Vector2[],
  origin: Vector3,
  forward: Vector3,
  reverse: boolean = false,
): BufferGeometry | null {
  if (points.length < 3) return null;
  const info = polyToMeshInfo(points, origin, forward, reverse);
  const vert = vec3ArrayToFloat32(info.vert);
  // UV = 폴리곤 점 그대로 (Unity 원본 패턴)
  const uv = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    uv[i * 2] = points[i].x;
    uv[i * 2 + 1] = points[i].y;
  }
  return buildGeometry(vert, uv, new Uint32Array(info.tri));
}

/**
 * 2D 폴리곤 점 → 두께 BufferGeometry.
 * Unity `MeshGenerator.GeneratePolyToMesh(..., thickness, ...)`.
 */
export function polyGeometryExtruded(
  points: readonly Vector2[],
  origin: Vector3,
  forward: Vector3,
  thickness: number,
  reverse: boolean = false,
): BufferGeometry | null {
  if (points.length < 3) return null;
  if (thickness === 0) return polyGeometry(points, origin, forward, reverse);

  const info = polyToMeshInfoExtruded(points, origin, forward, thickness, reverse);
  const vert = vec3ArrayToFloat32(info.vert);
  const n = points.length;
  const uv = new Float32Array(info.vert.length * 2);

  for (let i = 0; i < n; i++) {
    uv[i * 2] = points[i].x;
    uv[i * 2 + 1] = points[i].y;
  }
  for (let i = 0; i < n; i++) {
    uv[(n + i) * 2] = points[i].x;
    uv[(n + i) * 2 + 1] = points[i].y;
  }

  const sideVertStart = n * 2;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const sv = sideVertStart + i * 4;
    const edgeLen = points[i].distanceTo(points[next]);

    uv[(sv + 0) * 2] = 0;
    uv[(sv + 0) * 2 + 1] = thickness;
    uv[(sv + 1) * 2] = edgeLen;
    uv[(sv + 1) * 2 + 1] = thickness;
    uv[(sv + 2) * 2] = edgeLen;
    uv[(sv + 2) * 2 + 1] = 0;
    uv[(sv + 3) * 2] = 0;
    uv[(sv + 3) * 2 + 1] = 0;
  }

  return buildGeometry(vert, uv, new Uint32Array(info.tri));
}

// ============================================================
// 메시 결합
// ============================================================

/**
 * 여러 BufferGeometry를 단일 BufferGeometry로 결합한다.
 * Unity `MeshGenerator.Combine(meshes[])` 단순화 — 머티리얼/서브메시 분리는 r3f의 다중 mesh로 대체.
 *
 * @param geometries 결합할 BufferGeometry 배열 (null은 무시)
 */
export function combineGeometries(geometries: readonly (BufferGeometry | null)[]): BufferGeometry {
  const valid = geometries.filter((g): g is BufferGeometry => g !== null);
  if (valid.length === 0) return new BufferGeometry();

  let totalVerts = 0;
  let totalTris = 0;
  for (const g of valid) {
    const pos = g.getAttribute('position');
    totalVerts += pos.count;
    const idx = g.getIndex();
    totalTris += idx ? idx.count : pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalTris);
  let vertOffset = 0;
  let triOffset = 0;

  for (const g of valid) {
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const idx = g.getIndex();

    for (let i = 0; i < pos.count; i++) {
      positions[(vertOffset + i) * 3 + 0] = pos.getX(i);
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
      if (uv) {
        uvs[(vertOffset + i) * 2 + 0] = uv.getX(i);
        uvs[(vertOffset + i) * 2 + 1] = uv.getY(i);
      }
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[triOffset + i] = idx.getX(i) + vertOffset;
      }
      triOffset += idx.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[triOffset + i] = i + vertOffset;
      }
      triOffset += pos.count;
    }
    vertOffset += pos.count;
  }

  return buildGeometry(positions, uvs, indices);
}

// ============================================================
// 내부 헬퍼
// ============================================================

/**
 * 정점/UV/인덱스 배열로부터 BufferGeometry를 만든다.
 * normals/tangents/bounds는 자동 계산. Unity `MeshGenerator.GenerateMesh`.
 */
function buildGeometry(
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
): BufferGeometry {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

function vec3ArrayToFloat32(arr: readonly Vector3[]): Float32Array {
  const out = new Float32Array(arr.length * 3);
  for (let i = 0; i < arr.length; i++) {
    out[i * 3 + 0] = arr[i].x;
    out[i * 3 + 1] = arr[i].y;
    out[i * 3 + 2] = arr[i].z;
  }
  return out;
}