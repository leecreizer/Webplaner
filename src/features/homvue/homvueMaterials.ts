import { HOMVUE_BASE, type PlacedItem } from './homvueAssets';

/**
 * 공간·상품 재질 변경 — 언리얼 WB_ChangeSpaceMaterial · ChangeWall/ChangeFloor/ChangeProductMat.
 *
 * 언리얼 재질은 웹으로 옮길 수 없어서, 변환 도구가 재질을 씌운 상태로 블루프린트를 한 번 더 구워 둔다
 * (tools/gen_mat_jobs.py → glb/materials/<종류>/<재질ID>/…). 웹은 그 GLB 의 재질만 원래 메시에 입힌다.
 * - 벽·바닥: 그 방의 벽(또는 바닥) 액터의 모든 메시·모든 슬롯 (AHVConstructionActor::ChangeMaterial)
 * - 상품: ChangeableType=Material 인 상품, 모든 메시의 0번 슬롯 (AHVProductActor::ChangeMaterial)
 */
export type MatKind = 'wall' | 'floor' | 'product';

export interface MaterialInfo {
  id: number;
  name: string;
  code: string;
  price: number;
  width: number;
  length: number;
  perBundle: number;
  thumb: string | null;
}

export interface MaterialManifest {
  materials: Record<MatKind, MaterialInfo[]>;
  targets: Record<MatKind, string[]>;
  /** 블루프린트 → 종류 → 재질 ID → 구운 GLB */
  bakes: Record<string, Partial<Record<MatKind, Record<string, string>>>>;
}

export async function fetchMaterials(): Promise<MaterialManifest | null> {
  try {
    const res = await fetch(`${HOMVUE_BASE}/manifest/materials.json`);
    return res.ok ? ((await res.json()) as MaterialManifest) : null;
  } catch {
    return null;
  }
}

/** 방 벽 블루프린트 이름 → 방 종류. BP_Living01_Wall → Living01, BP_Room02_Wall → Room02 */
export function wallRoom(blueprint: string): string | null {
  const m = /\/BP_(\w+?)_Wall$/.exec(blueprint);
  return m && m[1] !== 'Out' ? m[1] : null;
}

/** 고른 재질로 구운 GLB 주소 — 고른 게 없거나 구운 파일이 없으면 null (원래 재질 그대로).
 *  형상은 원래 GLB 와 같아서 재질만 가져다 쓴다 (HomvueApartment BakedMaterials) */
export function bakedGlb(item: PlacedItem, kind: MatKind, matId: number | undefined, manifest: MaterialManifest | null): string | null {
  if (!matId || !manifest) return null;
  return manifest.bakes[item.blueprint]?.[kind]?.[String(matId)] ?? null;
}
