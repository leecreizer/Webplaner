import { create } from 'zustand';

/**
 * Wall/Floor/Ceiling/Product 등 *임의의 mesh* 선택 + material 속성 오버라이드 관리.
 *
 * ### 선택 모델
 * - 단일 클릭 = 이전 선택 모두 해제 후 새 객체만 선택
 * - Shift + 클릭 = 기존 선택 유지 + 새 객체 추가/제거 (toggle)
 * - 같은 객체 단독 클릭 = 선택 해제 (toggle off)
 *
 * `selectedMeshKey` 는 primary (마지막 선택) — MeshInspector 가 단일 편집 시 사용.
 * `selectedMeshKeys` 는 다중 선택 전체 배열.
 *
 * mesh key 포맷: `${editKind}-${ownerId}` (예: `wall-3`, `floor-0`, `ceiling-1`)
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
  /** 다중 선택 전체 (선택 순서 유지). */
  selectedMeshKeys: string[];
  /** primary 선택 (마지막에 클릭/추가된 key). MeshInspector 가 사용. */
  selectedMeshKey: string | null;
  /** key → override map. 미설정 mesh 는 컴포넌트 디폴트 색/속성 사용. */
  materials: Record<string, MeshMaterialOverride>;

  /**
   * mesh 선택. `additive=true` (Shift+클릭) 면 기존 선택에 toggle 추가/제거.
   * `additive=false` (단순 클릭) 면 이전 선택 모두 해제 후 새 객체만 선택, 또는 같은
   * 객체 단독 클릭 시 해제.
   * key=null 은 *전체 선택 해제* (additive 무관).
   */
  selectMesh: (key: string | null, additive?: boolean) => void;
  setMaterial: (key: string, patch: MeshMaterialOverride) => void;
  resetMaterial: (key: string) => void;
  clearAll: () => void;
}

/** mesh key 빌더 — userData.editKind + editOwnerId 조합. */
export function meshKey(kind: string, ownerId: number | string): string {
  return `${kind}-${ownerId}`;
}

export const useMeshSelectionStore = create<MeshSelectionState>((set) => ({
  selectedMeshKeys: [],
  selectedMeshKey: null,
  materials: {},

  selectMesh: (key, additive = false) =>
    set((s) => {
      if (key === null) return { selectedMeshKeys: [], selectedMeshKey: null };
      const exists = s.selectedMeshKeys.includes(key);
      if (additive) {
        // Shift: toggle in/out
        if (exists) {
          const next = s.selectedMeshKeys.filter((k) => k !== key);
          return {
            selectedMeshKeys: next,
            selectedMeshKey: next.length ? next[next.length - 1] : null,
          };
        }
        const next = [...s.selectedMeshKeys, key];
        return { selectedMeshKeys: next, selectedMeshKey: key };
      }
      // 단순 클릭: 같은 객체 단독 = 해제, 그 외 = 단일 선택으로 교체
      if (exists && s.selectedMeshKeys.length === 1) {
        return { selectedMeshKeys: [], selectedMeshKey: null };
      }
      return { selectedMeshKeys: [key], selectedMeshKey: key };
    }),

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

  clearAll: () => set({ selectedMeshKeys: [], selectedMeshKey: null, materials: {} }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__meshSelectionStore = useMeshSelectionStore; }, 0);
}