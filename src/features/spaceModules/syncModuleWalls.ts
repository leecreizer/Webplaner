import { BoxGeometry, Vector3 } from 'three';
import { useEditStore } from '@/features/editing/editStore';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { useSpaceModuleStore } from './spaceModuleStore';
import { compileModules, type CompiledWall, type OpeningConflict } from './compileModules';

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
/**
 * 모듈 드래그 중 벽 sync 동결 플래그.
 * 드래그 중 debounce 가 발동하면 벽 전체 재생성+CSG 재평가로 메인 스레드가 수백 ms 멈춰
 * 마우스 추종이 끊긴다 → 드래그 동안 sync 를 미루고, 드래그 종료 시 1회 실행.
 */
let _dragging = false;
let _pendingWhileDrag = false;

export function setModuleDragging(dragging: boolean): void {
  _dragging = dragging;
  if (!dragging && _pendingWhileDrag) {
    _pendingWhileDrag = false;
    syncModuleWalls();
  }
}

/** 이번 sync 가 등록한 개구부 CSG 컷 op id — 다음 sync 에서 제거 후 재등록. */
let _openingOpIds: number[] = [];

export const lastConflicts: { current: OpeningConflict[] } = { current: [] };
/** 마지막 컴파일 결과 벽 목록 — OpeningMarkers 가 참조. */
export const lastCompiled: { current: CompiledWall[] } = { current: [] };

function conflictsEqual(a: OpeningConflict[], b: OpeningConflict[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].a.openingId !== b[i].a.openingId || a[i].b.openingId !== b[i].b.openingId) return false;
  }
  return true;
}

/** 모듈 상태를 layoutStore 벽으로 동기화하고 공간을 재유도한다. */
export function syncModuleWalls(): void {
  // 분리된 모듈의 낡은 suppressedBy 를 먼저 해제 — 새 컴파일에 반영되도록.
  useSpaceModuleStore.getState().releaseStaleSuppressions();

  const modules = useSpaceModuleStore.getState().modules;
  const { walls: compiled, conflicts } = compileModules(modules);
  lastConflicts.current = conflicts;
  lastCompiled.current = compiled;
  const prevConflicts = useSpaceModuleStore.getState().openingConflicts;
  if (!conflictsEqual(prevConflicts, conflicts)) {
    useSpaceModuleStore.getState().setOpeningConflicts(conflicts);
  }

  // 0) 이전 sync 의 개구부 컷 op 제거 (벽 재생성과 함께 재등록)
  {
    const edit = useEditStore.getState();
    for (const id of _openingOpIds) edit.removeOperation(id);
    _openingOpIds = [];
  }

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
    // ⭐ 개구부 실제 구멍 — WallView 의 CSG(cut) 파이프라인에 world 좌표 박스 등록.
    //   도어/개구부=바닥부터, 창호=sill 부터. 깊이는 벽 두께보다 살짝 크게(관통 보장).
    if (c.openings.length > 0) {
      const dx = c.bx - c.ax, dz = c.bz - c.az;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const rotY = -Math.atan2(dz, dx);
      const edit = useEditStore.getState();
      for (const op of c.openings) {
        const y0 = op.type === 'window' ? (op.sill ?? 0.9) : 0;
        const geo = new BoxGeometry(op.width, op.height, wall.wallThick + 0.06);
        geo.rotateY(rotY);
        geo.translate(c.ax + ux * op.t, y0 + op.height / 2, c.az + uz * op.t);
        _openingOpIds.push(edit.addOperation({
          kind: 'cut', targetKind: 'wall', ownerId: wall.wallIndex, boxGeometry: geo,
        }));
      }
    }
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
    timer = setTimeout(() => {
      if (_dragging) { _pendingWhileDrag = true; return; } // 드래그 종료 시 실행
      syncModuleWalls();
    }, 50);
  });
  return () => { if (timer) clearTimeout(timer); unsub(); };
}
