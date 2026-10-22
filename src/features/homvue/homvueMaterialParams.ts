import { Box3, Color, MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Material, type Mesh, type Object3D } from 'three';
import { HOMVUE_BASE } from './homvueAssets';

/**
 * 언리얼 재질의 실제 값(거칠기·금속성·스펙큘러·투과·굴절률·솜털감)을 GLB 재질에 덮어쓴다.
 *
 * UE 5.3 glTF 내보내기는 스펙큘러·투과를 내보내지 못해서, V-Ray(Datasmith) 재질의 「반사 없음」(반사색 검정)이 사라지고
 * 광택도 1 → 거칠기 0 만 남아 모든 재질이 거울처럼 번들거렸다(흰 벽·천장이 비쳐 색이 물 빠져 보임). 유리는 불투명 판이 됐다.
 * 변환 도구가 언리얼 재질 그래프를 계산해 manifest/material-params.json 을 만든다(tools/build_material_params.py).
 *
 * 열쇠: 사용처(블루프린트 이름 BP_xxx, 기본 레벨 메시는 level:<평면>) → 언리얼 재질 이름.
 * GLB 재질 이름에는 꼬리표가 붙는다 — 레벨 메시는 `_node_123`, 중복 재질은 `_2`.
 */
export interface MatParams {
  roughness?: number;
  metalness?: number;
  specularIntensity?: number;
  ior?: number;
  transmission?: number;
  thin?: boolean;
  attenuationColor?: [number, number, number];
  attenuationDistance?: number;
  sheen?: number;
  source?: string;
}
export type MatParamsManifest = Record<string, Record<string, MatParams>>;

export async function fetchMaterialParams(): Promise<MatParamsManifest | null> {
  try {
    const res = await fetch(`${HOMVUE_BASE}/manifest/material-params.json`);
    return res.ok ? ((await res.json()) as MatParamsManifest) : null;
  } catch {
    return null;
  }
}

/** 부품의 사용처 열쇠 — 블루프린트 경로의 마지막 이름, 레벨 메시는 level:<평면 이름 끝> */
export function ownerKey(blueprint: string): string {
  if (blueprint.startsWith('/LevelStatic/')) return 'level:' + blueprint.split('_').pop();
  return blueprint.split('/').pop() ?? blueprint;
}

function lookup(table: Record<string, MatParams>, glbName: string): MatParams | undefined {
  if (table[glbName]) return table[glbName];
  let n = glbName.replace(/_node_\d+(_\d+)?$/, '').replace(/_StaticMeshComponent\d+$/, '');
  if (table[n]) return table[n];
  n = n.replace(/_\d+$/, '');
  return table[n];
}

/** 같은 GLB 를 여러 번 놓아도 재질은 한 번만 바꾸고 공유 — 원본 재질 → 바꾼 재질 */
const converted = new WeakMap<Material, Material>();

function convert(src: Material, p: MatParams): Material {
  const done = converted.get(src);
  if (done) return done;
  const std = src as MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return src;
  // 스펙큘러·굴절률·솜털감·투과는 물리 재질에만 있다. 유리는 기본 반투명이지만 「유리 굴절·커스틱」을 켜면
  // 투과로 바꿔야 하므로 물리 재질로 만들어 둔다(applyGlassMode)
  const glass = p.transmission != null && p.transmission > 0;
  const needsPhysical = glass || p.specularIntensity != null || p.ior != null || p.sheen != null;
  let mat: MeshStandardMaterial | MeshPhysicalMaterial = std;
  if (needsPhysical && !(std as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    const phys = new MeshPhysicalMaterial();
    MeshStandardMaterial.prototype.copy.call(phys, std); // 표준 속성만 복사(물리 속성은 기본값 유지)
    phys.defines = { STANDARD: '', PHYSICAL: '' };
    mat = phys;
  } else {
    mat = std.clone();
  }
  if (p.roughness != null && !mat.roughnessMap) mat.roughness = p.roughness;
  if (p.metalness != null && !mat.metalnessMap) mat.metalness = p.metalness;
  // 유리 = 반투명(불투명도). 물리 재질 투과(transmission)는 경로 추적 샘플 하나를 2.5~2.8배 느리게 했다
  // (43 거실, 유리 재질 22개뿐인데 497 → 177ms, 실측). 래스터도 투과가 있으면 장면을 한 번 더 그린다.
  // 창·유리문은 얇아 굴절이 거의 없으니 반투명으로도 창밖이 그대로 보인다(같은 측정에서 밝기 차이 없음).
  if (glass) {
    mat.metalness = 0;
    if (p.attenuationColor) mat.color.multiply(new Color(...p.attenuationColor));
    // 두 모드 값을 같이 들고 다닌다 — 반투명(기본) ↔ 굴절(투과)
    mat.userData.homvueGlass = {
      transmission: p.transmission ?? 1,
      ior: p.ior ?? 1.5,
      thin: !!p.thin,
      attenuationColor: p.attenuationColor,
      attenuationDistance: p.attenuationDistance,
    } satisfies GlassInfo;
    setGlassMaterial(mat as MeshPhysicalMaterial, false);
  }
  const phys = mat as MeshPhysicalMaterial;
  if (phys.isMeshPhysicalMaterial) {
    if (p.specularIntensity != null) phys.specularIntensity = p.specularIntensity;
    if (p.ior != null) phys.ior = p.ior;
    if (p.sheen) {
      phys.sheen = p.sheen;
      phys.sheenRoughness = 0.8;
      phys.sheenColor = (std.color ?? new Color(1, 1, 1)).clone();
    }
  }
  mat.userData = { ...mat.userData, homvueParams: p.source ?? 'ue' };
  mat.needsUpdate = true;
  converted.set(src, mat);
  return mat;
}

interface GlassInfo {
  transmission: number;
  ior: number;
  thin: boolean;
  attenuationColor?: [number, number, number];
  attenuationDistance?: number;
}

/** 유리 재질 한 개를 반투명(refract=false) 또는 굴절 유리(true)로 */
function setGlassMaterial(m: MeshPhysicalMaterial, refract: boolean) {
  const g = m.userData.homvueGlass as GlassInfo | undefined;
  if (!g || !m.isMeshPhysicalMaterial) return;
  if (refract) {
    m.transparent = false;
    m.opacity = 1;
    m.depthWrite = true;
    m.transmission = g.transmission;
    m.ior = g.ior;
    m.thickness = g.thin ? 0 : 0.01;
    if (g.attenuationColor) m.attenuationColor = new Color(...g.attenuationColor);
    if (g.attenuationDistance) m.attenuationDistance = g.attenuationDistance;
    delete m.userData.glassTranslucent;
  } else {
    m.transmission = 0;
    m.transparent = true;
    m.opacity = Math.max(0.08, 1 - g.transmission);
    m.depthWrite = false;
    // 그림자는 보통 그림자로(래스터 GlassShadows · 경로 추적 MutracerRenderer) — 그림자 속 빛 계산 없이
    m.userData.glassTranslucent = g.transmission;
  }
  m.userData.homvueGlassRefract = refract;
  m.needsUpdate = true;
}

/**
 * 「유리 굴절·커스틱」 켜기·끄기 — Homvue 평면의 유리 재질을 굴절 유리 ↔ 반투명으로.
 * - 켜면 두께 있는 유리 소품(컵·꽃병·병 등)만 굴절 유리 — 경로 추적이 굴절과 커스틱(빛 모임)을 계산한다.
 *   대신 경로 추적이 느려지고(유리 22개에서 샘플당 2.5배, 실측) 커스틱은 잡티로 천천히 맺힌다
 * - 창·유리문처럼 얇고 넓은 판유리는 늘 반투명 — 판유리는 커스틱이 거의 없고 느려지기만 한다
 *   (한 변 0.5m 넘고 두께 2cm 미만인 메시가 쓰는 재질)
 */
export function applyGlassMode(root: Object3D, refract: boolean): number {
  const panes = new Set<Material>();
  const glasses = new Set<MeshPhysicalMaterial>();
  const box = new Box3();
  const size = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m.userData?.homvueGlass) continue;
      glasses.add(m as MeshPhysicalMaterial);
      box.setFromObject(mesh).getSize(size);
      const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
      if (dims[2] > 0.5 && dims[0] < 0.02) panes.add(m);
    }
  });
  let n = 0;
  for (const m of glasses) {
    const want = refract && !panes.has(m);
    if (m.userData.homvueGlassRefract === want) continue;
    setGlassMaterial(m, want);
    n++;
  }
  return n;
}

/** 부품 하나의 모든 메시에 언리얼 재질 값을 입힌다. 바꾼 재질 수를 돌려준다 */
export function applyMaterialParams(obj: Object3D, owner: string, manifest: MatParamsManifest | null): number {
  const table = manifest?.[owner];
  if (!table) return 0;
  let n = 0;
  obj.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map((m) => {
      const p = lookup(table, m.name);
      if (!p) return m;
      n++;
      return convert(m, p);
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  return n;
}
