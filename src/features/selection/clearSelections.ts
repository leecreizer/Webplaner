import { useSelectionStore } from './selectionStore';
import { useMeshSelectionStore } from './meshSelectionStore';

/**
 * 교차 선택 해제 — 한 종류를 선택하면 나머지 종류의 선택을 모두 지운다.
 * (벽을 선택한 채 모델을 선택해도 벽 하이라이트가 남던 문제의 공용 해법.)
 *
 * 순환 의존을 피하려고 모델/상품/모듈 store 는 동적 import 로 접근한다.
 */
export type SelectionKind = 'wall' | 'mesh' | 'model' | 'product' | 'module';

export function clearOtherSelections(keep: SelectionKind): void {
  if (keep !== 'wall') useSelectionStore.getState().clear();
  if (keep !== 'mesh') useMeshSelectionStore.getState().selectMesh(null);
  if (keep !== 'model') {
    void import('@/features/models/importedModelStore').then(({ useImportedModelStore }) =>
      useImportedModelStore.getState().select(null));
  }
  if (keep !== 'product') {
    void import('@/features/placement/placedProductStore').then(({ usePlacedProductStore }) => {
      const st = usePlacedProductStore.getState();
      if (st.selectedIds.length > 0) {
        st.select(null);
        window.parent?.postMessage({ type: 'hp3:deselected' }, '*');
      }
    });
  }
  if (keep !== 'module') {
    void import('@/features/spaceModules/spaceModuleStore').then(({ useSpaceModuleStore }) =>
      useSpaceModuleStore.getState().select(null));
  }
}