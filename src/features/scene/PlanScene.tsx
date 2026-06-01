import { Suspense } from 'react';
import { useLayoutStore } from '@/domain/state/layoutStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { WallView } from './WallView';
import { FloorView } from './FloorView';
import { CeilingView } from './CeilingView';
import { ProductView } from './ProductView';

/**
 * 평면도 전체를 r3f 씬으로 렌더링하는 오케스트레이터.
 *
 * Zustand 스토어를 구독해 Wall/Space/Product 변화에 자동 반응한다.
 *
 * ### 사용
 * `App.tsx`의 `<Canvas>` 내부에 배치한다:
 * ```tsx
 * <Canvas>
 *   <ambientLight ... />
 *   <PlanScene showCeiling={false} />
 * </Canvas>
 * ```
 */
export function PlanScene({
  showCeiling = true,
  showProducts = true,
}: {
  /** 천장 메시 표시 여부 (3D에서만 — 2D 탑뷰에서는 floor를 가리므로 자동 숨김). */
  showCeiling?: boolean;
  /** Product GLB 인스턴스 렌더링 여부. */
  showProducts?: boolean;
}) {
  const walls = useLayoutStore((s) => s.walls);
  const spaces = useLayoutStore((s) => s.spaces);
  const viewMode = useViewStore((s) => s.viewMode);
  // 2D 탑뷰는 위에서 내려다 보므로 ceiling이 floor를 가림 → 자동 숨김
  const ceilingVisible = showCeiling && viewMode === '3D';

  return (
    <group>
      {/* 벽 — key는 startNode/endNode 좌표 기반 hash. wallIndex가 split/merge 시 새 번호로
          발급되어, 같은 위치의 wall도 unmount → remount되며 검은 깜빡임을 유발할 수 있어 좌표 hash로
          reconcile 재사용 보장. */}
      {walls.map((wall) => {
        const s = wall.startNode?.position;
        const e = wall.endNode?.position;
        const key =
          s && e
            ? `${s.x.toFixed(2)},${s.z.toFixed(2)}-${e.x.toFixed(2)},${e.z.toFixed(2)}`
            : `w-${wall.wallIndex}`;
        return <WallView key={key} wall={wall} />;
      })}

      {/* 바닥 + (선택) 천장 — key는 cornerPoints 기반 hash로. recomputeSpaces가 spaces를 매번
          delete + recreate하면서 spaceIndex가 새 번호로 발급되어, spaceIndex를 key로 쓰면 React가
          모든 floor/ceiling을 unmount → remount해 한 프레임 비어 검은 깜빡임이 발생했다.
          cornerPoints hash로 두면 같은 위치의 공간은 reconcile 재사용되어 깜빡임 없음. */}
      {spaces.map((space) => {
        const key = space.cornerPoints
          .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(';') || `idx-${space.spaceIndex}`;
        return (
          <group key={key}>
            <FloorView space={space} />
            {ceilingVisible && <CeilingView space={space} />}
          </group>
        );
      })}

      {/* 가구·문/창호 — GLB 로드가 비동기이므로 단일 Suspense로 묶음 */}
      {showProducts && (
        <Suspense fallback={null}>
          {spaces.map((space) =>
            space.allProducts.map((product, idx) => (
              <ProductView key={`${space.spaceIndex}-${idx}`} product={product} />
            )),
          )}
        </Suspense>
      )}
    </group>
  );
}