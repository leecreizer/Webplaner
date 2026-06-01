import { create } from 'zustand';
import { Vector3 } from 'three';
import type { Node } from '@/domain/structures/Node';

/**
 * 정렬 가이드 라인 — 마우스 hover 위치가 기존 노드 또는 시작점과 X/Z 좌표가 정렬될 때
 * 시각적으로 표시되는 점선.
 */
export interface GuideLine {
  /** 정렬 기준이 된 기존 점 (노드/시작 노드 등). */
  from: Vector3;
  /** 현재 정렬된 마우스 hover 위치. */
  to: Vector3;
  /** 정렬 축 — `'x'` = X 좌표가 같음(수직), `'z'` = Z 좌표가 같음(수평),
   *  `'extension'` = currentStart의 기존 wall 연장선 (임의 각도). */
  axis: 'x' | 'z' | 'extension';
}

/** 그리기 모드 — line(클릭 체인) 또는 rectangle(드래그 사각형 공간). */
export type WallDrawingMode = 'line' | 'rectangle';

/**
 * hover 위치가 어떤 매칭 상태인지 — 사용자에게 시각 피드백을 주기 위해 마커 색/크기를 분기.
 * - `free`: 자유 위치 (어떤 매칭도 안 됨) — 작은 노란 마커
 * - `node`: 기존 노드 흡수됨 — 큰 녹색 마커 (폐쇄 가능)
 * - `wall`: 기존 벽 선분 위 점 (클릭 시 벽이 분할됨) — 보라색 마커
 */
export type PreviewHoverType = 'free' | 'node' | 'wall';

/**
 * 벽/공간 그리기 도구의 UI 상태.
 *
 * Toolbar의 "벽 그리기"/"공간 그리기" 버튼으로 `enabled`/`mode`가 설정되면 `WallDrawingTool`이
 * r3f Canvas의 포인터 이벤트를 가로채 mode에 따라 다음을 수행한다:
 *
 * - **line**: 클릭 → 점 → 클릭 → 점 → ... 체인으로 벽을 잇기 (ESC/더블클릭으로 종료)
 * - **rectangle**: 드래그 시작점 → 마우스 이동(미리보기) → 드래그 끝점에서 4벽+바닥을 한 번에 생성.
 *   Shift 누르면 정사각형으로 강제.
 */
export interface WallDrawingState {
  enabled: boolean;
  mode: WallDrawingMode;

  // ===== line 모드 ===========================================
  /** 현재 그리고 있는 벽의 시작 노드. null이면 첫 클릭 대기 중. */
  startNode: Node | null;
  /** 마우스 hover 월드 좌표(XZ 평면) — 스냅 적용된 *최종* 좌표. 미리보기 라인 표시용. */
  previewEnd: Vector3 | null;
  /** hover가 어떤 매칭(자유/노드/벽)인지 — 시각 피드백용. */
  previewHoverType: PreviewHoverType;
  /** 정렬 점선 가이드 라인 목록. */
  guideLines: GuideLine[];

  // ===== rectangle 모드 ======================================
  /** 드래그 시작점 (월드 XZ). null이면 드래그 시작 전. */
  rectStart: Vector3 | null;
  /** 드래그 현재점 (월드 XZ). Shift 누르면 정사각형으로 보정된 값. */
  rectEnd: Vector3 | null;

  // ===== Setters =============================================
  /** 그리기 모드 켜기 + mode 설정. mode 미지정 시 'line'. */
  enable: (mode?: WallDrawingMode) => void;
  /** 그리기 모드 끄기 + 진행 중 상태 초기화. */
  disable: () => void;
  setStartNode: (n: Node | null) => void;
  setPreviewEnd: (v: Vector3 | null) => void;
  setPreviewHoverType: (t: PreviewHoverType) => void;
  setGuideLines: (lines: GuideLine[]) => void;
  setRectStart: (v: Vector3 | null) => void;
  setRectEnd: (v: Vector3 | null) => void;
}

/** dev 모드 진단용으로 store를 window에 노출. */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__wallDrawingStore = useWallDrawingStore; }, 0);
}

export const useWallDrawingStore = create<WallDrawingState>((set) => ({
  enabled: false,
  mode: 'line',
  startNode: null,
  previewEnd: null,
  previewHoverType: 'free',
  guideLines: [],
  rectStart: null,
  rectEnd: null,
  enable: (mode = 'line') =>
    set({
      enabled: true,
      mode,
      startNode: null,
      previewEnd: null,
      previewHoverType: 'free',
      guideLines: [],
      rectStart: null,
      rectEnd: null,
    }),
  disable: () =>
    set({
      enabled: false,
      startNode: null,
      previewEnd: null,
      previewHoverType: 'free',
      guideLines: [],
      rectStart: null,
      rectEnd: null,
    }),
  setStartNode: (n) => set({ startNode: n }),
  setPreviewEnd: (v) => set({ previewEnd: v }),
  setPreviewHoverType: (t) => set({ previewHoverType: t }),
  setGuideLines: (lines) => set({ guideLines: lines }),
  setRectStart: (v) => set({ rectStart: v }),
  setRectEnd: (v) => set({ rectEnd: v }),
}));