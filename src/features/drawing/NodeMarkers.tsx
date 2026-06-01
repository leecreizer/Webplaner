import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { useWallDrawingStore } from '@/features/drawing/wallDrawingStore';
import { useSelectionStore } from '@/features/selection/selectionStore';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { Space } from '@/domain/structures/Space';
import { alignSnap, type DragGuide } from '@/features/drawing/snapHelpers';
import { DragGuideLines } from '@/features/drawing/DragGuideLines';

/** 클릭 vs 드래그 구분 임계값 (CSS px). 이 거리 이내 mouseup이면 클릭으로 간주. */
const CLICK_VS_DRAG_PX = 5;

/** 드래그 종료 시 *다른 노드*와 자동 결합되는 거리(m). 이 안이면 merge. */
const NODE_MERGE_DIST = 0.5;

/** 드래그 종료 시 *기존 벽 선분 위*에 떨어진 것으로 판정하는 수직 거리(m). 이 안이면 wall 분할. */
const NODE_ON_WALL_EPS = 0.2;

/**
 * 모든 노드(꼭지점)에 시각 마커 + 드래그 이동 + 클릭 선택 + 삭제 버튼.
 *
 * - 그리기 모드 비활성 시에만 인터랙티브
 * - 클릭(`CLICK_VS_DRAG_PX` 미만 움직임): 선택 토글 → 위쪽에 ✕ 삭제 버튼 표시
 * - 드래그: 좌표 이동 + spaces 재빌드
 * - Del/Backspace 키: 선택된 노드 삭제
 *
 * 색상: 일반 노랑 / hover 주황 / 선택 파랑 / 드래그 빨강
 */
export function NodeMarkers() {
  const show = useViewStore((s) => s.showNodeMarkers);
  const size = useViewStore((s) => s.nodeMarkerSize);
  const viewMode = useViewStore((s) => s.viewMode);
  const nodes = useLayoutStore((s) => s.nodes);
  const drawingEnabled = useWallDrawingStore((s) => s.enabled);
  const selectedNode = useSelectionStore((s) => s.selectedNode);
  const { gl, camera } = useThree();
  const is2D = viewMode === '2D';

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragGuides, setDragGuides] = useState<DragGuide[]>([]);

  // Del/Backspace 키로 선택된 노드 삭제
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Delete' && e.code !== 'Backspace') return;
      const sel = useSelectionStore.getState().selectedNode;
      if (!sel) return;
      deleteNode(sel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 2D 모드 + showNodeMarkers 일 때만 표시. 3D는 노드 마커 자체를 안 그림 — 카메라 회전과 충돌 방지.
  if (!show || !is2D) return null;

  const startInteraction = (n: Node) => (e: ThreeEvent<PointerEvent>) => {
    if (drawingEnabled) return;
    // 좌클릭(button=0)만 선택/드래그 — 우클릭/가운데 버튼은 카메라 조작에 양보
    if (e.button !== 0) return;
    e.stopPropagation();
    const downX = e.clientX;
    const downY = e.clientY;
    let didDrag = false;

    const canvas = gl.domElement;
    const raycaster = new Raycaster();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const screenToWorld = (cx: number, cy: number): Vector3 | null => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((cx - rect.left) / rect.width) * 2 - 1,
        -(((cy - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = new Vector3();
      return raycaster.ray.intersectPlane(ground, hit) ? hit : null;
    };

    const onMove = (me: PointerEvent) => {
      const dist = Math.hypot(me.clientX - downX, me.clientY - downY);
      if (!didDrag && dist >= CLICK_VS_DRAG_PX) {
        didDrag = true;
        setDraggedIndex(n.nodeIndex);
        canvas.style.cursor = 'grabbing';
      }
      if (!didDrag) return;
      const hit = screenToWorld(me.clientX, me.clientY);
      if (!hit) return;
      // X/Z 정렬 스냅 — 자기 자신은 비교 제외. 좌표 보정 + 가이드 라인 반환
      const { position: snapped, guides } = alignSnap(hit, new Set([n]));
      n.position.set(snapped.x, 0, snapped.z);
      setDragGuides(guides);
      for (const w of n.walls) w.updateWallFace();
      useLayoutStore.setState((s) => ({ walls: [...s.walls], nodes: [...s.nodes] }));
      for (const sp of useLayoutStore.getState().spaces) {
        sp.invalidateCornerPoints();
        void sp.cornerPoints;
        sp.updateCenter();
        sp.updateArea();
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (didDrag) {
        // 드래그 종료 — 결합 검사 후 spaces 재빌드
        // 1) 다른 노드와 NODE_MERGE_DIST 안이면 그 노드로 합치기
        const others = useLayoutStore.getState().nodes.filter((x) => x !== n);
        let mergedInto: Node | null = null;
        for (const other of others) {
          const dx = n.position.x - other.position.x;
          const dz = n.position.z - other.position.z;
          if (dx * dx + dz * dz < NODE_MERGE_DIST * NODE_MERGE_DIST) {
            mergeNodes(n, other);
            mergedInto = other;
            break;
          }
        }
        // 2) 합쳐지지 않았다면, n이 기존 벽 선분 위에 떨어졌는지 확인 → 그 벽을 분할 (n이 합류점)
        if (!mergedInto) {
          for (const w of [...useLayoutStore.getState().walls]) {
            const s = w.startNode;
            const e = w.endNode;
            if (!s || !e || s === n || e === n) continue;
            if (!pointOnSegmentXZ(n.position, s.position, e.position, NODE_ON_WALL_EPS)) continue;
            // 벽 위 점 — 그 벽을 n으로 분할
            const ABx = e.position.x - s.position.x;
            const ABz = e.position.z - s.position.z;
            const t =
              ((n.position.x - s.position.x) * ABx + (n.position.z - s.position.z) * ABz) /
              (ABx * ABx + ABz * ABz);
            // 정확히 선분 위로 사영
            n.position.set(s.position.x + t * ABx, 0, s.position.z + t * ABz);
            // splitWallAt 인라인 — Wall.delete 없이 endNode 교체 + 새 wall 추가
            const thick = w.wallThick;
            const virtual = w.isVirtual;
            w.endNode = n;
            const w2 = Wall.create(n, e, layoutRegistry, virtual);
            w2.wallThick = thick;
            w.updateWallFace();
            w2.updateWallFace();
            break;
          }
        }

        // spaces 재빌드
        const existing = [...useLayoutStore.getState().spaces];
        for (const sp of existing) Space.delete(sp, layoutRegistry);
        buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
        useLayoutStore.setState((s) => ({
          walls: [...s.walls],
          nodes: [...s.nodes],
          spaces: [...s.spaces],
        }));
        for (const sp of useLayoutStore.getState().spaces) {
          sp.invalidateCornerPoints();
          void sp.cornerPoints;
          sp.updateCenter();
          sp.updateArea();
        }
        setDraggedIndex(null);
        setDragGuides([]);
        canvas.style.cursor = '';
      } else {
        // 클릭 — 선택 토글
        const cur = useSelectionStore.getState().selectedNode;
        useSelectionStore.getState().selectNode(cur === n ? null : n);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <group>
      <DragGuideLines guides={dragGuides} />
      {nodes.map((n) => {
        const isDragged = draggedIndex === n.nodeIndex;
        const isHovered = hoveredIndex === n.nodeIndex;
        const isSelected = selectedNode === n;
        const color = isDragged
          ? '#f44336'
          : isSelected
            ? '#2196f3'
            : isHovered
              ? '#ff9800'
              : '#ffeb3b';
        const r = isDragged || isSelected ? size * 2 : isHovered ? size * 1.5 : size;
        return (
          <group key={n.nodeIndex}>
            <mesh
              position={[n.position.x, 0.03, n.position.z]}
              onPointerDown={startInteraction(n)}
              onPointerOver={(e) => {
                if (drawingEnabled) return;
                e.stopPropagation();
                setHoveredIndex(n.nodeIndex);
                if (draggedIndex === null) gl.domElement.style.cursor = 'grab';
              }}
              onPointerOut={() => {
                setHoveredIndex((idx) => (idx === n.nodeIndex ? null : idx));
                if (draggedIndex === null) gl.domElement.style.cursor = '';
              }}
            >
              <sphereGeometry args={[r, 16, 16]} />
              <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
            </mesh>
            {isSelected && (
              <Html
                position={[n.position.x, 0.05, n.position.z]}
                center
                zIndexRange={[100, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {/* 노드의 화면 투영 위치 기준 *위쪽 13px* (이전 40px의 약 1/3)에 버튼 배치 —
                    3D 회전과 무관하게 항상 같은 화면 거리 유지 */}
                <div style={{ transform: 'translate(-50%, calc(-100% - 13px))', pointerEvents: 'auto' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNode(n);
                    }}
                    title="삭제 (Del)"
                    style={deleteBtnStyle}
                  >
                    ✕ 삭제
                  </button>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** 점 P가 선분 (A,B) 위에 수직 거리 `eps` 이내로 있는지 — 양 끝점 제외(t in (0.02, 0.98)). */
function pointOnSegmentXZ(P: Vector3, A: Vector3, B: Vector3, eps: number): boolean {
  const ABx = B.x - A.x;
  const ABz = B.z - A.z;
  const lenSq = ABx * ABx + ABz * ABz;
  if (lenSq < 1e-8) return false;
  const t = ((P.x - A.x) * ABx + (P.z - A.z) * ABz) / lenSq;
  if (t <= 0.02 || t >= 0.98) return false;
  const projX = A.x + t * ABx;
  const projZ = A.z + t * ABz;
  const dx = P.x - projX;
  const dz = P.z - projZ;
  return dx * dx + dz * dz < eps * eps;
}

/**
 * `from` 노드를 `into` 노드로 병합 — from의 모든 wall에서 from을 into로 교체.
 * 두 노드가 같은 wall로 직접 연결된 경우 그 wall은 self-loop이 되니 삭제.
 * 또 같은 (into, x) 쌍의 wall이 이미 있으면 중복 wall도 정리.
 */
function mergeNodes(from: Node, into: Node): void {
  if (from === into) return;
  const walls = [...from.walls];
  for (const w of walls) {
    if (
      (w.startNode === from && w.endNode === into) ||
      (w.endNode === from && w.startNode === into)
    ) {
      // self-loop wall → 삭제
      Wall.delete(w, layoutRegistry);
      continue;
    }
    // from → into 교체
    if (w.startNode === from) w.startNode = into;
    else if (w.endNode === from) w.endNode = into;
  }
  // 중복 wall 제거 — into에서 출발하는 wall들 중 같은 상대 노드를 가진 쌍이 있으면 한쪽만 유지
  const seen = new Set<Node>();
  for (const w of [...into.walls]) {
    const other = w.startNode === into ? w.endNode : w.startNode;
    if (!other) continue;
    if (seen.has(other)) {
      Wall.delete(w, layoutRegistry);
    } else {
      seen.add(other);
    }
  }
  // from을 layoutStore에서 제거
  if (useLayoutStore.getState().nodes.includes(from)) {
    useLayoutStore.getState().removeNode(from);
  }
  // 갱신된 wall들 face 재계산
  for (const w of into.walls) w.updateWallFace();
}

/**
 * 노드 삭제 — 연결된 모든 wall도 함께 제거되며, 그 wall에 속한 spaces도 정리.
 * 삭제 후 spaces 재빌드.
 */
function deleteNode(n: Node): void {
  // 연결된 wall들 사본 (반복 중 walls 배열 변경 방지)
  const walls = [...n.walls];
  for (const w of walls) {
    Wall.delete(w, layoutRegistry);
  }
  // 노드 자체가 아직 layoutStore에 남아있으면 (모든 wall이 살아 있던 노드였다면) 제거
  if (useLayoutStore.getState().nodes.includes(n)) {
    useLayoutStore.getState().removeNode(n);
  }
  useSelectionStore.getState().clear();
  // spaces 재빌드
  const existing = [...useLayoutStore.getState().spaces];
  for (const sp of existing) Space.delete(sp, layoutRegistry);
  buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
  useLayoutStore.setState((s) => ({
    walls: [...s.walls],
    nodes: [...s.nodes],
    spaces: [...s.spaces],
  }));
  for (const sp of useLayoutStore.getState().spaces) {
    sp.invalidateCornerPoints();
    void sp.cornerPoints;
    sp.updateCenter();
    sp.updateArea();
  }
}

const deleteBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: '#f44336',
  color: '#fff',
  border: '1px solid #c62828',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
};