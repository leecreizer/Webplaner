import { create } from 'zustand';

/**
 * 사용자가 파일로 불러온 외부 3D 모델 (GLB/GLTF) 관리.
 *
 * 파일은 `URL.createObjectURL(file)` 로 blob URL 을 만들어 GLTFLoader 에 넘긴다 (서버 업로드
 * 없이 클라이언트에서 즉시 로드). 모델마다 position/rotation/scale + 선택/표시 상태를 가진다.
 */
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
}

export interface ImportedModelState {
  models: ImportedModel[];
  selectedId: string | null;

  /** 파일에서 모델 추가 — blob URL 생성 후 등록. id 반환. */
  addFromFile: (file: File) => string;
  /** URL 로 직접 추가 (외부 호스팅 모델). */
  addFromUrl: (url: string, name?: string) => string;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<ImportedModel>) => void;
  select: (id: string | null) => void;
  clearAll: () => void;
}

let _seq = 0;

function formatOf(name: string): 'glb' | 'gltf' {
  return name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf';
}

export const useImportedModelStore = create<ImportedModelState>((set) => ({
  models: [],
  selectedId: null,

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
