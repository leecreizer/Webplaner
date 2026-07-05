import { BoxGeometry, Vector3 } from 'three';
import { useEditStore } from '@/features/editing/editStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { useSpaceModuleStore } from './spaceModuleStore';
import { compileModules, type CompiledWall, type OpeningConflict } from './compileModules';

/**
 * 숨김/삭제 상태 마이그레이션 — visibilityStore 는 `wall-{index}`/`floor-{index}` 키를 쓰는데
 * sync/buildSpaces 가 벽·공간을 재생성하면 인덱스가 바뀌어 숨김이 풀려 보인다(원복 체감).
 * 재빌드 전 위치 시그니처로 상태를 기억했다가 새 인덱스 키로 옮겨 붙인다.
 */
function wallSig(w: Wall): string | null {
  if (!w.startNode || !w.endNode) return null;
  const a = w.startNode.position, b = w.endNode.position;
  const r = (v: number) => Math.round(v * 20) / 20; // 5cm 격자
  // 방향 무관 정렬
  const p1 = `${r(a.x)},${r(a.z)}`, p2 = `${r(b.x)},${r(b.z)}`;
  return p1 < p2 ? `w:${p1}|${p2}` : `w:${p2}|${p1}`;
}

function snapshotVisibilityBySig(): Map<string, { hidden?: true; removed?: true }> {
  const vis = useVisibilityStore.getState();
  const map = new Map<string, { hidden?: true; removed?: true }>();
  const mark = (sig: string | null, k: 'hidden'|'removed') => {
    if (!sig) return;
    const cur = map.get(sig) ?? {};
    cur[k] = true;
    map.set(sig, cur);
  };
  for (const w of useLayoutStore.getState().walls) {
    const key = `wall-${w.wallIndex}`;
    if (vis.hidden[key]) mark(wallSig(w), 'hidden');
    if (vis.removed[key]) mark(wallSig(w), 'removed');
  }
  for (const sp of useLayoutStore.getState().spaces) {
    const r = (v: number) => Math.round(v * 10) / 10;
    const sig = `s:${r(sp.center.x)},${r(sp.center.z)}`;
    for (const kind of ['floor', 'ceiling'] as const) {
      const key = `${kind}-${sp.spaceIndex}`;
      if (vis.hidden[key]) mark(`${sig}:${kind}`, 'hidden');
      if (vis.removed[key]) mark(`${sig}:${kind}`, 'removed');
    }
  }
  return map;
}

function restoreVisibilityBySig(snap: Map<string, { hidden?: true; removed?: true }>): void {
  if (snap.size === 0) return;
  const vis = useVisibilityStore.getState();
  const apply = (sig: string | null, key: string) => {
    if (!sig) return;
    const st = snap.get(sig);
    if (!st) return;
    if (st.hidden && !vis.hidden[key]) vis.setVisible(key, false);
    if (st.removed && !vis.removed[key]) vis.remove(key);
  };
  for (const w of useLayoutStore.getState().walls) apply(wallSig(w), `wall-${w.wallIndex}`);
  for (const sp of useLayoutStore.getState().spaces) {
    const r = (v: number) => Math.round(v * 10) / 10;
    const sig = `s:${r(sp.center.x)},${r(sp.center.z)}`;
    apply(`${sig}:floor`, `floor-${sp.spaceIndex}`);
    apply(`${sig}:ceiling`, `ceiling-${sp.spaceIndex}`);
  }
}

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
let _lastDragSync = 0;

export function setModuleDragging(dragging: boolean): void {
  _dragging = dragging;
  if (!dragging) {
    // 드래그 종료 — 최종 상태로 즉시 1회 동기화
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

  // 재빌드로 인덱스가 바뀌어도 숨김/삭제가 유지되도록 시그니처 스냅샷
  const visSnap = snapshotVisibilityBySig();
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
  restoreVisibilityBySig(visSnap); // 새 인덱스 키로 숨김/삭제 이관
}

/** 모듈 store 변경 구독 + 50ms debounce. 해제 함수 반환. */
export function startModuleWallSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useSpaceModuleStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (_dragging) {
        // 드래그 중엔 150ms 스로틀 — 벽이 실시간으로 따라오되(시각 피드백)
        // 매 이벤트 전량 재생성으로 인한 스톨은 제한
        const now = performance.now();
        if (now - _lastDragSync < 150) return; // 다음 store 변경이 다시 스케줄함
        _lastDragSync = now;
      }
      syncModuleWalls();
    }, 50);
  });
  return () => { if (timer) clearTimeout(timer); unsub(); };
}
