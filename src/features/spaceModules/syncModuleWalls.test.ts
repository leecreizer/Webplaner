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
