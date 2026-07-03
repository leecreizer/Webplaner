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
    wall.wallHeight = c.h;
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
