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

  it('pendingKind 설정/해제', () => {
    useSpaceModuleStore.getState().setPendingKind('kitchen');
    expect(useSpaceModuleStore.getState().pendingKind).toBe('kitchen');
    useSpaceModuleStore.getState().setPendingKind(null);
    expect(useSpaceModuleStore.getState().pendingKind).toBeNull();
  });
});
