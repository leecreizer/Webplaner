import { create } from 'zustand';

/**
 * Wall/Floor/Ceiling/Product 등 *임의의 mesh* 선택 + material 속성 오버라이드 관리.
 *
 * - mesh key 는 `${editKind}-${ownerId}` 포맷 (예: `wall-3`, `floor-0`, `ceiling-1`)
 * - WallView/FloorView/CeilingView 가 자기 key 로 store 를 lookup 해 override 가 있으면
 *   meshStandardMaterial 의 color/roughness/metalness/opacity 에 적용.
 * - MeshInspector 가 selectedMeshKey 의 override 를 슬라이더/picker 로 편집.
 */
export interface MeshMaterialOverride {
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface MeshSelectionState {
  /** 현재 선택된 mesh key (`${editKind}-${ownerId}` 또는 null). */
  selectedMeshKey: string | null;
  /** key → override map. 미설정 mesh 는 컴포넌트 디폴트 색/속성 사용. */
  materials: Record<string, MeshMaterialOverride>;

  selectMesh: (key: string | null) => void;
  setMaterial: (key: string, patch: MeshMaterialOverride) => void;
  resetMaterial: (key: string) => void;
  clearAll: () => void;
}

/** mesh key 빌더 — userData.editKind + editOwnerId 조합. */
export function meshKey(kind: string, ownerId: number | string): string {
  return `${kind}-${ownerId}`;
}

export const useMeshSelectionStore = create<MeshSelectionState>((set) => ({
  selectedMeshKey: null,
  materials: {},

  selectMesh: (key) => set({ selectedMeshKey: key }),

  setMaterial: (key, patch) =>
    set((s) => ({
      materials: {
        ...s.materials,
        [key]: { ...(s.materials[key] ?? {}), ...patch },
      },
    })),

  resetMaterial: (key) =>
    set((s) => {
      const next = { ...s.materials };
      delete next[key];
      return { materials: next };
    }),

  clearAll: () => set({ selectedMeshKey: null, materials: {} }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__meshSelectionStore = useMeshSelectionStore; }, 0);
}