import type { Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D } from 'three';
import { useHomvueStore, type HomvueMatEdit } from './homvueStore';
import { homvueProductObjects } from './HomvueGizmo';

/**
 * Homvue 물체의 재질 직접 편집 — 편집 패널(HomvueInspector)이 고친 값을 그 물체에만 입힌다.
 * - 같은 GLB 를 여러 번 놓으면 재질을 나눠 쓴다 → 편집할 때 그 물체용으로 재질을 복제해 바꾼다(다른 물체는 그대로)
 * - 편집 값은 원래 재질 uuid 로 저장 — 상품을 옮겨 물체가 새로 만들어져도 같은 편집을 다시 입힌다
 * - 편집을 지우면 원래 재질로 되돌린다
 */

export interface MatSlot {
  /** 원래 재질 uuid — 편집 값 열쇠 */
  id: string;
  name: string;
  /** 원래 재질(편집 전 값 읽기용) */
  original: Material;
}

/** 지금 입힌 재질 → 원래 재질(편집 복제본이면 원본) */
function originalOf(m: Material): Material {
  return (m.userData.homvueEditOrigin as Material | undefined) ?? m;
}

/** 물체의 재질 목록(원래 재질 기준, 중복 없이) */
export function materialSlots(obj: Object3D, extra: Material[] = []): MatSlot[] {
  const seen = new Map<string, MatSlot>();
  const add = (m: Material) => {
    const o = originalOf(m);
    if (seen.has(o.uuid)) return;
    seen.set(o.uuid, { id: o.uuid, name: o.name || `재질 ${seen.size + 1}`, original: o });
  };
  obj.traverse((c) => {
    const mesh = c as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) add(m);
  });
  for (const m of extra) add(m);
  return [...seen.values()];
}

/** 편집 값을 물체에 입힌다 — 편집이 있는 재질은 복제본으로, 없는 재질은 원래대로 */
export function applyMatEdits(obj: Object3D, edits: Record<string, HomvueMatEdit> | undefined) {
  const clones = ((obj.userData.homvueEditClones as Map<string, Material> | undefined) ??= new Map<string, Material>());
  obj.traverse((c) => {
    const mesh = c as Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let changed = false;
    const next = list.map((m) => {
      const orig = originalOf(m);
      const edit = edits?.[orig.uuid];
      if (!edit || Object.keys(edit).length === 0) {
        if (m !== orig) changed = true;
        return orig;
      }
      let clone = clones.get(orig.uuid);
      if (!clone) {
        clone = orig.clone();
        clone.userData = { ...orig.userData, homvueEditOrigin: orig };
        clones.set(orig.uuid, clone);
      }
      writeEdit(clone, orig, edit);
      if (m !== clone) changed = true;
      return clone;
    });
    if (changed) mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

/** 원래 값에서 시작해 편집 값만 덮는다(항목을 지우면 원래 값으로) */
function writeEdit(target: Material, orig: Material, e: HomvueMatEdit) {
  const t = target as MeshPhysicalMaterial;
  const o = orig as MeshPhysicalMaterial;
  if (t.color && o.color) e.color ? t.color.set(e.color) : t.color.copy(o.color);
  if ('roughness' in t) t.roughness = e.roughness ?? o.roughness;
  if ('metalness' in t) t.metalness = e.metalness ?? o.metalness;
  t.opacity = e.opacity ?? o.opacity;
  t.transparent = o.transparent || t.opacity < 1;
  t.depthWrite = o.depthWrite && !(t.opacity < 1 && !o.transparent);
  if (t.emissive && o.emissive) e.emissive ? t.emissive.set(e.emissive) : t.emissive.copy(o.emissive);
  if ('emissiveIntensity' in t) t.emissiveIntensity = e.emissiveIntensity ?? (o as MeshStandardMaterial).emissiveIntensity;
  if (t.isMeshPhysicalMaterial) {
    t.transmission = e.transmission ?? o.transmission;
    t.ior = e.ior ?? o.ior;
  }
  // 판 바꿈 — 경로 추적이 재질 값 변경을 알아채게
  t.needsUpdate = true;
}

/** 편집 패널에 보여 줄 지금 값(편집 값이 없으면 원래 값) */
export function currentValues(slot: MatSlot, e: HomvueMatEdit | undefined) {
  const o = slot.original as MeshPhysicalMaterial;
  return {
    color: e?.color ?? (o.color ? `#${o.color.getHexString()}` : '#ffffff'),
    roughness: e?.roughness ?? o.roughness ?? 0.5,
    metalness: e?.metalness ?? o.metalness ?? 0,
    opacity: e?.opacity ?? o.opacity ?? 1,
    emissive: e?.emissive ?? (o.emissive ? `#${o.emissive.getHexString()}` : '#000000'),
    emissiveIntensity: e?.emissiveIntensity ?? o.emissiveIntensity ?? 0,
    transmission: o.isMeshPhysicalMaterial ? (e?.transmission ?? o.transmission) : null,
    ior: o.isMeshPhysicalMaterial ? (e?.ior ?? o.ior) : null,
  };
}

/** 저장소 편집 값을 등록된 물체 전부(또는 한 물체)에 다시 입힌다 — 편집을 고치거나 물체가 새로 만들어질 때 */
export function syncMatEdits(key?: string) {
  const all = useHomvueStore.getState().matEdits;
  for (const [k, t] of homvueProductObjects) if (!key || k === key) applyMatEdits(t.obj, all[k]);
}

useHomvueStore.subscribe((s, p) => {
  if (s.matEdits !== p.matEdits) syncMatEdits();
});
