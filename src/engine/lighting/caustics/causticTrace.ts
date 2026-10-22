import {
  Box3,
  Color,
  DoubleSide,
  Matrix3,
  Matrix4,
  Ray,
  SRGBColorSpace,
  Sphere,
  Vector3,
  type BufferGeometry,
  type DirectionalLight,
  type Light,
  type Material,
  type Mesh,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type PointLight,
  type RectAreaLight,
  type SpotLight,
  type Texture,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * 커스틱 광자 추적 — 빛에서 광자를 쏘아 유리(투과 재질)를 굴절시켜 바닥·벽에 모이는 빛을 모은다.
 *
 * 경로 추적(MuTracer)은 화면에서 빛 쪽으로 광선을 거슬러 쏘는 방식이라, 태양·점조명처럼 크기가 없는 빛이
 * 유리를 지나 한 점에 모이는 빛(커스틱)은 원리상 만들 수 없다 — 유리 아래는 그림자로만 남는다.
 * 그래서 커스틱만 따로 빛 쪽에서 추적한다(광자 지도 방식의 커스틱 몫).
 * - 유리 그림자는 그대로 어둡게 두고(빛이 유리를 지나며 휘어 다른 곳으로 간 몫) 휘어서 모인 빛만 더한다 — 에너지가 맞는다
 * - 굴절은 스넬 법칙 + 표면 반사(슐릭 근사) + 전반사 + 유리 색·흡수. 얇은 유리(두께 없음)는 휘지 않고 통과
 * - 모인 빛은 받는 면마다 평면 조각(CausticPatch)의 밝기 격자로 낸다 — 단위는 그 면에서 눈에 보이는 밝기(복사휘도)
 */

export interface CausticOptions {
  /** 모든 (유리, 조명) 쌍에 나눠 쏘는 광자 총수 */
  photons: number;
  /** 밝기 격자 흐림(칸 단위 표준편차) — 광자 잡티를 고르게 편다 */
  blur: number;
  /** 유리에서 이 거리(m)보다 먼 면은 받지 않는다 */
  reach?: number;
}

export interface CausticPatch {
  /** 조각 가운데(월드) */
  center: Vector3;
  /** 조각 가로·세로 축과 면 방향(월드, 단위 벡터) */
  e1: Vector3;
  e2: Vector3;
  normal: Vector3;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** 칸마다 더할 밝기(선형 RGB) — 행 0 이 -e2 쪽(uv v=0) */
  radiance: Float32Array;
  /** 가장 밝은 칸 */
  peak: number;
}

interface Glass {
  ior: number;
  transmission: number;
  color: Color;
  thin: boolean;
  att: Color | null;
  attDist: number;
}

interface Body {
  mesh: Mesh;
  geo: BufferGeometry;
  box: Box3;
  inv: Matrix4;
  nmat: Matrix3;
  glass: Glass | null;
  albedo: Color;
}

interface Hit {
  body: Body;
  point: Vector3;
  /** 면 감김 방향 법선(바깥쪽) */
  geoNormal: Vector3;
  /** 보간 법선 — 광선을 마주 보게 뒤집은 것 */
  shading: Vector3;
}

const bvhCache = new WeakMap<BufferGeometry, MeshBVH>();
function bvhOf(geo: BufferGeometry): MeshBVH {
  let b = bvhCache.get(geo);
  if (!b) {
    // indirect — 형상 index 를 재배열하지 않는다(레벨 메시 삼각형 순서로 원래 메시를 찾는 기능이 깨지지 않게)
    b = new MeshBVH(geo, { indirect: true });
    bvhCache.set(geo, b);
  }
  return b;
}

/** 이보다 삼각형이 많은 메시는 가속 구조를 일꾼(worker)에서 만든다 — 주 스레드에서 만들면 화면이 멈춘다 */
const WORKER_TRIS = 20000;
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (r: { serialized?: Parameters<typeof MeshBVH.deserialize>[0]; error?: string }) => void>();
const building = new WeakMap<BufferGeometry, Promise<void>>();
function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const cb = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      cb?.(e.data);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** 위치 사본(끼워 넣은 버퍼·정규화 속성도 풀어서) */
function positionCopy(geo: BufferGeometry): Float32Array {
  const a = geo.attributes.position;
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i);
    out[i * 3 + 1] = a.getY(i);
    out[i * 3 + 2] = a.getZ(i);
  }
  return out;
}

/** 가속 구조를 미리 준비한다 — 큰 메시는 일꾼에서(화면을 멈추지 않는다), 작은 메시와 일꾼이 없을 때는 바로 */
export async function prepareBvh(geos: BufferGeometry[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const geo of new Set(geos)) {
    if (bvhCache.has(geo)) continue;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const w = tris > WORKER_TRIS ? getWorker() : null;
    if (!w) {
      bvhOf(geo);
      continue;
    }
    let job = building.get(geo);
    if (!job) {
      job = new Promise<void>((resolve) => {
        const id = nextId++;
        waiting.set(id, (r) => {
          if (r.serialized) bvhCache.set(geo, MeshBVH.deserialize(r.serialized, geo, { setIndex: false }));
          else bvhOf(geo); // 일꾼 실패 — 그냥 여기서
          resolve();
        });
        const index = geo.index ? Uint32Array.from(geo.index.array as ArrayLike<number>) : null;
        const position = positionCopy(geo);
        w.postMessage({ id, position, index }, index ? [position.buffer, index.buffer] : [position.buffer]);
      });
      building.set(geo, job);
    }
    jobs.push(job);
  }
  await Promise.all(jobs);
}

/** 굴절을 계산할 투과 재질이면 그 값 */
export function glassOf(mat: Material | Material[]): Glass | null {
  if (Array.isArray(mat)) return null;
  const m = mat as MeshPhysicalMaterial;
  // 커스틱을 끈 유리(userData.noCaustics)는 빛을 막는 보통 물체로 — 그림자만 드리운다
  if (!m?.isMeshPhysicalMaterial || !(m.transmission > 0) || !m.visible || m.userData.noCaustics) return null;
  return {
    ior: m.ior || 1.5,
    transmission: m.transmission,
    color: m.color.clone(),
    thin: false,
    att: Number.isFinite(m.attenuationDistance) && m.attenuationDistance > 0 ? m.attenuationColor.clone() : null,
    attDist: m.attenuationDistance,
  };
}

const mapAverage = new WeakMap<Texture, Color>();
/** 텍스처 평균색(선형) — 바닥 무늬 결 대신 평균으로 커스틱 색을 입힌다 */
function averageOf(tex: Texture): Color {
  const cached = mapAverage.get(tex);
  if (cached) return cached;
  let c = new Color(1, 1, 1);
  try {
    const img = tex.image as CanvasImageSource & { width?: number; height?: number };
    if (img && img.width && typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 8;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = (d.length / 4) * 255;
      c = new Color().setRGB(r / n, g / n, b / n, SRGBColorSpace);
    }
  } catch {
    // 다른 출처 이미지 등 — 흰색으로
  }
  mapAverage.set(tex, c);
  return c;
}

function albedoOf(mat: Material | Material[]): Color {
  const m = (Array.isArray(mat) ? mat[0] : mat) as MeshStandardMaterial;
  const c = m?.color ? m.color.clone() : new Color(0.8, 0.8, 0.8);
  if (m?.map) c.multiply(averageOf(m.map));
  return c;
}

/** 빛을 막거나 받는 메시 — 편집 보조물(발광 재질·선)·거의 투명한 것·커스틱 조각은 뺀다 */
export function collectBodies(scene: Object3D): Body[] {
  const out: Body[] = [];
  scene.traverseVisible((o) => {
    const m = o as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.userData.causticPatch || !m.layers.isEnabled(0)) return;
    const mat = m.material;
    const first = (Array.isArray(mat) ? mat[0] : mat) as Material & { isMeshBasicMaterial?: boolean; isShaderMaterial?: boolean };
    if (!first || first.isMeshBasicMaterial || first.isShaderMaterial || !first.visible) return;
    const glass = glassOf(mat);
    if (!glass && first.transparent && first.opacity < 0.5) return;
    const geo = m.geometry;
    if (!geo?.attributes?.position) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    if (glass) {
      // 두께가 없는 판(1cm 미만)은 얇은 유리 — 휘지 않고 통과
      const s = geo.boundingBox!.getSize(new Vector3()).multiply(new Vector3().setFromMatrixScale(m.matrixWorld));
      glass.thin = Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) < 0.01;
    }
    out.push({
      mesh: m,
      geo,
      box,
      inv: m.matrixWorld.clone().invert(),
      nmat: new Matrix3().getNormalMatrix(m.matrixWorld),
      glass,
      albedo: glass ? new Color() : albedoOf(mat),
    });
  });
  return out;
}

// ---- 광선 ↔ 장면 ----

/** 광선이 상자에 들어가는 거리(없으면 -1) */
function boxEntry(o: Vector3, inv: Vector3, b: Box3, maxD: number): number {
  let t1 = (b.min.x - o.x) * inv.x, t2 = (b.max.x - o.x) * inv.x;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (b.min.y - o.y) * inv.y;
  t2 = (b.max.y - o.y) * inv.y;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (b.min.z - o.z) * inv.z;
  t2 = (b.max.z - o.z) * inv.z;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0) || tmin > maxD) return -1;
  return Math.max(tmin, 0);
}

const _lray = new Ray();
const _inv = new Vector3();
const _wp = new Vector3();
function traceScene(bodies: Body[], o: Vector3, d: Vector3, maxD: number): Hit | null {
  _inv.set(1 / d.x, 1 / d.y, 1 / d.z);
  let best: { body: Body; point: Vector3; lh: ReturnType<MeshBVH['raycastFirst']> } | null = null;
  let bestD = maxD;
  for (const b of bodies) {
    const t = boxEntry(o, _inv, b.box, bestD);
    if (t < 0) continue;
    _lray.origin.copy(o).applyMatrix4(b.inv);
    _lray.direction.copy(d).transformDirection(b.inv);
    const h = bvhOf(b.geo).raycastFirst(_lray, DoubleSide);
    if (!h) continue;
    _wp.copy(h.point).applyMatrix4(b.mesh.matrixWorld);
    const dist = _wp.distanceTo(o);
    if (dist < bestD && dist > 1e-6) {
      bestD = dist;
      best = { body: b, point: _wp.clone(), lh: h };
    }
  }
  if (!best || !best.lh) return null;
  const geoNormal = best.lh.face!.normal.clone().applyMatrix3(best.body.nmat).normalize();
  const shading = ((best.lh as { normal?: Vector3 }).normal ?? best.lh.face!.normal).clone().applyMatrix3(best.body.nmat).normalize();
  if (shading.dot(d) > 0) shading.negate();
  return { body: best.body, point: best.point, geoNormal, shading };
}

function schlick(cos: number, ior: number): number {
  const r0 = ((ior - 1) / (ior + 1)) ** 2;
  return r0 + (1 - r0) * (1 - cos) ** 5;
}

// ---- 광자 ----

/** 받은 광자 — 위치·면 방향·받는 면·빛(이미 반사율을 곱한 몫) */
class Deposits {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  body: Body[] = [];
  push(h: Hit, d: Vector3, r: number, g: number, b: number) {
    const n = h.geoNormal.dot(d) > 0 ? h.geoNormal.clone().negate() : h.geoNormal;
    const a = h.body.albedo;
    this.p.push(h.point.x, h.point.y, h.point.z);
    this.n.push(n.x, n.y, n.z);
    this.c.push(r * a.r, g * a.g, b * a.b);
    this.body.push(h.body);
  }
  get count() {
    return this.body.length;
  }
}

const EPS = 1e-4;
/**
 * 광자 하나 — o 에서 d 로. 처음 맞는 유리가 caster 가 아니면 버린다(다른 유리 몫은 그 유리가 쏜다).
 * 유리를 한 번이라도 지난 뒤 불투명 면에 닿으면 남긴다.
 */
function tracePhoton(bodies: Body[], caster: Body, o0: Vector3, d0: Vector3, maxD: number, r0: number, g0: number, b0: number, out: Deposits) {
  const o = o0.clone();
  const d = d0.clone();
  let r = r0, g = g0, b = b0;
  let refracted = false;
  // 유리 안에 있는지는 면 감김 방향 대신 상태로 — 모델마다 면 방향이 뒤집혀 있어도 맞게
  let inside: Body | null = null;
  let insideFrom: Vector3 | null = null;
  for (let ev = 0; ev < 16; ev++) {
    const h = traceScene(bodies, o, d, ev === 0 ? maxD : 30);
    if (!h) return;
    const gl = h.body.glass;
    if (!gl) {
      if (refracted) out.push(h, d, r, g, b);
      return;
    }
    if (!refracted && h.body !== caster) return;
    const n = h.shading;
    const cosi = Math.min(1, -d.dot(n));
    const entering = inside !== h.body;
    if (gl.thin) {
      const t = gl.transmission * (1 - schlick(cosi, gl.ior)) ** 2;
      r *= t * gl.color.r;
      g *= t * gl.color.g;
      b *= t * gl.color.b;
    } else {
      const eta = entering ? 1 / gl.ior : gl.ior;
      const k = 1 - eta * eta * (1 - cosi * cosi);
      if (!entering && insideFrom && gl.att) {
        const s = h.point.distanceTo(insideFrom) / gl.attDist;
        r *= gl.att.r ** s;
        g *= gl.att.g ** s;
        b *= gl.att.b ** s;
      }
      if (k < 0) {
        // 전반사 — 유리 안에서 튕긴다
        d.addScaledVector(n, 2 * cosi).normalize();
        insideFrom = h.point;
        inside = h.body;
      } else {
        const cost = Math.sqrt(k);
        const tr = 1 - schlick(entering ? cosi : cost, gl.ior);
        d.multiplyScalar(eta).addScaledVector(n, eta * cosi - cost).normalize();
        r *= tr;
        g *= tr;
        b *= tr;
        if (entering) {
          r *= gl.transmission * gl.color.r;
          g *= gl.transmission * gl.color.g;
          b *= gl.transmission * gl.color.b;
          insideFrom = h.point;
          inside = h.body;
        } else {
          insideFrom = null;
          inside = null;
        }
      }
    }
    refracted = true;
    if (Math.max(r, g, b) < Math.max(r0, g0, b0) * 1e-3) return;
    o.copy(h.point).addScaledVector(d, EPS);
  }
}

// ---- 조명 ----

interface Source {
  light: Light;
  kind: 'dir' | 'point';
  pos: Vector3;
  /** 직사광 방향(빛이 나아가는 쪽) 또는 스포트·사각 조명이 비추는 쪽 */
  dir: Vector3;
  color: Color;
  intensity: number;
  spot?: { cosOuter: number; cosInner: number };
  rectArea?: number;
}

export function collectSources(scene: Object3D): Source[] {
  const out: Source[] = [];
  scene.traverseVisible((o) => {
    const l = o as Light & { isDirectionalLight?: boolean; isPointLight?: boolean; isSpotLight?: boolean; isRectAreaLight?: boolean };
    if (!l.isLight || !(l.intensity > 0)) return;
    const pos = new Vector3().setFromMatrixPosition(l.matrixWorld);
    const color = l.color.clone();
    if (l.isDirectionalLight || l.isSpotLight) {
      const t = (l as DirectionalLight | SpotLight).target;
      t.updateMatrixWorld();
      const dir = new Vector3().setFromMatrixPosition(t.matrixWorld).sub(pos).normalize();
      if (l.isDirectionalLight) out.push({ light: l, kind: 'dir', pos, dir, color, intensity: l.intensity });
      else {
        const s = l as SpotLight;
        out.push({ light: l, kind: 'point', pos, dir, color, intensity: s.intensity, spot: { cosOuter: Math.cos(s.angle), cosInner: Math.cos(s.angle * (1 - s.penumbra)) } });
      }
    } else if (l.isPointLight) {
      out.push({ light: l, kind: 'point', pos, dir: new Vector3(0, -1, 0), color, intensity: (l as PointLight).intensity });
    } else if (l.isRectAreaLight) {
      const r = l as RectAreaLight;
      const dir = new Vector3(0, 0, -1).transformDirection(r.matrixWorld);
      out.push({ light: l, kind: 'point', pos, dir, color, intensity: r.intensity, rectArea: r.width * r.height });
    }
  });
  return out;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

/** 그 방향으로 나가는 세기(칸델라 꼴) */
function intensityToward(s: Source, d: Vector3): number {
  if (s.spot) return s.intensity * smoothstep(s.spot.cosOuter, s.spot.cosInner, d.dot(s.dir));
  if (s.rectArea != null) return s.intensity * s.rectArea * Math.max(0, d.dot(s.dir));
  return s.intensity;
}

/** 유리 중심에서 받는 대략의 조도 — 어떤 조명이 커스틱을 만들지 고른다 */
function irradianceAt(s: Source, c: Vector3): number {
  if (s.kind === 'dir') return s.intensity;
  const v = c.clone().sub(s.pos);
  const d2 = Math.max(v.lengthSq(), 1e-4);
  return intensityToward(s, v.normalize()) / d2;
}

function basis(n: Vector3): [Vector3, Vector3] {
  const ref = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const e1 = ref.addScaledVector(n, -ref.dot(n)).normalize();
  const e2 = new Vector3().crossVectors(n, e1);
  return [e1, e2];
}

/** 상자가 광선(o→d, 길이 len)을 반지름 rad 안에 두는지 — 상자를 rad 만큼 키워 광선 검사 */
function boxNearRay(box: Box3, o: Vector3, d: Vector3, len: number, rad: number): boolean {
  const b = box.clone().expandByScalar(rad);
  return boxEntry(o, new Vector3(1 / d.x, 1 / d.y, 1 / d.z), b, len) >= 0;
}

// ---- 실행 ----

export interface CausticJob {
  cancel(): void;
  done: Promise<CausticPatch[] | null>;
  stats: { pairs: number; photons: number; deposits: number; ms: number };
}

/**
 * 장면을 훑어 커스틱 조각을 만든다. 화면을 멈추지 않게 sliceMs 마다 쉬어 가며 계산한다(취소 가능).
 * 유리가 없거나 조명이 없으면 빈 목록.
 */
export function startCausticJob(scene: Object3D, opt: CausticOptions, sliceMs = 8): CausticJob {
  let cancelled = false;
  const stats = { pairs: 0, photons: 0, deposits: 0, ms: 0 };
  const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));
  const run = async (): Promise<CausticPatch[] | null> => {
    const t0 = performance.now();
    scene.updateMatrixWorld();
    const bodies = collectBodies(scene);
    const casters = bodies.filter((b) => b.glass);
    const sources = collectSources(scene);
    if (!casters.length || !sources.length) return [];
    const maxReach = opt.reach ?? 2.5;
    // (유리, 조명) 쌍 — 유리마다 그 자리를 밝히는 조명 중 센 것 4개(가장 센 것의 5% 이상).
    // 광자는 쌍이 받는 빛(조도 × 유리 단면)에 비례해 나눈다 — 작은 컵·약한 조명에 광자를 낭비하지 않게
    const pairs: { caster: Body; sphere: Sphere; src: Source; energy: number }[] = [];
    for (const caster of casters) {
      const sphere = caster.box.getBoundingSphere(new Sphere());
      const ranked = sources.map((s) => ({ s, e: irradianceAt(s, sphere.center) })).filter((x) => x.e > 0).sort((a, b) => b.e - a.e);
      if (!ranked.length) continue;
      const area = Math.PI * sphere.radius ** 2 * caster.glass!.transmission;
      for (const { s, e } of ranked.slice(0, 4)) if (e >= ranked[0].e * 0.05) pairs.push({ caster, sphere, src: s, energy: e * area });
    }
    stats.pairs = pairs.length;
    const totalEnergy = pairs.reduce((a, p) => a + p.energy, 0) || 1;
    // 받는 빛이 전체의 0.2% 도 안 되는 쌍은 건너뛴다(보이지 않는다)
    const used = pairs.filter((p) => p.energy >= totalEnergy * 0.002);
    const dep = new Deposits();
    let slice = performance.now();
    for (const { caster, sphere, src, energy } of used) {
      const c = sphere.center;
      const rad = sphere.radius * 1.02;
      const perPair = Math.round(Math.min(600000, Math.max(2000, (opt.photons * energy) / totalEnergy)));
      // 커스틱이 닿는 거리 — 유리 크기의 8배(최소 0.6m, 최대 maxReach)
      const reach = Math.min(maxReach, Math.max(0.6, rad * 8));
      // 이 쌍에 관계있는 메시만 — 유리 둘레(reach 안)에서 받는 면 + 빛에서 유리까지 가는 길의 가림막
      const toLight = src.kind === 'dir' ? src.dir.clone().negate() : src.pos.clone().sub(c).normalize();
      const lightLen = src.kind === 'dir' ? 200 : src.pos.distanceTo(c);
      const near = new Box3().setFromCenterAndSize(c, new Vector3(1, 1, 1).multiplyScalar(2 * (rad + reach)));
      const local = bodies.filter((b) => b.box.intersectsBox(near) || boxNearRay(b.box, c, toLight, lightLen, rad));
      await prepareBvh(local.map((b) => b.geo));
      if (cancelled) return null;
      slice = performance.now();
      const s = Math.max(2, Math.round(Math.sqrt(perPair)));
      const o = new Vector3();
      const d = new Vector3();
      if (src.kind === 'dir') {
        // 빛 방향에 수직인 정사각형(유리 둘레)에서 고르게 — 광자 하나 = 정사각형 넓이/광자 수 만큼의 빛
        const [e1, e2] = basis(src.dir);
        const back = 200;
        const flux = (src.intensity * (2 * rad) ** 2) / (s * s);
        d.copy(src.dir);
        for (let i = 0; i < s; i++) {
          for (let j = 0; j < s; j++) {
            const u = ((i + Math.random()) / s) * 2 - 1;
            const v = ((j + Math.random()) / s) * 2 - 1;
            o.copy(c).addScaledVector(e1, u * rad).addScaledVector(e2, v * rad).addScaledVector(src.dir, -back);
            tracePhoton(local, caster, o, d, back + rad * 2, flux * src.color.r, flux * src.color.g, flux * src.color.b, dep);
          }
          if (performance.now() - slice > sliceMs) {
            await yieldFrame();
            if (cancelled) return null;
            slice = performance.now();
          }
        }
      } else {
        // 조명 위치에서 유리를 감싸는 원뿔 안으로 고르게 — 광자 하나 = 세기 × 원뿔 입체각/광자 수
        const D = src.pos.distanceTo(c);
        if (D <= rad * 1.05) continue;
        const axis = c.clone().sub(src.pos).normalize();
        const cosMax = Math.sqrt(1 - (rad / D) ** 2);
        const omega = 2 * Math.PI * (1 - cosMax);
        const [e1, e2] = basis(axis);
        for (let i = 0; i < s; i++) {
          for (let j = 0; j < s; j++) {
            const ct = 1 - ((i + Math.random()) / s) * (1 - cosMax);
            const st = Math.sqrt(Math.max(0, 1 - ct * ct));
            const ph = ((j + Math.random()) / s) * 2 * Math.PI;
            d.copy(axis).multiplyScalar(ct).addScaledVector(e1, Math.cos(ph) * st).addScaledVector(e2, Math.sin(ph) * st).normalize();
            const f = (intensityToward(src, d) * omega) / (s * s);
            if (f <= 0) continue;
            tracePhoton(local, caster, src.pos, d, D + rad * 2, f * src.color.r, f * src.color.g, f * src.color.b, dep);
          }
          if (performance.now() - slice > sliceMs) {
            await yieldFrame();
            if (cancelled) return null;
            slice = performance.now();
          }
        }
      }
      stats.photons += s * s;
    }
    stats.deposits = dep.count;
    const patches = buildPatches(dep, opt.blur);
    stats.ms = Math.round(performance.now() - t0);
    return patches;
  };
  const done = run().catch((e) => {
    console.warn('[Caustics] 계산 실패', e);
    return null;
  });
  return {
    cancel: () => {
      cancelled = true;
    },
    done,
    stats,
  };
}

// ---- 받은 광자 → 밝기 격자 ----

const MAX_CELLS = 1024;
const MIN_CELL = 0.0025;

/** 같은 메시·같은 면(방향·높이)끼리 모아 평면 조각마다 밝기 격자를 만든다 */
export function buildPatches(dep: Deposits, blur: number): CausticPatch[] {
  interface Cluster { body: Body; n: Vector3; h: number; idx: number[]; energy: number }
  const clusters: Cluster[] = [];
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < dep.count; i++) {
    p.fromArray(dep.p, i * 3);
    n.fromArray(dep.n, i * 3);
    const e = dep.c[i * 3] + dep.c[i * 3 + 1] + dep.c[i * 3 + 2];
    let cl = clusters.find((c) => c.body === dep.body[i] && c.n.dot(n) > 0.9 && Math.abs(p.dot(c.n) - c.h) < 0.03);
    if (!cl) clusters.push((cl = { body: dep.body[i], n: n.clone(), h: p.dot(n), idx: [], energy: 0 }));
    cl.idx.push(i);
    cl.energy += e;
  }
  const maxE = Math.max(0, ...clusters.map((c) => c.energy));
  const out: CausticPatch[] = [];
  for (const cl of clusters) {
    if (cl.idx.length < 32 || cl.energy < maxE * 0.01) continue;
    const [e1, e2] = basis(cl.n);
    // 범위는 빛 에너지 0.5~99.5% 분위로 — 스치듯 굴절돼 멀리 흩어진 어두운 광자 때문에 조각이 커져 칸이 굵어지지 않게
    // (범위 밖 광자는 버린다 — 에너지 1% 안쪽)
    const us: [number, number][] = [], vs: [number, number][] = [];
    let hs = 0, total = 0;
    for (const i of cl.idx) {
      p.fromArray(dep.p, i * 3);
      const e = dep.c[i * 3] + dep.c[i * 3 + 1] + dep.c[i * 3 + 2];
      us.push([p.dot(e1), e]);
      vs.push([p.dot(e2), e]);
      hs += p.dot(cl.n);
      total += e;
    }
    const h = hs / cl.idx.length;
    const q = (a: [number, number][], f: number) => {
      let acc = 0;
      for (const [x, e] of a) if ((acc += e) >= total * f) return x;
      return a[a.length - 1][0];
    };
    us.sort((x, y) => x[0] - y[0]);
    vs.sort((x, y) => x[0] - y[0]);
    const umin = q(us, 0.005), umax = q(us, 0.995), vmin = q(vs, 0.005), vmax = q(vs, 0.995);
    const cell = Math.max(MIN_CELL, Math.max(umax - umin, vmax - vmin) / (MAX_CELLS - 16));
    const margin = Math.ceil(blur * 3) + 2;
    const u0 = umin - margin * cell, v0 = vmin - margin * cell;
    const cols = Math.min(MAX_CELLS, Math.ceil((umax - umin) / cell) + 2 * margin + 1);
    const rows = Math.min(MAX_CELLS, Math.ceil((vmax - vmin) / cell) + 2 * margin + 1);
    let grid = new Float32Array(cols * rows * 3);
    // 쌍선형으로 나눠 담기 — 칸 경계 잡티를 줄인다
    for (const i of cl.idx) {
      p.fromArray(dep.p, i * 3);
      const fu = (p.dot(e1) - u0) / cell - 0.5, fv = (p.dot(e2) - v0) / cell - 0.5;
      const iu = Math.floor(fu), iv = Math.floor(fv);
      const tu = fu - iu, tv = fv - iv;
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          const x = iu + a, y = iv + b;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const w = (a ? tu : 1 - tu) * (b ? tv : 1 - tv);
          const k = (y * cols + x) * 3;
          grid[k] += dep.c[i * 3] * w;
          grid[k + 1] += dep.c[i * 3 + 1] * w;
          grid[k + 2] += dep.c[i * 3 + 2] * w;
        }
      }
    }
    if (blur > 0) grid = gaussian(grid, cols, rows, blur);
    // 빛 다발/넓이 = 조도, 확산면 밝기 = 조도 × 반사율 / π (반사율은 받을 때 곱했다)
    const scale = 1 / (cell * cell * Math.PI);
    let peak = 0;
    for (let k = 0; k < grid.length; k++) {
      grid[k] *= scale;
      if (grid[k] > peak) peak = grid[k];
    }
    // 약한 칸(가장 밝은 칸의 8% 미만)은 크게 흐린 값으로 — 광자가 드문 곳이라 점무늬 잡티로 보였다.
    // 지우지 않고 펴기만 한다(유리를 지나 넓게 퍼진 빛도 실제 빛이다). 밝은 커스틱 선은 또렷하게 둔다
    const wide = gaussian(grid, cols, rows, Math.max(4, blur * 4));
    const lo = peak * 0.02, hi = peak * 0.08;
    for (let k = 0; k < grid.length; k += 3) {
      const m = Math.max(grid[k], grid[k + 1], grid[k + 2]);
      if (m >= hi) continue;
      const t = m <= lo ? 0 : (m - lo) / (hi - lo);
      const w = t * t * (3 - 2 * t);
      grid[k] = grid[k] * w + wide[k] * (1 - w);
      grid[k + 1] = grid[k + 1] * w + wide[k + 1] * (1 - w);
      grid[k + 2] = grid[k + 2] * w + wide[k + 2] * (1 - w);
    }
    const width = cols * cell, height = rows * cell;
    const center = new Vector3()
      .addScaledVector(e1, u0 + width / 2)
      .addScaledVector(e2, v0 + height / 2)
      .addScaledVector(cl.n, h);
    out.push({ center, e1, e2, normal: cl.n.clone(), width, height, cols, rows, radiance: grid, peak });
  }
  // 가장 밝은 조각의 5% 도 안 되는 조각은 버린다 — 예: 유리 밑 바닥 아래 깔린 다른 바닥판에 생긴 넓고 희미한 조각
  const top = Math.max(0, ...out.map((p) => p.peak));
  return out.filter((p) => p.peak >= top * 0.05);
}

function gaussian(src: Float32Array, cols: number, rows: number, sigma: number): Float32Array<ArrayBuffer> {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx < 0 || xx >= cols) continue;
        const o = (y * cols + xx) * 3, w = k[i + r];
        a += src[o] * w;
        b += src[o + 1] * w;
        c += src[o + 2] * w;
      }
      const o = (y * cols + x) * 3;
      tmp[o] = a;
      tmp[o + 1] = b;
      tmp[o + 2] = c;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy < 0 || yy >= rows) continue;
        const o = (yy * cols + x) * 3, w = k[i + r];
        a += tmp[o] * w;
        b += tmp[o + 1] * w;
        c += tmp[o + 2] * w;
      }
      const o = (y * cols + x) * 3;
      dst[o] = a;
      dst[o + 1] = b;
      dst[o + 2] = c;
    }
  }
  return dst;
}
