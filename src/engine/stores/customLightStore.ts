import { create } from 'zustand';

/**
 * 사용자가 동적으로 추가하는 *커스텀 라이트* 모음.
 *
 * three.js의 기본 라이트 타입을 R3F 컴포넌트로 매핑:
 * - **point**   → `<pointLight>` — 옴니 (Omnidirectional) 점 광원
 * - **spot**    → `<spotLight>` — 타겟 방향 조명 (콘 형태)
 * - **rect**    → `<rectAreaLight>` — 면 광원 (창문/패널 시뮬)
 * - **hemisphere** → `<hemisphereLight>` — 위/아래 그라데이션 (sky/ground bounce)
 *
 * 모든 라이트는 캔버스에 위치 마커가 표시되고 LightingPanel에서 속성 편집/삭제 가능.
 */
export type LightKind = 'point' | 'spot' | 'rect' | 'hemisphere';

export interface CustomLight {
  id: string;
  kind: LightKind;
  /** 표시 이름 (사용자 식별용). */
  name: string;
  /** 월드 좌표 (point/spot/rect). hemisphere는 무시. */
  position: [number, number, number];
  /** 라이트 메인 색 (sky 색에 해당). */
  color: string;
  /** 강도 (lux 비례 — three.js 단위). */
  intensity: number;
  /** 점 광원 도달 거리(m). 0이면 무한. point/spot에서 사용. */
  distance?: number;
  /** 거리 감쇠 지수. 보통 2 (역제곱). */
  decay?: number;
  /** SpotLight cone 각도(rad). 0~PI/2. */
  angle?: number;
  /** SpotLight 가장자리 부드러움 0~1. */
  penumbra?: number;
  /** SpotLight 타겟 월드 좌표. */
  target?: [number, number, number];
  /** RectAreaLight width(m). */
  width?: number;
  /** RectAreaLight height(m). */
  height?: number;
  /** HemisphereLight ground 색. */
  groundColor?: string;
  /** 그림자 캐스팅 여부 (point/spot). */
  castShadow?: boolean;
}

export interface CustomLightState {
  lights: CustomLight[];
  /** 현재 선택된 라이트 id (편집 패널 노출용). */
  selectedId: string | null;

  add: (kind: LightKind) => string;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<CustomLight>) => void;
  select: (id: string | null) => void;
  clearAll: () => void;
}

let _seq = 0;

/** 종류별 기본값. */
function defaultsFor(kind: LightKind): Omit<CustomLight, 'id' | 'name'> {
  switch (kind) {
    case 'point':
      return {
        kind,
        position: [0, 2.0, 0],
        color: '#fff5d6',
        intensity: 8,
        distance: 10,
        decay: 2,
        castShadow: true,
      };
    case 'spot':
      return {
        kind,
        position: [0, 2.4, 0],
        color: '#ffffff',
        intensity: 30,
        distance: 8,
        decay: 1.5,
        angle: Math.PI / 6,
        penumbra: 0.4,
        target: [0, 0, 0],
        castShadow: true,
      };
    case 'rect':
      return {
        kind,
        position: [0, 2.3, 0],
        color: '#ffffff',
        intensity: 4,
        width: 2,
        height: 0.8,
      };
    case 'hemisphere':
      return {
        kind,
        position: [0, 4, 0],
        color: '#cfe4ff',
        intensity: 0.5,
        groundColor: '#b08560',
      };
  }
}

export const useCustomLightStore = create<CustomLightState>((set) => ({
  lights: [],
  selectedId: null,

  add: (kind) => {
    const id = `light-${++_seq}`;
    const base = defaultsFor(kind);
    const name = `${kind}-${_seq}`;
    set((s) => ({
      lights: [...s.lights, { id, name, ...base }],
      selectedId: id,
    }));
    return id;
  },

  remove: (id) =>
    set((s) => ({
      lights: s.lights.filter((l) => l.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  update: (id, patch) =>
    set((s) => ({
      lights: s.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  select: (id) => set({ selectedId: id }),

  clearAll: () => set({ lights: [], selectedId: null }),
}));

/** dev 진단용으로 store window 노출. */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__customLightStore = useCustomLightStore; }, 0);
}
