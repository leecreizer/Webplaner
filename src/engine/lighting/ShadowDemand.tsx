import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { useCustomLightStore } from '@/engine/stores/customLightStore';
import { useLayoutStore } from '@/domain/state/layoutStore';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';
import { useImportedModelStore } from '@/features/models/importedModelStore';

/**
 * 섀도맵 demand 렌더링 — three.js 는 기본으로 **매 프레임** 씬 전체를 섀도맵에 다시 그린다
 * (ultra 8192² 이면 이 비용이 프레임 예산을 다 먹어 드래그가 끊김). 여기서
 * `shadowMap.autoUpdate=false` 로 끄고, 그림자에 영향을 주는 변화가 있을 때만 1회 갱신한다.
 *
 * 갱신 트리거:
 * - 배치상품/불러온모델/조명/커스텀라이트/도면(벽) store 변경 (드래그 이동 포함)
 * - 도어·서랍 애니메이션 프레임 (ProductPlacement useFrame 이 requestShadowUpdate 호출)
 * - 카메라 이동은 불필요 (directional 섀도 카메라는 씬 고정)
 */
let dirty = true;

/** 그림자에 영향 주는 변형을 일으킨 쪽에서 호출 — 다음 프레임에 섀도맵 1회 재렌더. */
export function requestShadowUpdate(): void {
  dirty = true;
}

export function ShadowDemand() {
  const { gl } = useThree();

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    dirty = true;
    const subs = [
      useLightingStore.subscribe(requestShadowUpdate),
      useCustomLightStore.subscribe(requestShadowUpdate),
      useLayoutStore.subscribe(requestShadowUpdate),
      usePlacedProductStore.subscribe(requestShadowUpdate),
      useImportedModelStore.subscribe(requestShadowUpdate),
    ];
    return () => {
      gl.shadowMap.autoUpdate = true; // unmount 시 three 기본 동작 복원
      for (const u of subs) u();
    };
  }, [gl]);

  // 렌더 직전에 dirty 플래그를 소비 — needsUpdate 는 1회 렌더 후 three 가 자동 리셋.
  useFrame(() => {
    if (dirty) {
      gl.shadowMap.needsUpdate = true;
      dirty = false;
    }
  });

  return null;
}
