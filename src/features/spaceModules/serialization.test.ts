import { describe, it, expect } from 'vitest';
import { modulesToSaveData, modulesFromSaveData } from './serialization';
import type { SpaceModule } from './spaceModuleStore';

describe('spaceModules serialization', () => {
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

  it('알 수 없는 kind/side/type → 안전 기본값 폴백', () => {
    const restored = modulesFromSaveData([{
      id: 'sm-2', kind: 'unknown-kind', name: '기타', x: 0, z: 0, ry: 45,
      w: 2, d: 2, wallH: 2.4,
      openings: [{ id: 'op-2', side: 'X', type: 'weird', offset: 0, width: 1, height: 2 }],
    }]);
    expect(restored).toEqual([{
      id: 'sm-2', kind: 'custom', name: '기타', x: 0, z: 0, ry: 45, // 자유각 지원 — 45° 유지
      w: 2, d: 2, wallH: 2.4,
      openings: [{ id: 'op-2', side: 'N', type: 'opening', offset: 0, width: 1, height: 2 }],
    }]);
  });
});
