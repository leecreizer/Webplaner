import { create } from 'zustand';

/** 패널 자유 좌표 (px, fixed left/top). */
export interface PanelXY {
  x: number;
  y: number;
}

/**
 * 떠다니는 패널 위치 관리 — 자유 좌표 + 자석 스냅.
 *
 * - 패널은 화면 어디든 자유 배치 (드래그하는 대로).
 * - 드롭 시: 브라우저 좌/우 *끝에 닿으면* 엣지 스냅, 다른 패널 가장자리에 *가까우면* 옆에 붙음.
 */
export interface PanelStoreState {
  pos: Record<string, PanelXY>;
  setPos: (id: string, xy: PanelXY) => void;
  ensureDefault: (id: string, xy: PanelXY) => void;
}

export const usePanelStore = create<PanelStoreState>((set) => ({
  pos: {},
  setPos: (id, xy) => set((s) => ({ pos: { ...s.pos, [id]: xy } })),
  ensureDefault: (id, xy) => set((s) => (s.pos[id] ? s : { pos: { ...s.pos, [id]: xy } })),
}));

const EDGE = 28; // 브라우저 끝 스냅 임계 (이 안쪽으로 들어오면 끝에 붙음)
const SNAP = 18; // 패널끼리 자석 스냅 임계
const GAP = 6; // 붙을 때 간격
const MARGIN = 8; // 엣지 스냅 시 여백
const TOP_MIN = 64; // 툴바 아래

export interface PanelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 드롭 위치 (x,y) + 크기 (w,h) + 다른 패널 rect 들로 자석 스냅된 최종 좌표 계산.
 *
 * 1. 브라우저 좌/우 끝 *접촉* 시 엣지 스냅
 * 2. 다른 패널 가장자리(좌↔우 / 상단정렬 / 하단스택)에 *근접* 시 옆에/아래에 붙임
 * 3. 화면 밖으로 안 나가게 clamp
 */
export function snapPanel(
  x: number,
  y: number,
  w: number,
  h: number,
  others: PanelRect[],
): PanelXY {
  const W = window.innerWidth;
  const H = window.innerHeight;
  let nx = x;
  let ny = y;

  // 1) 브라우저 좌/우 끝 접촉 스냅
  if (x <= EDGE) nx = MARGIN;
  else if (x + w >= W - EDGE) nx = W - w - MARGIN;

  // 2) 패널끼리 자석 스냅 — 세로 구간이 겹칠 때만 좌우 가장자리 매칭
  for (const o of others) {
    const vOverlap = ny < o.bottom && ny + h > o.top;
    const hOverlap = nx < o.right && nx + w > o.left;
    // 내 왼쪽 ~ 상대 오른쪽 → 상대 오른편에 붙임 + 상단 정렬
    if (vOverlap && Math.abs(nx - o.right) < SNAP) {
      nx = o.right + GAP;
      ny = o.top;
    }
    // 내 오른쪽 ~ 상대 왼쪽 → 상대 왼편에 붙임 + 상단 정렬
    else if (vOverlap && Math.abs(nx + w - o.left) < SNAP) {
      nx = o.left - w - GAP;
      ny = o.top;
    }
    // 내 위 ~ 상대 아래 → 상대 아래에 스택 + 좌측 정렬
    if (hOverlap && Math.abs(ny - o.bottom) < SNAP) {
      ny = o.bottom + GAP;
      nx = o.left;
    }
    // 상단 정렬 스냅
    else if (Math.abs(ny - o.top) < SNAP && (vOverlap || hOverlap)) {
      ny = o.top;
    }
  }

  // 3) clamp
  nx = Math.max(0, Math.min(nx, W - w));
  ny = Math.max(TOP_MIN, Math.min(ny, H - 40));
  return { x: nx, y: ny };
}