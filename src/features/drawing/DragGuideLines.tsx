import { Line } from '@react-three/drei';
import type { DragGuide } from '@/features/drawing/snapHelpers';
import { useViewStore } from '@/engine/stores/viewStore';

/**
 * 드래그 이동 중 표시되는 X/Z 정렬 가이드 라인 — 그리기 모드의 가이드와 시각 일관성 유지.
 * - X 정렬: 파랑 점선 (수직)
 * - Z 정렬: 초록 점선 (수평)
 *
 * 양쪽으로 50m 확장된 점선이 화면 끝까지 닿는다.
 */
export function DragGuideLines({ guides }: { guides: DragGuide[] }) {
  const drawingLineWidth = useViewStore((s) => s.drawingLineWidth);
  if (guides.length === 0) return null;
  return (
    <group>
      {guides.map((g, i) => (
        <Line
          key={i}
          points={[
            [g.from.x, 0.015, g.from.z],
            [g.to.x, 0.015, g.to.z],
          ]}
          color={g.axis === 'x' ? '#1d4ed8' : '#15803d'}
          dashed
          dashSize={0.3}
          gapSize={0.15}
          lineWidth={Math.max(2, drawingLineWidth * 1.2)}
          depthTest={false}
          transparent
          opacity={0.95}
        />
      ))}
    </group>
  );
}