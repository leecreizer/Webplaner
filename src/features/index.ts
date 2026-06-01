/**
 * Features 레이어 공공 API — 사용자 인터랙션(그리기/편집/선택/씬뷰/되돌리기).
 *
 * 의존: Engine + Domain. UI에서 사용 가능, 다른 features끼리 cross-import 가능.
 */

// Scene rendering (도메인 ↔ Three.js 메쉬)
export { PlanScene } from './scene/PlanScene';
export { WallView } from './scene/WallView';
export { FloorView } from './scene/FloorView';
export { CeilingView } from './scene/CeilingView';
export { ProductView } from './scene/ProductView';
export { SunGizmo } from './scene/SunGizmo';

// Drawing tool (벽 그리기)
export { WallDrawingTool } from './drawing/WallDrawingTool';
export { NodeMarkers } from './drawing/NodeMarkers';
export { DragGuideLines } from './drawing/DragGuideLines';
export * from './drawing/snapHelpers';
export { useWallDrawingStore } from './drawing/wallDrawingStore';

// Editing (CSG 기반 벽/바닥/천장 cut/extrude)
export { EditTool } from './editing/EditTool';
export { EditOverlay } from './editing/EditOverlay';
export { useEditStore } from './editing/editStore';

// Selection
export { useSelectionStore } from './selection/selectionStore';

// Undo/Redo
export { UndoRedoManager } from './undoredo/UndoRedoManager';
export type { ICommand } from './undoredo/ICommand';
