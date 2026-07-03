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

  it('조각 경계 개구부: 절단점 위 중심 개구부는 정확히 한 벽에만 배정', () => {
    // m1 E변(x=1.5, z:-3~3)이 m2(z:-3~0)·m3(z:0~3) W변과 맞닿아 z=0에서 두 조각으로 절단.
    // 개구부 중심(offset 3.0 → z=0)이 정확히 절단점에 위치 — 양쪽 조각 중복 배정 금지.
    const m1 = mod({
      id: 'm1', w: 3, d: 6,
      openings: [{ id: 'o1', side: 'E', type: 'door', offset: 3.0, width: 0.9, height: 2.1 }],
    });
    const m2 = mod({ id: 'm2', w: 3, d: 3, x: 3, z: -1.5 });
    const m3 = mod({ id: 'm3', w: 3, d: 3, x: 3, z: 1.5 });
    const { walls } = compileModules([m1, m2, m3]);
    const onLine = walls.filter((w) => Math.abs(w.ax - 1.5) < 1e-6 && Math.abs(w.bx - 1.5) < 1e-6);
    expect(onLine).toHaveLength(2); // z:-3~0, z:0~3 두 조각
    const total = onLine.reduce((n, w) => n + w.openings.length, 0);
    expect(total).toBe(1);
  });

  it('떨어진 모듈: 공유벽 없음 (벽 8개)', () => {
    const { walls } = compileModules([mod({ id: 'm1' }), mod({ id: 'm2', x: 10 })]);
    expect(walls.filter((w) => w.sourceModuleIds.length === 2)).toHaveLength(0);
    expect(walls).toHaveLength(8);
  });
});
