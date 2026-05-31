import { create } from 'zustand';

/** 화면 모드 — 2D는 탑뷰 Orthographic (회전 불가), 3D는 자유 Perspective. */
export type ViewMode = '2D' | '3D';

/**
 * 뷰 설정 (화면 모드 + 그리기 옵션 + 그리드 외관) 통합 스토어.
 */
export interface ViewState {
  viewMode: ViewMode;

  // ===== 그리기 옵션 =========================================
  /** 다음에 그릴 벽의 두께(m). */
  wallThickPreview: number;
  /** 모든 노드(꼭지점)에 마커 표시. */
  showNodeMarkers: boolean;
  /** 노드 마커 크기(m). */
  nodeMarkerSize: number;
  /** 그리기 미리보기 라인 두께(px). drei `<Line lineWidth>`. */
  drawingLineWidth: number;

  // ===== 그리드 외관 =========================================
  showGrid: boolean;
  gridCellColor: string;
  gridSectionColor: string;
  /** 0(완전 투명) ~ 1(완전 불투명). */
  gridOpacity: number;

  // ===== 씬 배경 =============================================
  /** Canvas clear color — `<color attach="background">` 에 바인딩. */
  sceneBackgroundColor: string;

  // ===== Setters =============================================
  setViewMode: (v: ViewMode) => void;
  setWallThickPreview: (v: number) => void;
  setShowNodeMarkers: (v: boolean) => void;
  setNodeMarkerSize: (v: number) => void;
  setDrawingLineWidth: (v: number) => void;
  setShowGrid: (v: boolean) => void;
  setGridCellColor: (v: string) => void;
  setGridSectionColor: (v: string) => void;
  setGridOpacity: (v: number) => void;
  setSceneBackgroundColor: (v: string) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  viewMode: '3D',
  wallThickPreview: 0.2,
  showNodeMarkers: true,
  nodeMarkerSize: 0.1,
  drawingLineWidth: 2,

  showGrid: true,
  gridCellColor: '#444444',
  gridSectionColor: '#888888',
  gridOpacity: 1.0,

  sceneBackgroundColor: '#1a1a1a',

  setViewMode: (v) => set({ viewMode: v }),
  setWallThickPreview: (v) => set({ wallThickPreview: v }),
  setShowNodeMarkers: (v) => set({ showNodeMarkers: v }),
  setNodeMarkerSize: (v) => set({ nodeMarkerSize: v }),
  setDrawingLineWidth: (v) => set({ drawingLineWidth: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setGridCellColor: (v) => set({ gridCellColor: v }),
  setGridSectionColor: (v) => set({ gridSectionColor: v }),
  setGridOpacity: (v) => set({ gridOpacity: v }),
  setSceneBackgroundColor: (v) => set({ sceneBackgroundColor: v }),
}));