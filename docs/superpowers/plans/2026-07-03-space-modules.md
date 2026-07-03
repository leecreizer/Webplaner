# 공간 모듈 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파라메트릭 사각 공간 모듈을 배치·스냅 조립해 전체 평면을 구성하고, 기존 Node/Wall/Space 파이프라인으로 실시간 컴파일한다.

**Architecture:** 모듈 목록(zustand)이 원본이고, 순수 함수 `compileModules()`가 공유벽 병합·개구부 승계를 계산해 세그먼트를 산출한다. 브리지가 그 세그먼트를 기존 `layoutStore`의 Wall로 동기화(태그 기반 add/remove)하고 `buildSpaces`를 호출한다 — **기존 Wall/Space/SpaceBuilder 코드는 무수정**.

**Tech Stack:** React 19 + @react-three/fiber 9 + three 0.185 + zustand 5 + vitest. 스펙: `docs/superpowers/specs/2026-07-03-space-modules-design.md`

## Global Constraints

- **기존 구조 무변경**: 수정 허용 파일은 `src/persistence/PlanSaveData.ts`(필드 추가), `src/features/undoredo/commands/LoadPlanCommand.ts`(로드 1곳), `src/App.tsx`(컴포넌트 mount), UI 패널 등록부뿐. `src/domain/**`는 **읽기만** 한다.
- 커밋마다 `npx tsc --noEmit` 통과 + 커밋 메시지에 버전 증가(package.json 0.0.1씩) — 프로젝트 규칙.
- 모듈 회전은 0/90/180/270만. 좌표 단위는 m, XZ 평면(y=0 바닥).
- 주석·UI 문구는 한국어(기존 코드베이스 관례).
- 테스트: `npx vitest run <파일>` / 전체 `npx vitest run`.

---

### Task 1: spaceModuleStore — 모듈 데이터 모델

**Files:**
- Create: `src/features/spaceModules/spaceModuleStore.ts`
- Test: `src/features/spaceModules/spaceModuleStore.test.ts`

**Interfaces:**
- Produces (이후 태스크 전부가 사용):

```ts
export type ModuleKind = 'bedroom'|'living'|'kitchen'|'bath'|'entrance'|'corridor'|'custom';
export type ModuleSide = 'N'|'E'|'S'|'W';
export interface ModuleOpening {
  id: string; side: ModuleSide; type: 'door'|'opening';
  offset: number; width: number; height: number;
  suppressedBy?: string;
}
export interface SpaceModule {
  id: string; kind: ModuleKind; name: string;
  x: number; z: number; ry: 0|90|180|270;
  w: number; d: number; wallH: number;
  openings: ModuleOpening[];
}
export const MODULE_PRESETS: Record<ModuleKind, { w: number; d: number; label: string }>;
export const useSpaceModuleStore: /* zustand */ {
  modules: SpaceModule[]; selectedId: string | null;
  add(kind: ModuleKind, x: number, z: number): string;      // id 반환, 이름 자동 넘버링
  remove(id: string): void;
  update(id: string, patch: Partial<SpaceModule>): void;
  select(id: string | null): void;
  addOpening(moduleId: string, o: Omit<ModuleOpening,'id'>): string;
  removeOpening(moduleId: string, openingId: string): void;
  updateOpening(moduleId: string, openingId: string, patch: Partial<ModuleOpening>): void;
};
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/features/spaceModules/spaceModuleStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSpaceModuleStore, MODULE_PRESETS } from './spaceModuleStore';

describe('spaceModuleStore', () => {
  beforeEach(() => useSpaceModuleStore.setState({ modules: [], selectedId: null }));

  it('add: 프리셋 치수로 모듈 생성 + 자동 넘버링', () => {
    const s = useSpaceModuleStore.getState();
    const id1 = s.add('bedroom', 0, 0);
    const id2 = s.add('bedroom', 5, 0);
    const [m1, m2] = useSpaceModuleStore.getState().modules;
    expect(m1.id).toBe(id1);
    expect(m1.name).toBe('침실1');
    expect(m2.name).toBe('침실2');
    expect(m1.w).toBe(MODULE_PRESETS.bedroom.w);
    expect(m1.ry).toBe(0);
    expect(m1.wallH).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
  });

  it('update/remove/select', () => {
    const s = useSpaceModuleStore.getState();
    const id = s.add('bath', 1, 2);
    useSpaceModuleStore.getState().update(id, { w: 3.0 });
    expect(useSpaceModuleStore.getState().modules[0].w).toBe(3.0);
    useSpaceModuleStore.getState().select(id);
    expect(useSpaceModuleStore.getState().selectedId).toBe(id);
    useSpaceModuleStore.getState().remove(id);
    expect(useSpaceModuleStore.getState().modules).toHaveLength(0);
    expect(useSpaceModuleStore.getState().selectedId).toBeNull(); // 삭제 시 선택 해제
  });

  it('opening add/update/remove', () => {
    const s = useSpaceModuleStore.getState();
    const id = s.add('living', 0, 0);
    const oid = useSpaceModuleStore.getState().addOpening(id, {
      side: 'N', type: 'door', offset: 1.0, width: 0.9, height: 2.1,
    });
    let m = useSpaceModuleStore.getState().modules[0];
    expect(m.openings).toHaveLength(1);
    expect(m.openings[0].id).toBe(oid);
    useSpaceModuleStore.getState().updateOpening(id, oid, { offset: 1.5 });
    m = useSpaceModuleStore.getState().modules[0];
    expect(m.openings[0].offset).toBe(1.5);
    useSpaceModuleStore.getState().removeOpening(id, oid);
    expect(useSpaceModuleStore.getState().modules[0].openings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/features/spaceModules/spaceModuleStore.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/features/spaceModules/spaceModuleStore.ts
import { create } from 'zustand';

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
  add(kind: ModuleKind, x: number, z: number): string;
  remove(id: string): void;
  update(id: string, patch: Partial<SpaceModule>): void;
  select(id: string | null): void;
  addOpening(moduleId: string, o: Omit<ModuleOpening, 'id'>): string;
  removeOpening(moduleId: string, openingId: string): void;
  updateOpening(moduleId: string, openingId: string, patch: Partial<ModuleOpening>): void;
}

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

export const useSpaceModuleStore = create<SpaceModuleState>((set, get) => ({
  modules: [],
  selectedId: null,

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
}));
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/features/spaceModules/spaceModuleStore.test.ts` / Expected: PASS (3 tests)
- [ ] **Step 5: 커밋** — `git add src/features/spaceModules && git commit -m "feat: 공간 모듈 store — 파라메트릭 모듈+개구부 데이터 모델"`

---

### Task 2: compileModules — 공유벽 병합 컴파일러 (순수 함수)

**Files:**
- Create: `src/features/spaceModules/compileModules.ts`
- Test: `src/features/spaceModules/compileModules.test.ts`

**Interfaces:**
- Consumes: Task 1의 `SpaceModule`, `ModuleOpening`
- Produces:

```ts
/** 컴파일 산출 벽 세그먼트 — XZ 평면 축 정렬 선분. */
export interface CompiledWall {
  ax: number; az: number; bx: number; bz: number;  // 끝점(m)
  h: number;                                        // 벽 높이(m)
  sourceModuleIds: string[];                        // 1개=단독벽, 2개=공유벽
  openings: CompiledOpening[];
}
export interface CompiledOpening {
  moduleId: string; openingId: string;
  type: 'door'|'opening';
  /** 세그먼트 a→b 방향, a부터 개구부 중심까지 거리(m). */
  t: number; width: number; height: number;
}
/** 공유벽에서 양쪽 개구부 구간이 겹치는데 승자 미지정 — UI가 선택 다이얼로그 표시. */
export interface OpeningConflict {
  a: { moduleId: string; openingId: string };
  b: { moduleId: string; openingId: string };
}
export function compileModules(modules: SpaceModule[]): {
  walls: CompiledWall[]; conflicts: OpeningConflict[];
};
/** 모듈 4변의 월드 선분(시계방향 N→E→S→W, ry 적용). 스냅/핸들도 사용. */
export function moduleEdges(m: SpaceModule): Record<ModuleSide, { ax:number; az:number; bx:number; bz:number }>;
```

규칙 (스펙 §2):
- 동일선상(수직 거리 < 1e-3m) + 구간 겹침(> 1e-3m)인 두 모듈의 변 → 겹침 구간은 `sourceModuleIds` 2개짜리 공유벽 1개, 겹치지 않는 잔여 구간은 각자 단독벽으로 분할.
- 공유벽 높이 = 두 모듈 wallH 중 큰 값.
- 개구부는 `suppressedBy`가 살아있으면(=이긴 상대 opening이 같은 공유벽에 존재) 제외.
- 공유벽에서 양쪽 유효 개구부의 [t-width/2, t+width/2] 구간이 겹치고 어느 쪽도 suppressed가 아니면 `conflicts`에 push하고 **둘 다 이번 산출에서 제외**(선택 전까지 막힌 벽).
- ry 회전: 90° 단위 회전 시 변 좌표는 중심 기준 회전, w/d는 그대로 두고 edges 계산에서 처리.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/features/spaceModules/compileModules.test.ts
import { describe, it, expect } from 'vitest';
import { compileModules, moduleEdges } from './compileModules';
import type { SpaceModule } from './spaceModuleStore';

const mod = (p: Partial<SpaceModule>): SpaceModule => ({
  id: 'm1', kind: 'custom', name: '공간1', x: 0, z: 0, ry: 0,
  w: 4, d: 3, wallH: 2.4, openings: [], ...p,
});

describe('moduleEdges', () => {
  it('ry=0: N(-z)·E(+x)·S(+z)·W(-x) 변 좌표', () => {
    const e = moduleEdges(mod({ x: 0, z: 0, w: 4, d: 3 }));
    expect(e.N).toEqual({ ax: -2, az: -1.5, bx: 2, bz: -1.5 });
    expect(e.S).toEqual({ ax: 2, az: 1.5, bx: -2, bz: 1.5 });
    expect(e.E).toEqual({ ax: 2, az: -1.5, bx: 2, bz: 1.5 });
    expect(e.W).toEqual({ ax: -2, az: 1.5, bx: -2, bz: -1.5 });
  });
  it('ry=90: 변이 90° 회전 (N이 +x 쪽을 향함)', () => {
    const e = moduleEdges(mod({ ry: 90, w: 4, d: 3 }));
    // 회전 후 N변은 x=+1.5 수직선
    expect(e.N.ax).toBeCloseTo(1.5); expect(e.N.bx).toBeCloseTo(1.5);
  });
});

describe('compileModules', () => {
  it('단독 모듈: 벽 4개, 각각 sourceModuleIds 1개', () => {
    const { walls, conflicts } = compileModules([mod({})]);
    expect(walls).toHaveLength(4);
    expect(conflicts).toHaveLength(0);
    for (const w of walls) expect(w.sourceModuleIds).toEqual(['m1']);
  });

  it('완전 맞벽: 같은 길이 변이 정확히 맞닿으면 공유벽 1개 (총 7벽)', () => {
    // m1 E변(x=2, z:-1.5~1.5) == m2 W변 — m2는 w=4,d=3, 중심 x=4
    const m1 = mod({ id: 'm1' });
    const m2 = mod({ id: 'm2', x: 4 });
    const { walls } = compileModules([m1, m2]);
    const shared = walls.filter((w) => w.sourceModuleIds.length === 2);
    expect(shared).toHaveLength(1);
    expect(walls).toHaveLength(7); // 4+4-2공유변+1공유벽 = 7
    expect(shared[0].sourceModuleIds.sort()).toEqual(['m1', 'm2']);
  });

  it('부분 겹침: 겹침 구간만 공유벽, 잔여는 단독벽으로 분할', () => {
    // m2(d=3)를 z=+1.5 내리면 m1 E변과 z:0~1.5 구간만 겹침
    const m1 = mod({ id: 'm1' });
    const m2 = mod({ id: 'm2', x: 4, z: 1.5 });
    const { walls } = compileModules([m1, m2]);
    const shared = walls.filter((w) => w.sourceModuleIds.length === 2);
    expect(shared).toHaveLength(1);
    const s = shared[0];
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    expect(len).toBeCloseTo(1.5);
    // m1 E변 잔여(z:-1.5~0) + m2 W변 잔여(z:1.5~3) 단독벽 존재
    const singles = walls.filter((w) => w.sourceModuleIds.length === 1);
    expect(singles.length).toBe(8); // m1: N,S,W + E잔여 / m2: N,S,E + W잔여
  });

  it('개구부 승계: 문 있는 벽 + 빈 벽 → 공유벽에 문 1개', () => {
    const m1 = mod({
      id: 'm1',
      openings: [{ id: 'o1', side: 'E', type: 'door', offset: 1.5, width: 0.9, height: 2.1 }],
    });
    const m2 = mod({ id: 'm2', x: 4 });
    const { walls, conflicts } = compileModules([m1, m2]);
    const shared = walls.find((w) => w.sourceModuleIds.length === 2)!;
    expect(shared.openings).toHaveLength(1);
    expect(shared.openings[0]).toMatchObject({ moduleId: 'm1', openingId: 'o1', type: 'door' });
    expect(conflicts).toHaveLength(0);
  });

  it('개구부 충돌: 양쪽 개구부 구간이 겹치면 conflict 보고 + 둘 다 제외', () => {
    const m1 = mod({
      id: 'm1',
      openings: [{ id: 'o1', side: 'E', type: 'door', offset: 1.5, width: 0.9, height: 2.1 }],
    });
    const m2 = mod({
      id: 'm2', x: 4,
      openings: [{ id: 'o2', side: 'W', type: 'opening', offset: 1.5, width: 1.2, height: 2.1 }],
    });
    const { walls, conflicts } = compileModules([m1, m2]);
    expect(conflicts).toHaveLength(1);
    const shared = walls.find((w) => w.sourceModuleIds.length === 2)!;
    expect(shared.openings).toHaveLength(0);
  });

  it('suppressedBy: 진 쪽 제외, 이긴 쪽만 반영 — 충돌 없음', () => {
    const m1 = mod({
      id: 'm1',
      openings: [{ id: 'o1', side: 'E', type: 'door', offset: 1.5, width: 0.9, height: 2.1 }],
    });
    const m2 = mod({
      id: 'm2', x: 4,
      openings: [{ id: 'o2', side: 'W', type: 'opening', offset: 1.5, width: 1.2, height: 2.1, suppressedBy: 'o1' }],
    });
    const { walls, conflicts } = compileModules([m1, m2]);
    expect(conflicts).toHaveLength(0);
    const shared = walls.find((w) => w.sourceModuleIds.length === 2)!;
    expect(shared.openings.map((o) => o.openingId)).toEqual(['o1']);
  });

  it('떨어진 모듈: 공유벽 없음 (벽 8개)', () => {
    const { walls } = compileModules([mod({ id: 'm1' }), mod({ id: 'm2', x: 10 })]);
    expect(walls.filter((w) => w.sourceModuleIds.length === 2)).toHaveLength(0);
    expect(walls).toHaveLength(8);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/features/spaceModules/compileModules.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 축 정렬 전제(수평 변 z 동일 / 수직 변 x 동일)로 1D 구간 산술:

```ts
// src/features/spaceModules/compileModules.ts
import type { ModuleSide, SpaceModule } from './spaceModuleStore';

export interface CompiledOpening {
  moduleId: string; openingId: string;
  type: 'door'|'opening';
  t: number; width: number; height: number;
}
export interface CompiledWall {
  ax: number; az: number; bx: number; bz: number;
  h: number;
  sourceModuleIds: string[];
  openings: CompiledOpening[];
}
export interface OpeningConflict {
  a: { moduleId: string; openingId: string };
  b: { moduleId: string; openingId: string };
}

const EPS = 1e-3;
type Edge = { ax: number; az: number; bx: number; bz: number };

/** 모듈 4변(월드, 시계방향 N→E→S→W). ry는 중심 기준 90° 단위 회전. */
export function moduleEdges(m: SpaceModule): Record<ModuleSide, Edge> {
  const hw = m.w / 2, hd = m.d / 2;
  // ry=0 로컬 코너 (시계방향: NW→NE→SE→SW), N=-z
  let corners = [
    { x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd },
  ];
  const rot = ((m.ry % 360) + 360) % 360;
  const times = rot / 90;
  for (let i = 0; i < times; i++) {
    corners = corners.map((c) => ({ x: -c.z, z: c.x })); // +90° (y축)
  }
  const w = corners.map((c) => ({ x: c.x + m.x, z: c.z + m.z }));
  const edge = (a: { x: number; z: number }, b: { x: number; z: number }): Edge =>
    ({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  return { N: edge(w[0], w[1]), E: edge(w[1], w[2]), S: edge(w[2], w[3]), W: edge(w[3], w[0]) };
}

/** 변이 수평(z 상수)인지. 아니면 수직(x 상수) — 축 정렬 전제. */
const isHorizontal = (e: Edge) => Math.abs(e.az - e.bz) < EPS;
/** 변의 1D 구간 [lo,hi]와 고정축 좌표. */
function span(e: Edge) {
  return isHorizontal(e)
    ? { lo: Math.min(e.ax, e.bx), hi: Math.max(e.ax, e.bx), fixed: e.az, horiz: true }
    : { lo: Math.min(e.az, e.bz), hi: Math.max(e.az, e.bz), fixed: e.ax, horiz: false };
}
/** 1D 구간 t(변 시작점 기준 거리) → 월드 좌표 t. 변 방향이 lo→hi가 아닐 수 있어 정규화. */
function edgeT(e: Edge, worldCoord: number) {
  const s = span(e);
  const start = isHorizontal(e) ? e.ax : e.az;
  return start <= (isHorizontal(e) ? e.bx : e.bz) ? worldCoord - s.lo : s.hi - worldCoord;
}

interface Piece { lo: number; hi: number; owners: { moduleId: string; side: ModuleSide; edge: Edge }[] }

export function compileModules(modules: SpaceModule[]): { walls: CompiledWall[]; conflicts: OpeningConflict[] } {
  const conflicts: OpeningConflict[] = [];
  const walls: CompiledWall[] = [];
  const byId = new Map(modules.map((m) => [m.id, m]));

  // (horiz, fixed좌표) 그룹으로 동일선상 변들을 모은다
  type Item = { moduleId: string; side: ModuleSide; edge: Edge; lo: number; hi: number };
  const groups = new Map<string, Item[]>();
  for (const m of modules) {
    const edges = moduleEdges(m);
    for (const side of ['N', 'E', 'S', 'W'] as ModuleSide[]) {
      const e = edges[side];
      const s = span(e);
      const key = `${s.horiz ? 'H' : 'V'}:${Math.round(s.fixed / EPS)}`;
      const arr = groups.get(key) ?? [];
      arr.push({ moduleId: m.id, side, edge: e, lo: s.lo, hi: s.hi });
      groups.set(key, arr);
    }
  }

  for (const [key, items] of groups) {
    const horiz = key.startsWith('H');
    const fixed = span(items[0].edge).fixed;
    // 구간 경계점으로 조각 분할 (모든 lo/hi 수집)
    const cuts = [...new Set(items.flatMap((i) => [i.lo, i.hi]))].sort((a, b) => a - b);
    const pieces: Piece[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const lo = cuts[i], hi = cuts[i + 1];
      if (hi - lo < EPS) continue;
      const mid = (lo + hi) / 2;
      const owners = items.filter((it) => it.lo - EPS < mid && mid < it.hi + EPS)
        .map((it) => ({ moduleId: it.moduleId, side: it.side, edge: it.edge }));
      if (owners.length === 0) continue;
      pieces.push({ lo, hi, owners });
    }

    for (const p of pieces) {
      const ids = [...new Set(p.owners.map((o) => o.moduleId))];
      const h = Math.max(...ids.map((id) => byId.get(id)!.wallH));
      const wall: CompiledWall = horiz
        ? { ax: p.lo, az: fixed, bx: p.hi, bz: fixed, h, sourceModuleIds: ids, openings: [] }
        : { ax: fixed, az: p.lo, bx: fixed, bz: p.hi, h, sourceModuleIds: ids, openings: [] };

      // 이 조각 구간에 걸치는 개구부 수집 (모듈별)
      const cand: CompiledOpening[] = [];
      for (const o of p.owners) {
        const m = byId.get(o.moduleId)!;
        for (const op of m.openings) {
          if (op.side !== o.side) continue;
          // opening 중심의 월드 1D 좌표
          const s = span(o.edge);
          const startWorld = horiz
            ? (o.edge.ax <= o.edge.bx ? s.lo : s.hi)
            : (o.edge.az <= o.edge.bz ? s.lo : s.hi);
          const dir = horiz
            ? (o.edge.ax <= o.edge.bx ? 1 : -1)
            : (o.edge.az <= o.edge.bz ? 1 : -1);
          const centerWorld = startWorld + dir * op.offset;
          if (centerWorld < p.lo - EPS || centerWorld > p.hi + EPS) continue; // 이 조각 밖
          // suppressed 유효성: 이긴 상대가 같은 공유 조각에 실제로 있으면 제외
          if (op.suppressedBy) {
            const winnerHere = p.owners.some((ow) =>
              byId.get(ow.moduleId)!.openings.some((x) => x.id === op.suppressedBy && x.side === ow.side));
            if (winnerHere) continue;
          }
          cand.push({
            moduleId: o.moduleId, openingId: op.id, type: op.type,
            t: centerWorld - p.lo, width: op.width, height: op.height,
          });
        }
      }
      // 공유벽 개구부 충돌: 서로 다른 모듈의 후보 구간이 겹치면 conflict + 해당 쌍 전부 제외
      const excluded = new Set<string>();
      for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i], b = cand[j];
        if (a.moduleId === b.moduleId) continue;
        const overlap = Math.min(a.t + a.width / 2, b.t + b.width / 2)
                      - Math.max(a.t - a.width / 2, b.t - b.width / 2);
        if (overlap > EPS) {
          conflicts.push({
            a: { moduleId: a.moduleId, openingId: a.openingId },
            b: { moduleId: b.moduleId, openingId: b.openingId },
          });
          excluded.add(a.openingId); excluded.add(b.openingId);
        }
      }
      wall.openings = cand.filter((c) => !excluded.has(c.openingId));
      walls.push(wall);
    }
  }
  return { walls, conflicts };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/features/spaceModules/compileModules.test.ts` / Expected: PASS (9 tests). 실패 시 edgeT/방향 정규화부터 의심.
- [ ] **Step 5: 커밋** — `git commit -m "feat: compileModules — 공유벽 병합·분할 + 개구부 승계/충돌 컴파일러"`

---

### Task 3: syncModuleWalls — layoutStore 브리지 (실시간 컴파일 연결)

**Files:**
- Create: `src/features/spaceModules/syncModuleWalls.ts`
- Test: `src/features/spaceModules/syncModuleWalls.test.ts`
- Modify: `src/App.tsx` (mount 1줄 — Task 4에서 UI와 함께)

**Interfaces:**
- Consumes: `compileModules`, 기존 `Node.create(position, layoutRegistry)` / `Wall.create(start, end, layoutRegistry)` (`src/domain/structures/*`), `useLayoutStore`(walls), `buildSpaces(useLayoutStore.getState().walls, layoutRegistry)` (`src/domain/layout/SpaceBuilder`), `layoutRegistry` (`src/domain/state/layoutStore.ts:153`)
- Produces:

```ts
/** 모듈발 벽 식별 태그 — Wall 인스턴스에 심는 심볼 필드 (도메인 코드 무수정). */
export function isModuleWall(w: Wall): boolean;
export function wallSourceModules(w: Wall): string[] | undefined;
/** 모듈 상태 → layoutStore 벽 동기화 + buildSpaces. UI 없이 직접 호출 가능(테스트). */
export function syncModuleWalls(): void;
/** store subscribe + debounce(50ms) 시작. App mount 시 1회. 반환값 = 해제 함수. */
export function startModuleWallSync(): () => void;
```

동작: `compileModules` 산출과 현재 layoutStore 안의 모듈발 벽(태그)을 비교해 **모듈발 벽 전부 제거 → 재생성**(단순·안전). 그린 벽(태그 없음)은 절대 건드리지 않는다. 재생성 후 `buildSpaces` 1회 호출. Wall 태그는 `(wall as Record<symbol, unknown>)[MODULE_TAG]` 심볼 프로퍼티 — 도메인 클래스 무수정.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/features/spaceModules/syncModuleWalls.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { useSpaceModuleStore } from './spaceModuleStore';
import { syncModuleWalls, isModuleWall } from './syncModuleWalls';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';

describe('syncModuleWalls', () => {
  beforeEach(() => {
    // 레이아웃/모듈 초기화
    for (const w of [...useLayoutStore.getState().walls]) Wall.delete(w, layoutRegistry);
    useSpaceModuleStore.setState({ modules: [], selectedId: null });
  });

  it('모듈 1개 → 벽 4개 생성 + Space 1개 유도', () => {
    useSpaceModuleStore.getState().add('bedroom', 0, 0);
    syncModuleWalls();
    const { walls, spaces } = useLayoutStore.getState();
    expect(walls).toHaveLength(4);
    expect(walls.every(isModuleWall)).toBe(true);
    expect(spaces).toHaveLength(1);
  });

  it('그린 벽은 보존, 모듈 벽만 재생성', () => {
    // 그린 벽(모듈 밖 좌표) 수동 생성
    const n1 = Node.create(new Vector3(10, 0, 10), layoutRegistry);
    const n2 = Node.create(new Vector3(14, 0, 10), layoutRegistry);
    Wall.create(n1, n2, layoutRegistry);
    useSpaceModuleStore.getState().add('bath', 0, 0);
    syncModuleWalls();
    let walls = useLayoutStore.getState().walls;
    expect(walls.filter((w) => !isModuleWall(w))).toHaveLength(1); // 그린 벽 생존
    expect(walls.filter(isModuleWall)).toHaveLength(4);
    // 모듈 이동 후 재동기화 — 그린 벽 여전히 생존
    const id = useSpaceModuleStore.getState().modules[0].id;
    useSpaceModuleStore.getState().update(id, { x: 3 });
    syncModuleWalls();
    walls = useLayoutStore.getState().walls;
    expect(walls.filter((w) => !isModuleWall(w))).toHaveLength(1);
    expect(walls.filter(isModuleWall)).toHaveLength(4);
  });

  it('모듈 2개 맞벽 → 공유벽 포함 7개, 모듈 삭제 시 벽 제거', () => {
    useSpaceModuleStore.getState().add('custom', 0, 0);   // w=3,d=3
    useSpaceModuleStore.getState().add('custom', 3, 0);   // E-W 맞벽
    syncModuleWalls();
    expect(useLayoutStore.getState().walls).toHaveLength(7);
    const id = useSpaceModuleStore.getState().modules[1].id;
    useSpaceModuleStore.getState().remove(id);
    syncModuleWalls();
    expect(useLayoutStore.getState().walls).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/features/spaceModules/syncModuleWalls.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**

```ts
// src/features/spaceModules/syncModuleWalls.ts
import { Vector3 } from 'three';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { useSpaceModuleStore } from './spaceModuleStore';
import { compileModules, type OpeningConflict } from './compileModules';

/** 모듈발 벽 태그 — 도메인 클래스 무수정 확장 (스펙 '기존 구조 무변경' 원칙). */
const MODULE_TAG: unique symbol = Symbol('spaceModuleWall');
type Tagged = { [MODULE_TAG]?: string[] };

export function isModuleWall(w: Wall): boolean {
  return (w as unknown as Tagged)[MODULE_TAG] !== undefined;
}
export function wallSourceModules(w: Wall): string[] | undefined {
  return (w as unknown as Tagged)[MODULE_TAG];
}

/** 마지막 컴파일의 개구부 충돌 — UI(충돌 다이얼로그)가 구독. */
export const lastConflicts: { current: OpeningConflict[] } = { current: [] };

/** 모듈 상태를 layoutStore 벽으로 동기화하고 공간을 재유도한다. */
export function syncModuleWalls(): void {
  const modules = useSpaceModuleStore.getState().modules;
  const { walls: compiled, conflicts } = compileModules(modules);
  lastConflicts.current = conflicts;

  // 1) 기존 모듈발 벽 전부 제거 (그린 벽은 태그 없음 → 불변)
  for (const w of [...useLayoutStore.getState().walls]) {
    if (isModuleWall(w)) Wall.delete(w, layoutRegistry);
  }
  // 2) 컴파일 산출 재생성 — Node.create 는 findByPosition 으로 공유 코너 자동 병합
  for (const c of compiled) {
    const start = Node.create(new Vector3(c.ax, 0, c.az), layoutRegistry);
    const end = Node.create(new Vector3(c.bx, 0, c.bz), layoutRegistry);
    const wall = Wall.create(start, end, layoutRegistry);
    (wall as unknown as Tagged)[MODULE_TAG] = c.sourceModuleIds;
    wall.wallHeight = c.h; // Wall 에 높이 필드가 없으면 이 줄 제거 (기존 전역 벽높이 사용)
  }
  // 3) 공간 재유도 — 그린 벽 + 모듈 벽 합산은 layoutStore 가 이미 하나의 목록
  buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
}

/** 모듈 store 변경 구독 + 50ms debounce. 해제 함수 반환. */
export function startModuleWallSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useSpaceModuleStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(syncModuleWalls, 50);
  });
  return () => { if (timer) clearTimeout(timer); unsub(); };
}
```

주의: `wall.wallHeight` 는 Wall 에 해당 세터가 있는지 확인(`grep -n "wallHeight\|height" src/domain/structures/Wall.ts`). 없으면 그 줄을 제거하고 전역 벽높이를 따른다 — 도메인 수정 금지.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/features/spaceModules` / Expected: PASS. `buildSpaces` 가 jsdom 없이 도는지 확인(three 의존만이면 OK; 실패 시 vitest environment 확인)
- [ ] **Step 5: 커밋** — `git commit -m "feat: syncModuleWalls — 모듈→Wall 실시간 동기화 브리지 (그린 벽 보존)"`

---

### Task 4: ModulePalette + 배치 + 3D 표시

**Files:**
- Create: `src/ui/ModulePalette.tsx`
- Create: `src/features/spaceModules/ModulePlacement.tsx` (Canvas 내부: 배치 클릭 + 모듈 바닥 슬래브/라벨 + 선택)
- Modify: `src/App.tsx` — Canvas 안에 `<ModulePlacement />`, 밖에 `<ModulePalette />`, `useEffect(startModuleWallSync)` 3곳 추가

**Interfaces:**
- Consumes: Task 1 store, Task 3 `startModuleWallSync`
- Produces: `useSpaceModuleStore` 의 `pendingKind: ModuleKind | null` + `setPendingKind` 액션 (팔레트→배치 대기 상태; Task 1 store 에 필드 추가)

동작:
- 팔레트: `MODULE_PRESETS` 버튼 목록. 클릭 → `pendingKind` 설정 → 바닥 클릭 시 `add(kind, x, z)` 후 해제. ESC 취소.
- 3D 표시: 각 모듈에 반투명 바닥 슬래브(`planeGeometry`, 모듈 색) + 이름 라벨(`drei Html` 또는 기존 라벨 패턴). 클릭 → `select(id)`. 선택 시 테두리 하이라이트(`Edges`).
- 벽 자체는 Task 3이 layoutStore 로 흘려 기존 WallView 가 렌더 — 여기선 안 그린다.

- [ ] **Step 1: store 에 pendingKind 추가 + 테스트 1개 추가** (`spaceModuleStore.test.ts` 에)

```ts
it('pendingKind 설정/해제', () => {
  useSpaceModuleStore.getState().setPendingKind('kitchen');
  expect(useSpaceModuleStore.getState().pendingKind).toBe('kitchen');
  useSpaceModuleStore.getState().setPendingKind(null);
  expect(useSpaceModuleStore.getState().pendingKind).toBeNull();
});
```

store 구현에 `pendingKind: null` 초기값과 `setPendingKind(k: ModuleKind | null)` 추가.

- [ ] **Step 2: 테스트 통과 확인** — `npx vitest run src/features/spaceModules/spaceModuleStore.test.ts`
- [ ] **Step 3: ModulePalette 구현** — 기존 `DraggablePanel` 사용(Toolbar/LightingPanel 스타일 참조):

```tsx
// src/ui/ModulePalette.tsx
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { MODULE_PRESETS, useSpaceModuleStore, type ModuleKind } from '@/features/spaceModules/spaceModuleStore';

/** 공간 모듈 팔레트 — 종류 클릭 → 바닥 클릭으로 배치. */
export function ModulePalette() {
  const pending = useSpaceModuleStore((s) => s.pendingKind);
  const setPending = useSpaceModuleStore((s) => s.setPendingKind);
  return (
    <DraggablePanel id="module-palette" title="�which 공간 모듈" defaultY={120} width={180} accent="#a78bfa">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(MODULE_PRESETS) as ModuleKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setPending(pending === k ? null : k)}
            style={{
              padding: '6px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              border: '1px solid #3f3f46', textAlign: 'left',
              background: pending === k ? '#a78bfa' : '#27272a',
              color: pending === k ? '#0a0a0a' : '#e5e5e5',
            }}
          >
            {MODULE_PRESETS[k].label} <span style={{ opacity: 0.5, fontSize: 10 }}>
              {MODULE_PRESETS[k].w}×{MODULE_PRESETS[k].d}m</span>
          </button>
        ))}
      </div>
      {pending && <div style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>바닥을 클릭해 배치 · ESC 취소</div>}
    </DraggablePanel>
  );
}
```

(타이틀의 이모지는 "🧩 공간 모듈"로 — 위 코드 오타 수정해 사용)

- [ ] **Step 4: ModulePlacement 구현** — 바닥 클릭 캐치는 기존 상품 고스트 배치 패턴(`ProductPlacement.tsx` 의 바닥 plane onPointerMove/Down) 참조:

```tsx
// src/features/spaceModules/ModulePlacement.tsx
import { useEffect, useState } from 'react';
import { Edges, Html } from '@react-three/drei';
import { useSpaceModuleStore, MODULE_PRESETS } from './spaceModuleStore';

const KIND_COLOR: Record<string, string> = {
  bedroom: '#93c5fd', living: '#fcd34d', kitchen: '#86efac',
  bath: '#a5f3fc', entrance: '#d8b4fe', corridor: '#e5e7eb', custom: '#f9a8d4',
};

/** 공간 모듈 배치/표시/선택 — Canvas 내부 전용. */
export function ModulePlacement() {
  const modules = useSpaceModuleStore((s) => s.modules);
  const selectedId = useSpaceModuleStore((s) => s.selectedId);
  const pendingKind = useSpaceModuleStore((s) => s.pendingKind);
  const [ghost, setGhost] = useState<[number, number] | null>(null);

  // ESC 로 배치 취소
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSpaceModuleStore.getState().setPendingKind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <group>
      {/* 배치 모드: 투명 바닥 캐처 + 고스트 */}
      {pendingKind && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          onPointerMove={(e) => { e.stopPropagation(); setGhost([e.point.x, e.point.z]); }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const s = useSpaceModuleStore.getState();
            s.add(pendingKind, e.point.x, e.point.z);
            s.setPendingKind(null);
            setGhost(null);
          }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {pendingKind && ghost && (
        <mesh position={[ghost[0], 0.02, ghost[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[MODULE_PRESETS[pendingKind].w, MODULE_PRESETS[pendingKind].d]} />
          <meshBasicMaterial color="#a78bfa" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}

      {/* 모듈 바닥 슬래브 + 라벨 + 선택 */}
      {modules.map((m) => {
        const rotY = (-m.ry * Math.PI) / 180;
        const sel = m.id === selectedId;
        return (
          <group key={m.id} position={[m.x, 0, m.z]} rotation={[0, rotY, 0]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.015, 0]}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                useSpaceModuleStore.getState().select(m.id);
              }}
            >
              <planeGeometry args={[m.w, m.d]} />
              <meshBasicMaterial
                color={KIND_COLOR[m.kind]}
                transparent opacity={sel ? 0.4 : 0.18} depthWrite={false}
              />
              {sel && <Edges scale={1.001} color="#a78bfa" />}
            </mesh>
            <Html center position={[0, 0.05, 0]} style={{ pointerEvents: 'none', fontSize: 11, color: '#334155', fontWeight: 600, textShadow: '0 0 3px #fff' }}>
              {m.name}
            </Html>
          </group>
        );
      })}
    </group>
  );
}
```

- [ ] **Step 5: App.tsx 연결** — import 3개 + Canvas 안 `<ModulePlacement />`(PlanScene 근처), Canvas 밖 `<ModulePalette />`(다른 패널들 옆), 그리고:

```tsx
useEffect(() => startModuleWallSync(), []);
```

(App 컴포넌트 본문. `startModuleWallSync` 가 해제 함수를 반환하므로 그대로 cleanup.)

- [ ] **Step 6: 수동 검증** — `npm run dev` → 팔레트에서 침실 클릭 → 바닥 클릭 → 벽 4개 + 바닥 슬래브 + 라벨 표시, 공간(Space) 인식 확인. `npx tsc --noEmit` 통과.
- [ ] **Step 7: 커밋** — `git commit -m "feat: 공간 모듈 팔레트·배치·3D 표시 + 실시간 벽 동기화 연결"`

---

### Task 5: 모듈 드래그 이동 + 벽면 스냅

**Files:**
- Create: `src/features/spaceModules/moduleSnap.ts`
- Test: `src/features/spaceModules/moduleSnap.test.ts`
- Modify: `src/features/spaceModules/ModulePlacement.tsx` (드래그 핸들러 추가)

**Interfaces:**
- Consumes: `moduleEdges` (Task 2)
- Produces:

```ts
/** 이동 중 모듈(가상 위치 x,z)이 다른 모듈 벽면에 스냅될 보정량. 스냅 없으면 {dx:0,dz:0}. */
export function computeModuleSnap(
  moving: SpaceModule, x: number, z: number, others: SpaceModule[],
): { dx: number; dz: number };
export const MODULE_SNAP_DIST = 0.15; // m
```

규칙: 이동 모듈의 4변 각각에 대해, 다른 모듈의 **평행한 변**과의 수직 거리가 `MODULE_SNAP_DIST` 미만이고 진행 구간이 겹치면(>0) 면-맞춤 보정. 축별 최소 보정 1개씩(x, z 독립). 추가로 맞닿은 상태에서 **모서리 정렬 스냅**(구간 끝점끼리 0.15m 미만이면 끝점 맞춤).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/features/spaceModules/moduleSnap.test.ts
import { describe, it, expect } from 'vitest';
import { computeModuleSnap } from './moduleSnap';
import type { SpaceModule } from './spaceModuleStore';

const mod = (p: Partial<SpaceModule>): SpaceModule => ({
  id: 'm1', kind: 'custom', name: '', x: 0, z: 0, ry: 0,
  w: 4, d: 3, wallH: 2.4, openings: [], ...p,
});

describe('computeModuleSnap', () => {
  const fixed = mod({ id: 'fix', x: 0, z: 0 }); // E변 x=2

  it('벽면 근접 시 면-맞춤 보정 (dx)', () => {
    // 이동 모듈 w=4 → W변이 x-2. 가상중심 x=4.1 → W변 x=2.1, fixed E변(x=2)과 0.1m
    const moving = mod({ id: 'mv' });
    const s = computeModuleSnap(moving, 4.1, 0, [fixed]);
    expect(s.dx).toBeCloseTo(-0.1);
    expect(s.dz).toBe(0);
  });

  it('임계값 밖이면 스냅 없음', () => {
    const s = computeModuleSnap(mod({ id: 'mv' }), 4.5, 0, [fixed]);
    expect(s).toEqual({ dx: 0, dz: 0 });
  });

  it('구간이 안 겹치면(비켜남) 스냅 없음', () => {
    // z=10 → 변 구간 겹침 0
    const s = computeModuleSnap(mod({ id: 'mv' }), 4.1, 10, [fixed]);
    expect(s).toEqual({ dx: 0, dz: 0 });
  });

  it('면 맞춘 상태에서 모서리 정렬(dz)', () => {
    // 면은 이미 맞음(x=4), z가 0.1 어긋남 → 모서리 스냅 dz=-0.1 (d 같음 3)
    const s = computeModuleSnap(mod({ id: 'mv' }), 4, 0.1, [fixed]);
    expect(s.dx).toBeCloseTo(0);
    expect(s.dz).toBeCloseTo(-0.1);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/features/spaceModules/moduleSnap.test.ts` → FAIL
- [ ] **Step 3: 구현**

```ts
// src/features/spaceModules/moduleSnap.ts
import { moduleEdges } from './compileModules';
import type { SpaceModule } from './spaceModuleStore';

export const MODULE_SNAP_DIST = 0.15;
const EPS = 1e-6;

type Edge = { ax: number; az: number; bx: number; bz: number };
const isH = (e: Edge) => Math.abs(e.az - e.bz) < 1e-4;
const span1D = (e: Edge) => isH(e)
  ? { lo: Math.min(e.ax, e.bx), hi: Math.max(e.ax, e.bx), fixed: e.az }
  : { lo: Math.min(e.az, e.bz), hi: Math.max(e.az, e.bz), fixed: e.ax };

/** 이동 모듈(가상 중심 x,z)의 면/모서리 스냅 보정량. */
export function computeModuleSnap(
  moving: SpaceModule, x: number, z: number, others: SpaceModule[],
): { dx: number; dz: number } {
  const virt: SpaceModule = { ...moving, x, z };
  const myEdges = Object.values(moduleEdges(virt));
  let bestDx = 0, bx = MODULE_SNAP_DIST;
  let bestDz = 0, bz = MODULE_SNAP_DIST;
  // 모서리 정렬 후보 (면이 이미 맞거나 이번에 맞춰질 때만 적용)
  let cornerDx = 0, cbx = MODULE_SNAP_DIST;
  let cornerDz = 0, cbz = MODULE_SNAP_DIST;

  for (const o of others) {
    if (o.id === moving.id) continue;
    for (const oe of Object.values(moduleEdges(o))) {
      for (const me of myEdges) {
        if (isH(me) !== isH(oe)) continue; // 평행 변만
        const a = span1D(me), b = span1D(oe);
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        const gap = b.fixed - a.fixed; // 면 맞춤 보정량
        if (overlap > EPS && Math.abs(gap) < (isH(me) ? bz : bx)) {
          if (isH(me)) { bz = Math.abs(gap); bestDz = gap; }
          else { bx = Math.abs(gap); bestDx = gap; }
        }
        // 면이 (거의) 맞닿아 있으면 진행방향 모서리 정렬
        if (Math.abs(gap) < MODULE_SNAP_DIST + EPS && overlap > -MODULE_SNAP_DIST) {
          for (const [ue, oe2] of [[a.lo, b.lo], [a.hi, b.hi], [a.lo, b.hi], [a.hi, b.lo]]) {
            const d = oe2 - ue;
            if (Math.abs(d) < (isH(me) ? cbx : cbz) && Math.abs(d) > EPS) {
              if (isH(me)) { cbx = Math.abs(d); cornerDx = d; }   // 수평 변 → 진행축 x
              else { cbz = Math.abs(d); cornerDz = d; }            // 수직 변 → 진행축 z
            }
          }
        }
      }
    }
  }
  return {
    dx: bestDx !== 0 ? bestDx : cornerDx,
    dz: bestDz !== 0 ? bestDz : cornerDz,
  };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/features/spaceModules/moduleSnap.test.ts` → PASS (4 tests)
- [ ] **Step 5: 드래그 연결** — `ModulePlacement.tsx` 모듈 슬래브 mesh에 드래그: onPointerDown에서 `select` + 드래그 시작(포인터 캡처), onPointerMove(바닥 레이 교점)에서

```tsx
const snap = computeModuleSnap(m, e.point.x - grabOffset.x, e.point.z - grabOffset.z,
  useSpaceModuleStore.getState().modules);
useSpaceModuleStore.getState().update(m.id, {
  x: e.point.x - grabOffset.x + snap.dx,
  z: e.point.z - grabOffset.z + snap.dz,
});
```

(grabOffset = 잡은 지점 - 모듈 중심, 드래그 중 OrbitControls 비활성은 기존 상품 드래그 패턴(`makeDefault` controls enabled 토글) 참조. 회전: 선택 상태에서 `R` 키 → `update(id, { ry: ((m.ry + 90) % 360) as 0|90|180|270 })`.)

- [ ] **Step 6: 수동 검증** — dev 서버에서 모듈 2개 배치 후 드래그 → 0.15m 안에서 면이 착 붙고, 공유벽이 1장으로 합쳐지는지(벽 개수 감소) 확인
- [ ] **Step 7: 커밋** — `git commit -m "feat: 모듈 드래그 이동 + 벽면/모서리 스냅"`

---

### Task 6: ModuleInspector — 치수/회전/개구부 편집

**Files:**
- Create: `src/ui/SpaceModuleInspector.tsx`
- Modify: `src/App.tsx` (패널 mount 1줄)

**Interfaces:**
- Consumes: Task 1 store 전체, `MODULE_PRESETS`

내용 (기존 `ModelInspector.tsx` 의 Section/NumberRow 스타일 재사용 — 복사해 지역 정의, 기존 파일 수정 금지):
- 선택 모듈 없으면 null. 헤더: 이름 입력 + 닫기(선택 해제)
- 종류(select), 폭 w / 깊이 d (0.6~12m, step 0.1) / 벽높이 (2.0~4.0) / 회전(0·90·180·270 버튼)
- 개구부 목록: 각 항목 = 변(N/E/S/W select) · 종류(문/개구부) · offset · 폭 · 높이 + 삭제. "+" 버튼 = `addOpening(id, { side:'N', type:'door', offset: m.w/2, width:0.9, height:2.1 })`
- suppressedBy 있는 개구부는 "🔇 (겹침으로 비활성)" 뱃지 표시
- 삭제 버튼: `remove(id)`

- [ ] **Step 1: 구현** (UI 컴포넌트 — 스타일은 ModelInspector 의 rowStyle/numInputStyle 패턴을 지역 상수로 복제; 숫자 입력은 `Number.isNaN` 가드 패턴 사용 — `parseFloat||0` 금지)
- [ ] **Step 2: App.tsx 에 `<SpaceModuleInspector />` 추가**
- [ ] **Step 3: 수동 검증** — 모듈 선택 → 치수 변경 시 벽이 즉시 갱신, N변에 문 추가 → 옆에 빈 모듈 붙이면 공유벽에 문 데이터 승계(Task 7 시각화 전이므로 콘솔/벽 분할로 확인). `npx tsc --noEmit` 통과
- [ ] **Step 4: 커밋** — `git commit -m "feat: 공간 모듈 인스펙터 — 치수·회전·개구부 편집"`

---

### Task 7: 개구부 시각화 + 충돌 다이얼로그 + 분리 시 suppress 해제

**Files:**
- Create: `src/features/spaceModules/OpeningMarkers.tsx` (개구부 3D 표식)
- Create: `src/ui/OpeningConflictDialog.tsx`
- Modify: `src/features/spaceModules/syncModuleWalls.ts` (충돌을 store 로 노출 + 분리 시 해제)
- Modify: `src/features/spaceModules/spaceModuleStore.ts` (conflicts 상태 + resolve 액션)
- Test: `src/features/spaceModules/compileModules.test.ts` 에 해제 시나리오 추가

**Interfaces:**
- Produces (store 확장):

```ts
// spaceModuleStore 에 추가
openingConflicts: OpeningConflict[];                     // syncModuleWalls 가 setState
resolveConflict(winner: {moduleId,openingId}, loser: {moduleId,openingId}): void;
// → loser opening 에 suppressedBy=winner.openingId 기록
releaseStaleSuppressions(): void;
// → suppressedBy 가 가리키는 opening 의 모듈과 더 이상 같은 공유벽 조각을 공유하지 않으면 해제
```

동작:
- `syncModuleWalls` 끝에서 `conflicts` 를 store 에 반영(참조 비교로 불필요 setState 방지) + `releaseStaleSuppressions()` 호출
- `OpeningConflictDialog`: `openingConflicts[0]` 있으면 모달 — "겹치는 문/개구부가 있습니다" + [모듈A 이름의 문 유지] [모듈B 이름의 개구부 유지] 버튼 → `resolveConflict` → 재컴파일로 자동 소멸
- `OpeningMarkers`: 컴파일 산출(`lastCompiled` — syncModuleWalls 가 module-scope로 노출)의 각 opening 위치에 표식 렌더 — 문=갈색 프레임 박스(width×0.06×height), 개구부=하늘색 반투명 박스. 벽 컷아웃은 후속(스펙 비범위 아님이지만 렌더 파이프라인 무수정 원칙상 오버레이 방식)

- [ ] **Step 1: 해제 로직 테스트 추가** (`spaceModuleStore.test.ts`)

```ts
it('releaseStaleSuppressions: 분리되면 suppressedBy 해제', () => {
  const s = useSpaceModuleStore.getState();
  const id1 = s.add('custom', 0, 0);
  const id2 = s.add('custom', 3, 0); // w=3 맞벽
  const st = useSpaceModuleStore.getState();
  const o1 = st.addOpening(id1, { side: 'E', type: 'door', offset: 1.5, width: 0.9, height: 2.1 });
  const o2 = st.addOpening(id2, { side: 'W', type: 'door', offset: 1.5, width: 0.9, height: 2.1 });
  useSpaceModuleStore.getState().resolveConflict(
    { moduleId: id1, openingId: o1 }, { moduleId: id2, openingId: o2 });
  expect(useSpaceModuleStore.getState().modules[1].openings[0].suppressedBy).toBe(o1);
  // 모듈2를 멀리 이동 → 해제
  useSpaceModuleStore.getState().update(id2, { x: 20 });
  useSpaceModuleStore.getState().releaseStaleSuppressions();
  expect(useSpaceModuleStore.getState().modules[1].openings[0].suppressedBy).toBeUndefined();
});
```

- [ ] **Step 2: 실패 확인 → 구현** — `releaseStaleSuppressions` 는 `compileModules` 를 호출해 공유벽 조각에서 winner/loser 가 여전히 같은 조각에 있는지 검사(간단 버전: 두 모듈의 해당 변이 여전히 동일선상+구간겹침인지 `moduleEdges` 로 판정)
- [ ] **Step 3: 통과 확인** — `npx vitest run src/features/spaceModules` → 전부 PASS
- [ ] **Step 4: 다이얼로그 + 마커 구현, App/ModulePlacement 연결**
- [ ] **Step 5: 수동 검증** — 문 있는 모듈끼리 겹치게 붙이면 다이얼로그 → 선택 → 이긴 문만 표식. 떼면 양쪽 다 복원
- [ ] **Step 6: 커밋** — `git commit -m "feat: 개구부 표식 + 충돌 선택 다이얼로그 + 분리 시 자동 복원"`

---

### Task 8: 직렬화 — 저장/불러오기

**Files:**
- Modify: `src/persistence/PlanSaveData.ts` — 필드 추가
- Modify: `src/features/undoredo/commands/LoadPlanCommand.ts` — 로드 시 모듈 복원 (저장 생성부는 `grep -rn "PlanSaveData" src/host` 로 직렬화 생성 함수 위치 확인 후 같은 패턴으로 필드 기입)
- Test: `src/features/spaceModules/serialization.test.ts`

**Interfaces:**

```ts
// PlanSaveData.ts 에 추가 (기존 필드 무변경)
export interface SpaceModuleData {
  id: string; kind: string; name: string;
  x: number; z: number; ry: number;
  w: number; d: number; wallH: number;
  openings: { id: string; side: string; type: string; offset: number; width: number; height: number; suppressedBy?: string }[];
}
export interface PlanSaveData {
  // ...기존 필드...
  /** 공간 모듈 목록 (선택 — 구버전 데이터 하위 호환). */
  spaceModules?: SpaceModuleData[];
}
// 신규 헬퍼 (spaceModules 피처 안에 두어 persistence 수정 최소화)
// src/features/spaceModules/serialization.ts
export function modulesToSaveData(modules: SpaceModule[]): SpaceModuleData[];
export function modulesFromSaveData(data: SpaceModuleData[] | undefined): SpaceModule[];
```

- [ ] **Step 1: 라운드트립 테스트 작성**

```ts
// src/features/spaceModules/serialization.test.ts
import { describe, it, expect } from 'vitest';
import { modulesToSaveData, modulesFromSaveData } from './serialization';
import type { SpaceModule } from './spaceModuleStore';

it('직렬화 라운드트립 — 필드 보존', () => {
  const mods: SpaceModule[] = [{
    id: 'sm-1', kind: 'bedroom', name: '침실1', x: 1.5, z: -2, ry: 90,
    w: 3.6, d: 3, wallH: 2.4,
    openings: [{ id: 'op-1', side: 'E', type: 'door', offset: 1.2, width: 0.9, height: 2.1, suppressedBy: 'op-9' }],
  }];
  expect(modulesFromSaveData(modulesToSaveData(mods))).toEqual(mods);
});

it('undefined(구버전 데이터) → 빈 배열', () => {
  expect(modulesFromSaveData(undefined)).toEqual([]);
});
```

- [ ] **Step 2: 실패 확인 → 구현** — to/from 은 필드 매핑 + kind/side/type 문자열 검증(모르는 값은 'custom'/'N'/'opening' 폴백). PlanSaveData 에 optional 필드 추가.
- [ ] **Step 3: 저장/로드 연결** — 저장 생성부(`grep -rn "walls:" src/host/HostBridge.ts src/networking` 로 PlanSaveData 조립 위치 확인)에 `spaceModules: modulesToSaveData(useSpaceModuleStore.getState().modules)` 추가. `LoadPlanCommand` 실행부에 `useSpaceModuleStore.setState({ modules: modulesFromSaveData(data.spaceModules) })` + `syncModuleWalls()` 추가. **주의**: 로드 직후 sync 가 모듈 벽을 재생성하므로, 저장 시 모듈발 벽(Wall 태그)은 walls 직렬화에서 **제외**해야 중복 생성이 안 된다 — 저장 조립부에서 `walls.filter(w => !isModuleWall(w))`.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/features/spaceModules` 전부 PASS + 수동: 모듈 2개 조립 → 저장 → 새로고침 → 로드 → 동일 복원
- [ ] **Step 5: 커밋** — `git commit -m "feat: 공간 모듈 직렬화 — 저장/불러오기 + 하위 호환 (모듈발 벽 저장 제외)"`

---

### Task 9: 통합 검증 + 버전 릴리스

- [ ] **Step 1: 전체 테스트** — `npx vitest run` → 전부 PASS
- [ ] **Step 2: 타입/빌드** — `npx tsc --noEmit && npx vite build` → 성공
- [ ] **Step 3: E2E 수동 시나리오** — dev 서버에서:
  1. 침실+욕실+복도 배치, 스냅 조립 → 공유벽 확인
  2. 침실 E변에 문 추가 → 복도 붙이기 → 문 승계 표식
  3. 양쪽 문 충돌 → 다이얼로그 선택 → 분리 → 복원
  4. 기존 벽 그리기로 벽 추가 → 혼용 정상 (그린 벽 유지)
  5. 저장/로드 라운드트립
- [ ] **Step 4: 버전 증가 + 최종 커밋** — package.json patch 증가, `git commit -m "feat: 공간 모듈 조립 시스템 완성 (vX.Y.Z)"`

---

## Self-Review 결과

- 스펙 §1~6 전부 태스크 매핑됨 (모델→T1, 컴파일→T2·3, 스냅→T5, UI→T4·6·7, 직렬화→T8, 테스트→각 태스크+T9). 개구부 "벽 컷아웃" 렌더는 스펙에서도 기존 Wall 삽입 구조 활용이 TODO 상태라 **오버레이 표식**으로 구현(무변경 원칙 우선) — 컷아웃은 후속.
- 타입 일관성: `SpaceModule/ModuleOpening/CompiledWall/OpeningConflict` 시그니처를 태스크 간 동일하게 사용.
- 주의점 명시: Wall.wallHeight 존재 확인, 저장 시 모듈발 벽 제외.