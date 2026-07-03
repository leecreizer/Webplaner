import { create } from 'zustand';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';
import { moduleEdges, type OpeningConflict } from './compileModules';

/** 공간 모듈 종류. */
export type ModuleKind = 'bedroom'|'living'|'kitchen'|'bath'|'entrance'|'corridor'|'custom';
/** 모듈 로컬 벽면 (ry=0 기준 N=+z 반대? → 규약: N=-z(위), E=+x, S=+z, W=-x — 평면도 화면 기준). */
export type ModuleSide = 'N'|'E'|'S'|'W';

/** 모듈 벽의 문/개구부. offset은 해당 변의 시작점(시계방향 순회 기준)→중심 거리(m). */
export interface ModuleOpening {
  id: string;
  side: ModuleSide;
  type: 'door'|'opening'|'window';
  offset: number;
  width: number;
  height: number;
  /** 창호 전용 — 바닥에서 창 하단까지 높이(m). 문/개구부는 0(바닥 시작). */
  sill?: number;
  /** 공유벽 개구부 충돌에서 진 쪽 표시 — 이긴 opening id. 분리 시 해제. */
  suppressedBy?: string;
}

/** 파라메트릭 사각 공간 모듈 — 축 정렬(회전 90° 단위), 중심 기준 위치. */
export interface SpaceModule {
  id: string;
  kind: ModuleKind;
  name: string;
  x: number; z: number;
  /** 회전(도, 자유각). UI 에서 5° 스냅, 45°/90° 강스냅. 축 정렬(90° 배수)일 때만 공유벽 병합. */
  ry: number;
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

/** 벽 부착 개구부 종류별 기본 치수 — 툴바 '기본 모델링' 도어/창호/개구부 배치에 사용. */
export const OPENING_DEFAULTS: Record<'door'|'opening'|'window', { width: number; height: number; sill?: number; label: string }> = {
  door:    { width: 0.9, height: 2.1, label: '도어' },
  opening: { width: 1.0, height: 2.1, label: '개구부' },
  window:  { width: 1.2, height: 1.2, sill: 0.9, label: '창호' },
};

interface SpaceModuleState {
  modules: SpaceModule[];
  selectedId: string | null;
  /** 팔레트에서 선택했지만 아직 바닥에 배치 전인 모듈 종류. */
  pendingKind: ModuleKind | null;
  /** 벽 부착 대기 중인 개구부 종류 (툴바 기본 모델링 → 모듈 벽 클릭 배치). */
  pendingOpeningType: 'door'|'opening'|'window' | null;
  /** 재배치 중인 기존 개구부 — 표식 클릭으로 집어서 같은/다른 벽에 놓는다. */
  movingOpening: { moduleId: string; openingId: string } | null;
  setPendingKind(k: ModuleKind | null): void;
  setPendingOpeningType(t: 'door'|'opening'|'window' | null): void;
  setMovingOpening(m: { moduleId: string; openingId: string } | null): void;
  add(kind: ModuleKind, x: number, z: number): string;
  remove(id: string): void;
  update(id: string, patch: Partial<SpaceModule>): void;
  /**
   * 이동/회전 전용 갱신 — 모듈 영역 안의 배치 상품들을 **함께** 이동·회전시킨다.
   * (도어 등 parentId 부속은 몸통이 움직이면 기존 자동정렬이 따라오므로 몸통만 변환)
   */
  transformModule(id: string, patch: { x?: number; z?: number; ry?: number }): void;
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
  pendingOpeningType: null,
  movingOpening: null,

  setPendingKind(k) { set({ pendingKind: k }); },

  setPendingOpeningType(t) { set({ pendingOpeningType: t }); },

  setMovingOpening(m) { set({ movingOpening: m }); },

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

  transformModule(id, patch) {
    const m = get().modules.find((mm) => mm.id === id);
    if (!m) return;
    const nx = patch.x ?? m.x, nz = patch.z ?? m.z, nry = patch.ry ?? m.ry;
    const dx = nx - m.x, dz = nz - m.z;
    const dryDeg = nry - m.ry;
    // 1) 모듈 영역(회전 반영) 안의 상품 판별 — 상품 중심을 모듈 로컬로 역회전해 AABB 검사
    const cos0 = Math.cos((-m.ry * Math.PI) / 180), sin0 = Math.sin((-m.ry * Math.PI) / 180);
    const inside = (px: number, pz: number) => {
      const rx = px - m.x, rz = pz - m.z;
      const lx = rx * cos0 - rz * sin0, lz = rx * sin0 + rz * cos0;
      return Math.abs(lx) <= m.w / 2 + 1e-6 && Math.abs(lz) <= m.d / 2 + 1e-6;
    };
    const st = usePlacedProductStore.getState();
    const dryRad = (dryDeg * Math.PI) / 180;
    const c = Math.cos(dryRad), sn = Math.sin(dryRad);
    for (const pr of st.placed) {
      if (pr.parentId) continue; // 부속(도어)은 몸통 자동정렬이 따라옴
      if (!inside(pr.x, pr.z)) continue;
      // 모듈 중심 기준 회전 + 이동 (moduleEdges 회전 규약: (x,z)→(x·cosφ−z·sinφ, x·sinφ+z·cosφ))
      const rx = pr.x - m.x, rz = pr.z - m.z;
      st.update(pr.id, {
        x: m.x + dx + rx * c - rz * sn,
        z: m.z + dz + rx * sn + rz * c,
        ry: pr.ry + dryDeg,
      });
    }
    // 2) 모듈 자신
    get().update(id, { x: nx, z: nz, ry: nry });
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
