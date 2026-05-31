import { Vector3 } from 'three';
import type { Node } from '../structures/Node';
import { useLayoutStore } from '../structures/state';

/** 가이드 라인 정렬 임계값(m). 이 안에 들어오면 정렬로 본다. */
export const DRAG_ALIGN_EPS = 0.15;

/** 가이드 라인 양쪽 확장 길이(m). */
export const DRAG_GUIDE_EXTEND = 50;

/** 드래그 이동 시 표시할 가이드 라인. */
export interface DragGuide {
  from: Vector3;
  to: Vector3;
  /** 'x' = 수직 라인(같은 x 좌표) / 'z' = 수평 라인(같은 z 좌표) */
  axis: 'x' | 'z';
}

/**
 * 좌표 P를 *다른 노드들*과의 X 또는 Z 정렬에 맞춰 보정하고, 정렬 가이드라인을 반환.
 *
 * - `excludeNodes`: 정렬 검사에서 제외할 노드들 (자기 자신 또는 함께 이동 중인 노드)
 * - 매칭된 정렬에 대해서는 *좌표를 강제 보정*해 정확히 일직선 위로 끌어당김
 *
 * 가이드는 보정된 좌표 기준으로 정렬 노드 → 보정 위치를 양쪽 `DRAG_GUIDE_EXTEND`m로 확장.
 */
export function alignSnap(
  P: Vector3,
  excludeNodes: Set<Node>,
): { position: Vector3; guides: DragGuide[] } {
  const result = P.clone();
  const guides: DragGuide[] = [];
  let xAligned: Vector3 | null = null;
  let zAligned: Vector3 | null = null;

  for (const n of useLayoutStore.getState().nodes) {
    if (excludeNodes.has(n)) continue;
    if (!xAligned && Math.abs(n.position.x - result.x) < DRAG_ALIGN_EPS) xAligned = n.position;
    if (!zAligned && Math.abs(n.position.z - result.z) < DRAG_ALIGN_EPS) zAligned = n.position;
    if (xAligned && zAligned) break;
  }

  if (xAligned) {
    result.x = xAligned.x;
    const minZ = Math.min(xAligned.z, result.z) - DRAG_GUIDE_EXTEND;
    const maxZ = Math.max(xAligned.z, result.z) + DRAG_GUIDE_EXTEND;
    guides.push({
      from: new Vector3(result.x, 0, minZ),
      to: new Vector3(result.x, 0, maxZ),
      axis: 'x',
    });
  }
  if (zAligned) {
    result.z = zAligned.z;
    const minX = Math.min(zAligned.x, result.x) - DRAG_GUIDE_EXTEND;
    const maxX = Math.max(zAligned.x, result.x) + DRAG_GUIDE_EXTEND;
    guides.push({
      from: new Vector3(minX, 0, result.z),
      to: new Vector3(maxX, 0, result.z),
      axis: 'z',
    });
  }

  return { position: result, guides };
}
