/**
 * v1에서는 cut/extrude box를 overlay mesh로 표시했지만, v2는 WallView/FloorView/CeilingView가
 * editStore.operations를 직접 구독해 CSG로 원본 geometry에 반영하므로 별도 overlay 불필요.
 *
 * 진단이 필요할 때만 EditTool의 `useEditOverlays()`를 다시 활용해 box 위치를 그리도록 확장.
 */
export function EditOverlay() {
  return null;
}