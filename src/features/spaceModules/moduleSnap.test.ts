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
