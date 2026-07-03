import { create } from 'zustand';
import { moduleEdges, type OpeningConflict } from './compileModules';

/** 공간 모듈 종류. */
export type ModuleKind = 'bedroom'|'living'|'kitchen'|'bath'|'entrance'|'corridor'|'custom';
/** 모듈 로컬 벽면 (ry=0 기준 N=+z 반대? → 규약: N=-z(위), E=+x, S=+z, W=-x — 평면도 화면 기준). */
export type ModuleSide = 'N'|'E'|'S'|'W';

/** 모듈 벽의 문/개구부. offset은 해당 변의 시작점(시계방향 순회 기준)→중심 거리(m). */
export interface ModuleOpening {
  id: string;
  side: ModuleSide;
  type: 'door'|'opening';
  offset: number;
  width: number;
  height: number;
  /** 공유벽 개구부 충돌에서 진 쪽 표시 — 이긴 opening id. 분리 시 해제. */
  suppressedBy?: string;
}

/** 파라메트릭 사각 공간 모듈 — 축 정렬(회전 90° 단위), 중심 기준 위치. */
export interface SpaceModule {
  id: string;
  kind: ModuleKind;
  name: string;
  x: number; z: number;
  ry: 0|90|180|270;
  /** 내벽 기준 폭×깊이(m). */
  w: number; d: number;
  wallH: number;
  openings: ModuleOpening[];
}

/** kind별 기본 치수(m)·표시명. */
export const MODULE_PRESETS: Record<ModuleKind, { w: number; d: number; label: string }> = {
  bedroom:  { w: 3.6, d: 3.0, label: '침실' },
  living:   { w: 4.5, d: 3.6, label: '거실' },
  kitchen:  { w: 3.0, d: 2.4, label: '주방' },
  bath:     { w: 2.4, d: 1.8, label: '욕실' },
  entrance: { w: 1.8, d: 1.5, label: '현관' },
  corridor: { w: 1.2, d: 3.0, label: '복도' },
  custom:   { w: 3.0, d: 3.0, label: '공간' },
};

const DEFAULT_WALL_H = 2.4;

interface SpaceModuleState {
  modules: SpaceModule[];
  selectedId: string | null;
  /** 팔레트에서 선택했지만 아직 바닥에 배치 전인 모듈 종류. */
  pendingKind: ModuleKind | null;
  setPendingKind(k: ModuleKind | null): void;
  add(kind: ModuleKind, x: number, z: number): string;
  remove(id: string): void;
  update(id: string, patch: Partial<SpaceModule>): void;
  select(id: string | null): void;
  addOpening(moduleId: string, o: Omit<ModuleOpening, 'id'>): string;
  removeOpening(moduleId: string, openingId: string): void;
  updateOpening(moduleId: string, openingId: string, patch: Partial<ModuleOpening>): void;
  /** syncModuleWalls 가 컴파일 결과로 setState — 개구부 충돌 목록. */
  openingConflicts: OpeningConflict[];
  setOpeningConflicts(c: OpeningConflict[]): void;
  /** 공유벽 개구부 충돌에서 loser opening 에 suppressedBy=winner.openingId 기록. */
  resolveConflict(
    winner: { moduleId: string; openingId: string },
    loser: { moduleId: string; openingId: string },
  ): void;
  /** suppressedBy 가 가리키는 opening 과 더 이상 같은 공유벽을 공유하지 않으면 해제. */
  releaseStaleSuppressions(): void;
}

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

export const useSpaceModuleStore = create<SpaceModuleState>((set, get) => ({
  modules: [],
  selectedId: null,
  pendingKind: null,

  setPendingKind(k) { set({ pendingKind: k }); },

  add(kind, x, z) {
    const preset = MODULE_PRESETS[kind];
    const n = get().modules.filter((m) => m.kind === kind).length + 1;
    const id = newId('sm');
    const mod: SpaceModule = {
      id, kind, name: `${preset.label}${n}`,
      x, z, ry: 0, w: preset.w, d: preset.d, wallH: DEFAULT_WALL_H, openings: [],
    };
    set((s) => ({ modules: [...s.modules, mod], selectedId: id }));
    return id;
  },

  remove(id) {
    set((s) => ({
      modules: s.modules.filter((m) => m.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  update(id, patch) {
    set((s) => ({ modules: s.modules.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  },

  select(id) { set({ selectedId: id }); },

  addOpening(moduleId, o) {
    const id = newId('op');
    set((s) => ({
      modules: s.modules.map((m) =>
        m.id === moduleId ? { ...m, openings: [...m.openings, { ...o, id }] } : m),
    }));
    return id;
  },

  removeOpening(moduleId, openingId) {
    set((s) => ({
      modules: s.modules.map((m) =>
        m.id === moduleId ? { ...m, openings: m.openings.filter((o) => o.id !== openingId) } : m),
    }));
  },

  updateOpening(moduleId, openingId, patch) {
    set((s) => ({
      modules: s.modules.map((m) =>
        m.id === moduleId
          ? { ...m, openings: m.openings.map((o) => (o.id === openingId ? { ...o, ...patch } : o)) }
          : m),
    }));
  },

  openingConflicts: [],
  setOpeningConflicts(c) { set({ openingConflicts: c }); },

  resolveConflict(winner, loser) {
    set((s) => ({
      modules: s.modules.map((m) =>
        m.id === loser.moduleId
          ? {
              ...m,
              openings: m.openings.map((o) =>
                o.id === loser.openingId ? { ...o, suppressedBy: winner.openingId } : o),
            }
          : m),
    }));
  },

  releaseStaleSuppressions() {
    const EPS = 1e-3;
    const modules = get().modules;
    const byId = new Map(modules.map((m) => [m.id, m]));

    // (moduleId, side) → 변의 (horiz, fixed, lo, hi)
    const edgeSpan = (moduleId: string, side: ModuleSide) => {
      const e = moduleEdges(byId.get(moduleId)!)[side];
      const horiz = Math.abs(e.az - e.bz) < EPS;
      return horiz
        ? { horiz, fixed: e.az, lo: Math.min(e.ax, e.bx), hi: Math.max(e.ax, e.bx) }
        : { horiz, fixed: e.ax, lo: Math.min(e.az, e.bz), hi: Math.max(e.az, e.bz) };
    };

    let changed = false;
    const next = modules.map((m) => {
      let openingsChanged = false;
      const openings = m.openings.map((o) => {
        if (!o.suppressedBy) return o;
        // winner opening 을 전체 모듈에서 검색
        let winnerModuleId: string | null = null;
        let winnerSide: ModuleSide | null = null;
        for (const wm of modules) {
          const w = wm.openings.find((x) => x.id === o.suppressedBy);
          if (w) { winnerModuleId = wm.id; winnerSide = w.side; break; }
        }
        if (!winnerModuleId || !winnerSide) {
          openingsChanged = true;
          return { ...o, suppressedBy: undefined };
        }
        const a = edgeSpan(m.id, o.side);
        const b = edgeSpan(winnerModuleId, winnerSide);
        const collinear = a.horiz === b.horiz && Math.abs(a.fixed - b.fixed) < EPS;
        const overlap = collinear ? Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) : -1;
        if (!collinear || overlap <= EPS) {
          openingsChanged = true;
          return { ...o, suppressedBy: undefined };
        }
        return o;
      });
      if (openingsChanged) { changed = true; return { ...m, openings }; }
      return m;
    });
    if (changed) set({ modules: next });
  },
}));
