import { useSelectionStore } from './selectionStore';
import { useMeshSelectionStore } from './meshSelectionStore';
import { clearOtherSelections, registerSelectionKind } from './clearSelections';
import { useImportedModelStore } from '@/features/models/importedModelStore';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { useHomvueStore } from '@/features/homvue/homvueStore';
import { useCustomLightStore } from '@/engine/stores/customLightStore';
import { useLightingStore } from '@/engine/stores/lightingStore';

/**
 * 선택은 한 종류만 — 어느 입구(캔버스 클릭·씬 트리·패널·단축키)로 고르든 저장소에 선택이 생기면 다른 종류를 지운다.
 * 입구마다 clearOtherSelections 를 부르면 빠지는 곳이 생겨(천장 클릭·씬 트리·Homvue·조명) 저장소를 직접 지켜본다.
 * - 벽은 벽 저장소(selectedWall)와 메시 저장소(벽 메시 키)를 함께 쓰므로 둘은 서로 지우지 않는다
 * App 에서 한 번 import 한다.
 */

const isWallKey = (k: string) => k.startsWith('wall-');

registerSelectionKind('wall', () => useSelectionStore.getState().clear());
registerSelectionKind('mesh', () => useMeshSelectionStore.getState().selectMesh(null));
registerSelectionKind('model', () => useImportedModelStore.getState().select(null));
registerSelectionKind('product', () => {
  const st = usePlacedProductStore.getState();
  if (st.selectedIds.length === 0) return;
  st.select(null);
  window.parent?.postMessage({ type: 'hp3:deselected' }, '*');
});
registerSelectionKind('module', () => {
  const st = useSpaceModuleStore.getState();
  if (st.selectedId !== null) st.select(null);
  if (st.selectedOpening) st.selectOpening(null);
});
registerSelectionKind('homvue', () => useHomvueStore.getState().select(null));
registerSelectionKind('light', () => useCustomLightStore.getState().select(null));
registerSelectionKind('builtin', () => useLightingStore.getState().setSelectedBuiltin(null));

useSelectionStore.subscribe((s, p) => {
  if (s.selectedWall && s.selectedWall !== p.selectedWall) clearOtherSelections(['wall', 'mesh']);
});
useMeshSelectionStore.subscribe((s, p) => {
  const keys = s.selectedMeshKeys;
  if (!keys.length || keys === p.selectedMeshKeys) return;
  // 벽 메시만 고른 것이면 벽 선택은 둔다(같은 벽)
  clearOtherSelections(keys.every(isWallKey) ? ['mesh', 'wall'] : 'mesh');
});
useImportedModelStore.subscribe((s, p) => {
  if (s.selectedId && s.selectedId !== p.selectedId) clearOtherSelections('model');
});
usePlacedProductStore.subscribe((s, p) => {
  if (s.selectedIds.length && s.selectedIds !== p.selectedIds) clearOtherSelections('product');
});
useSpaceModuleStore.subscribe((s, p) => {
  const picked = (s.selectedId && s.selectedId !== p.selectedId) || (s.selectedOpening && s.selectedOpening !== p.selectedOpening);
  if (picked) clearOtherSelections('module');
});
useHomvueStore.subscribe((s, p) => {
  if (s.selected && s.selected !== p.selected) clearOtherSelections('homvue');
});
useCustomLightStore.subscribe((s, p) => {
  if (s.selectedId && s.selectedId !== p.selectedId) clearOtherSelections('light');
});
useLightingStore.subscribe((s, p) => {
  if (s.selectedBuiltin && s.selectedBuiltin !== p.selectedBuiltin) clearOtherSelections('builtin');
});
