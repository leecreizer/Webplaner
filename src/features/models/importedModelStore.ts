import { create } from 'zustand';

/**
 * 사용자가 파일로 불러온 외부 3D 모델 (GLB/GLTF) 관리.
 *
 * 파일은 `URL.createObjectURL(file)` 로 blob URL 을 만들어 GLTFLoader 에 넘긴다 (서버 업로드
 * 없이 클라이언트에서 즉시 로드). 모델마다 position/rotation/scale + 선택/표시 상태를 가진다.
 */
/** PBR 머티리얼 편집값 (MeshPhysicalMaterial 기준). 미설정 필드는 원본 유지. */
export interface MaterialEdit {
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  /** 투과율 (유리). MeshPhysicalMaterial. */
  transmission?: number;
  /** 굴절률. */
  ior?: number;
  /** 클리어코트 (자동차 도장/광택). */
  clearcoat?: number;
  clearcoatRoughness?: number;
}

/** 모델 내 머티리얼 슬롯 — 자동 수집. 원본값 보존(리셋용). */
export interface MaterialSlot {
  key: string;
  name: string;
  original: MaterialEdit;
}

/** PBR 프리셋 (추가 = 새 머티리얼 룩 적용). */
export type MaterialPreset =
  | 'metal' | 'glass' | 'plastic' | 'ceramic' | 'wood' | 'rubber' | 'emissive';

export interface ImportedModel {
  id: string;
  name: string;
  /** blob URL (URL.createObjectURL) 또는 외부 http URL. */
  url: string;
  format: 'glb' | 'gltf';
  position: [number, number, number];
  rotation: [number, number, number]; // degrees
  scale: number;
  visible: boolean;
  /** 로드 후 ImportedModels 가 채움 — 모델의 머티리얼 슬롯 목록. */
  materialSlots?: MaterialSlot[];
  /** 사용자 머티리얼 오버라이드 (key → edit). 없으면 원본. */
  materialEdits?: Record<string, MaterialEdit>;
}

/** TransformControls 조작 모드. */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface ImportedModelState {
  models: ImportedModel[];
  selectedId: string | null;
  /** 선택 모델에 적용되는 gizmo 모드 (이동/회전/크기). */
  gizmoMode: GizmoMode;

  /** 파일에서 모델 추가 — blob URL 생성 후 등록. id 반환. */
  addFromFile: (file: File) => string;
  /** URL 로 직접 추가 (외부 호스팅 모델). */
  addFromUrl: (url: string, name?: string) => string;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<ImportedModel>) => void;
  select: (id: string | null) => void;
  setGizmoMode: (m: GizmoMode) => void;
  /** 로드 후 머티리얼 슬롯 등록 (ImportedModels 가 호출). */
  setMaterialSlots: (id: string, slots: MaterialSlot[]) => void;
  /** 머티리얼 PBR 속성 변경 (key 별 override merge). */
  editMaterial: (id: string, key: string, patch: MaterialEdit) => void;
  /** 머티리얼 override 삭제 → 원본 복원. */
  resetMaterial: (id: string, key: string) => void;
  /** PBR 프리셋 적용 (추가 = 새 머티리얼 룩). */
  applyMaterialPreset: (id: string, key: string, preset: MaterialPreset) => void;
  clearAll: () => void;
}

/** 프리셋 → MaterialEdit 매핑. */
export const MATERIAL_PRESETS: Record<MaterialPreset, MaterialEdit> = {
  metal:    { metalness: 1, roughness: 0.2, transmission: 0, clearcoat: 0 },
  glass:    { metalness: 0, roughness: 0, transmission: 1, ior: 1.5, opacity: 1, transparent: false, clearcoat: 0 },
  plastic:  { metalness: 0, roughness: 0.45, transmission: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 },
  ceramic:  { metalness: 0, roughness: 0.12, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.05 },
  wood:     { metalness: 0, roughness: 0.8, transmission: 0, clearcoat: 0 },
  rubber:   { metalness: 0, roughness: 0.95, transmission: 0, clearcoat: 0 },
  emissive: { emissive: '#ffd9a0', emissiveIntensity: 2, metalness: 0, roughness: 0.5 },
};

let _seq = 0;

function formatOf(name: string): 'glb' | 'gltf' {
  return name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf';
}

export const useImportedModelStore = create<ImportedModelState>((set) => ({
  models: [],
  selectedId: null,
  gizmoMode: 'translate',

  addFromFile: (file) => {
    const id = `model-${++_seq}`;
    const url = URL.createObjectURL(file);
    const model: ImportedModel = {
      id,
      name: file.name.replace(/\.(glb|gltf)$/i, ''),
      url,
      format: formatOf(file.name),
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      visible: true,
    };
    set((s) => ({ models: [...s.models, model], selectedId: id }));
    return id;
  },

  addFromUrl: (url, name) => {
    const id = `model-${++_seq}`;
    const model: ImportedModel = {
      id,
      name: name ?? url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? `model-${_seq}`,
      url,
      format: formatOf(url),
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      visible: true,
    };
    set((s) => ({ models: [...s.models, model], selectedId: id }));
    return id;
  },

  remove: (id) =>
    set((s) => {
      const m = s.models.find((x) => x.id === id);
      // blob URL 메모리 해제
      if (m && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
      return {
        models: s.models.filter((x) => x.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    }),

  update: (id, patch) =>
    set((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  select: (id) => set({ selectedId: id }),
  setGizmoMode: (m) => set({ gizmoMode: m }),

  setMaterialSlots: (id, slots) =>
    set((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, materialSlots: slots } : m)),
    })),

  editMaterial: (id, key, patch) =>
    set((s) => ({
      models: s.models.map((m) =>
        m.id === id
          ? { ...m, materialEdits: { ...m.materialEdits, [key]: { ...m.materialEdits?.[key], ...patch } } }
          : m,
      ),
    })),

  resetMaterial: (id, key) =>
    set((s) => ({
      models: s.models.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m.materialEdits };
        delete next[key];
        return { ...m, materialEdits: next };
      }),
    })),

  applyMaterialPreset: (id, key, preset) =>
    set((s) => ({
      models: s.models.map((m) =>
        m.id === id
          ? {
              ...m,
              materialEdits: {
                ...m.materialEdits,
                [key]: { ...m.materialEdits?.[key], ...MATERIAL_PRESETS[preset] },
              },
            }
          : m,
      ),
    })),

  clearAll: () =>
    set((s) => {
      for (const m of s.models) if (m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
      return { models: [], selectedId: null };
    }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__importedModelStore = useImportedModelStore; }, 0);
}
