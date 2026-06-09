import { create } from 'zustand';

/** 패널이 붙는 화면 변. */
export type PanelSide = 'left' | 'right';

export interface PanelPos {
  side: PanelSide;
  /** 변 기준 세로 위치 (px, top). */
  top: number;
}

/**
 * 떠다니는 패널들의 위치 관리.
 *
 * - 각 패널은 좌/우 변 중 하나에 스냅되고 세로 top 으로 쌓인다.
 * - 드래그 종료 시 중심 x 로 좌/우 판정 후 같은 변의 다른 패널과 겹치지 않게 reflow.
 * - 위치는 세션 동안 유지 (새 패널은 default 로 등록).
 */
export interface PanelStoreState {
  pos: Record<string, PanelPos>;
  /** 측정된 패널 높이 (reflow 계산용). */
  heights: Record<string, number>;
  /** 패널 위치 등록/갱신. */
  setPos: (id: string, pos: PanelPos) => void;
  /** 높이 보고. */
  reportHeight: (id: string, h: number) => void;
  /** 기본 위치 (없을 때만). */
  ensureDefault: (id: string, def: PanelPos) => void;
}

export const usePanelStore = create<PanelStoreState>((set) => ({
  pos: {},
  heights: {},
  setPos: (id, pos) => set((s) => ({ pos: { ...s.pos, [id]: pos } })),
  reportHeight: (id, h) =>
    set((s) => (s.heights[id] === h ? s : { heights: { ...s.heights, [id]: h } })),
  ensureDefault: (id, def) =>
    set((s) => (s.pos[id] ? s : { pos: { ...s.pos, [id]: def } })),
}));

const GAP = 8;
const TOP_MARGIN = 72; // 툴바 아래

/**
 * 같은 변의 패널들을 top 순으로 정렬 후, dragged 패널을 dropTop 근처에 두되 겹치면 아래로 밀어
 * 쌓는다. dragged 외 패널들은 위치 유지(움직이지 않음) — dragged 만 빈 자리에 스냅.
 */
export function resolveStack(
  pos: Record<string, PanelPos>,
  heights: Record<string, number>,
  draggedId: string,
  side: PanelSide,
  dropTop: number,
): number {
  // 같은 변의 *다른* 패널들의 [top, bottom] 구간
  const others = Object.entries(pos)
    .filter(([id, p]) => id !== draggedId && p.side === side)
    .map(([id, p]) => ({ top: p.top, bottom: p.top + (heights[id] ?? 100) }))
    .sort((a, b) => a.top - b.top);

  const h = heights[draggedId] ?? 100;
  let top = Math.max(TOP_MARGIN, dropTop);

  // 겹치는 구간이 있으면 그 아래로 이동, 반복 (아래 패널들과도 안 겹칠 때까지)
  let moved = true;
  let guard = 0;
  while (moved && guard < 20) {
    moved = false;
    guard++;
    for (const o of others) {
      if (top < o.bottom && top + h > o.top) {
        top = o.bottom + GAP;
        moved = true;
      }
    }
  }
  // 화면 아래로 너무 내려가면 위로 (최소 TOP_MARGIN)
  const maxTop = Math.max(TOP_MARGIN, window.innerHeight - h - 16);
  if (top > maxTop) top = maxTop;
  return top;
}