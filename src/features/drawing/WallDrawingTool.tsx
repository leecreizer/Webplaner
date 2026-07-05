import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Plane, Vector2, Vector3, Raycaster } from 'three';
import { Line } from '@react-three/drei';
import { useWallDrawingStore, type GuideLine, type PreviewHoverType } from '@/features/drawing/wallDrawingStore';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { Node } from '@/domain/structures/Node';
import { Wall } from '@/domain/structures/Wall';
import { Space } from '@/domain/structures/Space';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';

/** 기존 노드 *완전 매칭* 반경(m). 이 안에서 클릭하면 새 노드 대신 기존 노드 재사용.
 *  사용자가 폐쇄점(첫 노드)에 마지막 클릭으로 흡수되기 쉽도록 0.8m로 넉넉히. */
const NODE_SNAP_DISTANCE = 0.8;

/** 각도 스냅 단위(도). 5°로 두면 자동으로 5°/10°/45°/90°에 모두 스냅됨 (모두 5의 배수). */
const ANGLE_SNAP_DEG = 5;

/** X/Z 축 정렬 가이드 검출 임계값(m). 이 안에 들어오면 좌표를 정렬 + 점선 가이드 표시. */
const AXIS_ALIGN_THRESHOLD = 0.18;

/** 정렬 가이드를 정렬축 방향으로 양쪽으로 추가 연장하는 길이(m). 화면 끝까지 닿는 효과. */
const GUIDE_EXTEND = 50;

/** 사각형 공간의 한 변 최소 길이(m) — 너무 작으면 무시 (오인식 드래그). */
const RECT_MIN_SIDE = 0.1;

/** 점이 기존 벽 선분 위에 있다고 판단할 수직 거리(m). 이 안이면 벽을 분할.
 *  사용자가 마우스로 정확히 벽 위를 맞추기 어려우므로 20cm 정도의 넉넉한 흡수 반경을 둔다. */
const POINT_ON_WALL_EPS = 0.2;

/**
 * 사용자가 r3f Canvas 위에 직접 클릭으로 벽을 그리는 도구.
 *
 * ### 모드 (`wallDrawingStore.mode`)
 * - **`line`**: 클릭 체인으로 벽을 잇기. 노드 매칭/정렬 가이드/각도 스냅이 적용된다.
 * - **`rectangle`**: 드래그 시작점 → 끝점 사각형으로 4벽+바닥을 한 번에 생성. Shift 누르면 정사각형.
 *
 * ### 스냅 우선순위 (line 모드, 위에서부터 적용)
 * 1. **기존 노드 매칭** (30cm 이내) — 그 노드에 완전히 흡수
 * 2. **X/Z 축 정렬 가이드** (18cm 이내) — 기존 노드 또는 시작 노드와 X 또는 Z 좌표 정렬 +
 *    점선 표시 (양쪽 50m 연장)
 * 3. **시작점 기준 각도 스냅** (5° 단위) — Shift 누르면 해제
 * 4. 원본 좌표
 *
 * ### 조작 (line 모드)
 * - **좌클릭**: 시작점 / 다음 점 찍기 (체인 그리기)
 * - **ESC / 더블클릭**: 그리기 종료 + 폐쇄 공간 자동 검출
 * - **Shift**: 각도 스냅 일시 해제
 *
 * ### 조작 (rectangle 모드)
 * - **좌클릭 드래그**: 시작점 → 끝점. mouse up 시 4벽 + 바닥 자동 생성.
 * - **Shift**: 정사각형 강제 (가로=세로 = max(|dx|, |dz|), 부호는 드래그 방향 유지).
 * - **ESC**: 취소
 *
 * 벽 생성 직후 `updateWallFace()` + 인접 벽 face 재계산 + store 배열 ref 갱신으로 화면에
 * 즉시 반영된다.
 */
export function WallDrawingTool() {
  const enabled = useWallDrawingStore((s) => s.enabled);
  const mode = useWallDrawingStore((s) => s.mode);
  const startNode = useWallDrawingStore((s) => s.startNode);
  const previewEnd = useWallDrawingStore((s) => s.previewEnd);
  const previewHoverType = useWallDrawingStore((s) => s.previewHoverType);
  const guideLines = useWallDrawingStore((s) => s.guideLines);
  const rectStart = useWallDrawingStore((s) => s.rectStart);
  const rectEnd = useWallDrawingStore((s) => s.rectEnd);
  const drawingLineWidth = useViewStore((s) => s.drawingLineWidth);
  const { gl, camera } = useThree();

  // Shift 키 상태 — useRef로 추적해 이벤트 핸들러 안에서 최신 값 참조
  const shiftPressedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const canvas = gl.domElement;
    const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
    const raycaster = new Raycaster();

    const screenToWorld = (clientX: number, clientY: number): Vector3 | null => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = new Vector3();
      return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
    };

    const findNearestNode = (p: Vector3): Node | null => {
      const snap2 = NODE_SNAP_DISTANCE * NODE_SNAP_DISTANCE;
      for (const n of useLayoutStore.getState().nodes) {
        const dx = n.position.x - p.x;
        const dz = n.position.z - p.z;
        if (dx * dx + dz * dz < snap2) return n;
      }
      return null;
    };

    /**
     * 마우스 좌표 → 최종 목표 위치 + 가이드 라인 (line 모드 전용).
     * 우선순위: 노드 매칭 → **벽 위 점 매칭** → X/Z 정렬 가이드 → 각도 스냅 → 원본.
     */
    const resolveLineTarget = (
      clientX: number,
      clientY: number,
    ): { position: Vector3; existing: Node | null; guides: GuideLine[]; hoverType: PreviewHoverType } | null => {
      const raw = screenToWorld(clientX, clientY);
      if (!raw) return null;

      // 1) 기존 노드 매칭 (최우선)
      const existing = findNearestNode(raw);
      if (existing) {
        return { position: existing.position.clone(), existing, guides: [], hoverType: 'node' };
      }

      const currentStart = useWallDrawingStore.getState().startNode;

      // 1.3) 직진 연장선 매칭 — currentStart에 연결된 기존 wall과 일직선(5° 이내)인 hover면
      //      그 라인 위로 사영하고 양쪽으로 길게 연장된 가이드를 표시. 사용자가 wall을 자연스럽게
      //      이어 그릴 수 있도록 라인이 유지된다. 폐쇄 직후 currentStart가 null이면 스킵.
      if (currentStart) {
        const cosLimit = Math.cos((5 * Math.PI) / 180);
        for (const w of currentStart.walls) {
          const other = w.other(currentStart);
          if (!other) continue;
          const dx = other.position.x - currentStart.position.x;
          const dz = other.position.z - currentStart.position.z;
          const dLen = Math.hypot(dx, dz);
          if (dLen < 1e-4) continue;
          const ndx = dx / dLen;
          const ndz = dz / dLen;
          const hx = raw.x - currentStart.position.x;
          const hz = raw.z - currentStart.position.z;
          const hLen = Math.hypot(hx, hz);
          if (hLen < 0.1) continue; // hover가 currentStart에 너무 가까우면 각도 의미 없음
          const cosA = (ndx * hx + ndz * hz) / hLen;
          if (Math.abs(cosA) < cosLimit) continue; // |각도| > 5° → 직진 아님
          // 같은 라인 위로 사영 (sign 유지 — 직진 또는 반대 방향 그대로)
          const t = ndx * hx + ndz * hz;
          const proj = new Vector3(
            currentStart.position.x + t * ndx,
            raw.y,
            currentStart.position.z + t * ndz,
          );
          // 양쪽으로 50m 연장한 가이드
          const guides: GuideLine[] = [
            {
              from: new Vector3(
                currentStart.position.x - GUIDE_EXTEND * ndx,
                0,
                currentStart.position.z - GUIDE_EXTEND * ndz,
              ),
              to: new Vector3(
                currentStart.position.x + GUIDE_EXTEND * ndx,
                0,
                currentStart.position.z + GUIDE_EXTEND * ndz,
              ),
              axis: 'extension',
            },
          ];
          return { position: proj, existing: null, guides, hoverType: 'wall' };
        }
      }

      // 1.6) 각도 스냅이 *currentStart 있을 때* 점-벽 매칭보다 우선 — 사용자가 기존 노드에서
      // 새 wall을 90°/45° 등으로 그릴 때 wall 매칭이 직각 스냅을 가로채는 문제 방지.
      // (Shift는 각도 해제 — 그때만 점-벽 매칭이 자유롭게 작동)
      if (currentStart && !shiftPressedRef.current) {
        const snapped = snapToAngle(currentStart.position, raw, ANGLE_SNAP_DEG);
        // snap 결과 좌표가 기존 wall 위에 떨어지면 hoverType:'wall' 표시 — 클릭 시 분할
        let hoverType: PreviewHoverType = 'free';
        for (const w of useLayoutStore.getState().walls) {
          const s = w.startNode;
          const e = w.endNode;
          if (!s || !e) continue;
          if (pointOnSegmentXZ(snapped, s.position, e.position, POINT_ON_WALL_EPS)) {
            hoverType = 'wall';
            break;
          }
        }
        // snap 좌표가 기존 다른 노드와 *X 또는 Z 정렬* 임계값 안이면 **좌표를 그 정렬에 강제
        // 보정**해 정확히 일직선 위에 위치하도록. 가이드라인은 보정된 라인을 양쪽으로 확장 표시.
        // 임계값을 0.15m로 두어 사용자가 의도적으로 정렬할 때 잘 잡히고, 그 외 자유 이동은 유지.
        const guides: GuideLine[] = [];
        const ALIGN_EPS = 0.15;
        let xAligned: Vector3 | null = null;
        let zAligned: Vector3 | null = null;
        for (const n of useLayoutStore.getState().nodes) {
          if (n === currentStart) continue;
          if (!xAligned && Math.abs(n.position.x - snapped.x) < ALIGN_EPS) xAligned = n.position;
          if (!zAligned && Math.abs(n.position.z - snapped.z) < ALIGN_EPS) zAligned = n.position;
          if (xAligned && zAligned) break;
        }
        if (xAligned) {
          // 좌표 x를 정렬 노드의 x로 강제 보정 → 정확히 일직선
          snapped.x = xAligned.x;
          const minZ = Math.min(xAligned.z, snapped.z) - GUIDE_EXTEND;
          const maxZ = Math.max(xAligned.z, snapped.z) + GUIDE_EXTEND;
          guides.push({
            from: new Vector3(snapped.x, 0, minZ),
            to: new Vector3(snapped.x, 0, maxZ),
            axis: 'x',
          });
        }
        if (zAligned) {
          snapped.z = zAligned.z;
          const minX = Math.min(zAligned.x, snapped.x) - GUIDE_EXTEND;
          const maxX = Math.max(zAligned.x, snapped.x) + GUIDE_EXTEND;
          guides.push({
            from: new Vector3(minX, 0, snapped.z),
            to: new Vector3(maxX, 0, snapped.z),
            axis: 'z',
          });
        }
        return { position: snapped, existing: null, guides, hoverType };
      }

      // 1.5) 점-벽 매칭 — currentStart 없거나 Shift 누름일 때만 (각도 스냅과 충돌 방지)
      for (const w of useLayoutStore.getState().walls) {
        const s = w.startNode;
        const e = w.endNode;
        if (!s || !e) continue;
        if (!pointOnSegmentXZ(raw, s.position, e.position, POINT_ON_WALL_EPS)) continue;
        const ABx = e.position.x - s.position.x;
        const ABz = e.position.z - s.position.z;
        const t = ((raw.x - s.position.x) * ABx + (raw.z - s.position.z) * ABz) / (ABx * ABx + ABz * ABz);
        const projected = new Vector3(s.position.x + t * ABx, raw.y, s.position.z + t * ABz);
        return { position: projected, existing: null, guides: [], hoverType: 'wall' };
      }

      // 2) X/Z 정렬 가이드 — 현재 시작점 + 모든 기존 노드를 정렬 대상에 포함
      const alignTargets: Vector3[] = [];
      if (currentStart) alignTargets.push(currentStart.position);
      for (const n of useLayoutStore.getState().nodes) {
        if (n !== currentStart) alignTargets.push(n.position);
      }

      let xAlignSource: Vector3 | null = null;
      let zAlignSource: Vector3 | null = null;
      let bestXDist = AXIS_ALIGN_THRESHOLD;
      let bestZDist = AXIS_ALIGN_THRESHOLD;

      for (const p of alignTargets) {
        const dx = Math.abs(p.x - raw.x);
        if (dx < bestXDist) {
          xAlignSource = p;
          bestXDist = dx;
        }
        const dz = Math.abs(p.z - raw.z);
        if (dz < bestZDist) {
          zAlignSource = p;
          bestZDist = dz;
        }
      }

      if (xAlignSource !== null || zAlignSource !== null) {
        const finalX = xAlignSource ? xAlignSource.x : raw.x;
        const finalZ = zAlignSource ? zAlignSource.z : raw.z;
        const finalPos = new Vector3(finalX, raw.y, finalZ);
        const guides: GuideLine[] = [];
        // X 정렬 가이드 — x 고정, z 방향으로 양쪽 50m 확장해 화면 끝까지 닿게
        if (xAlignSource) {
          const minZ = Math.min(xAlignSource.z, finalPos.z) - GUIDE_EXTEND;
          const maxZ = Math.max(xAlignSource.z, finalPos.z) + GUIDE_EXTEND;
          guides.push({
            from: new Vector3(finalX, 0, minZ),
            to: new Vector3(finalX, 0, maxZ),
            axis: 'x',
          });
        }
        // Z 정렬 가이드 — z 고정, x 방향으로 양쪽 확장
        if (zAlignSource) {
          const minX = Math.min(zAlignSource.x, finalPos.x) - GUIDE_EXTEND;
          const maxX = Math.max(zAlignSource.x, finalPos.x) + GUIDE_EXTEND;
          guides.push({
            from: new Vector3(minX, 0, finalZ),
            to: new Vector3(maxX, 0, finalZ),
            axis: 'z',
          });
        }
        return { position: finalPos, existing: null, guides, hoverType: 'free' };
      }

      // 3) 원본 좌표 (각도 스냅은 위 1.6에서 이미 처리)
      return { position: raw, existing: null, guides: [], hoverType: 'free' };
    };

    const refreshFaces = (touched: Set<Wall>) => {
      for (const w of touched) w.updateWallFace();
      useLayoutStore.setState((s) => ({ walls: [...s.walls] }));
    };

    /**
     * 점 P가 선분 (A,B) 위에 수직 거리 `eps` 이내로 있는지 — 양 끝점은 제외(t in (0.02, 0.98)).
     * 끝점 매칭은 `findNearestNode`가 처리하므로 여기서는 *내부*만 본다.
     */
    const pointOnSegmentXZ = (P: Vector3, A: Vector3, B: Vector3, eps: number): boolean => {
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
    };

    /**
     * 두 선분 (p1,p2), (p3,p4)의 XZ 평면 교차점 — 양 끝점에서의 교차는 제외(t in (0.02, 0.98)).
     * 끝점이 공유되는 경우는 노드 매칭이 처리한다.
     */
    const segmentsIntersectXZ = (
      p1: Vector3, p2: Vector3, p3: Vector3, p4: Vector3,
    ): { point: Vector3; t1: number; t2: number } | null => {
      const x1 = p1.x, z1 = p1.z, x2 = p2.x, z2 = p2.z;
      const x3 = p3.x, z3 = p3.z, x4 = p4.x, z4 = p4.z;
      const den = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
      if (Math.abs(den) < 1e-8) return null;
      const t1 = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / den;
      const t2 = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / den;
      if (t1 <= 0.02 || t1 >= 0.98 || t2 <= 0.02 || t2 >= 0.98) return null;
      return {
        point: new Vector3(x1 + t1 * (x2 - x1), 0, z1 + t1 * (z2 - z1)),
        t1,
        t2,
      };
    };

    /**
     * wall을 `splitNode`(선분 내부에 위치한 노드)로 분할.
     *
     * `Wall.delete`를 호출하면 그 wall의 양 끝 노드가 *다른 wall에 연결 안 된 경우* 함께
     * 삭제되어 사용자가 그렸던 꼭지점이 사라지는 문제가 있었다. 대신 기존 wall의 `endNode`만
     * `splitNode`로 갱신해 wall을 축소하고, 새 wall(`splitNode → 원래 endNode`) 하나만 추가한다.
     * setter가 노드의 `walls` 컬렉션을 자동 동기화하므로 노드는 모두 살아남는다.
     */
    const splitWallAt = (wall: Wall, splitNode: Node): void => {
      const s = wall.startNode;
      const e = wall.endNode;
      if (!s || !e || s === splitNode || e === splitNode) return;
      const thick = wall.wallThick;
      const virtual = wall.isVirtual;
      wall.endNode = splitNode; // 기존 wall: s → splitNode 로 축소
      const w2 = Wall.create(splitNode, e, layoutRegistry, virtual);
      w2.wallThick = thick;
      wall.updateWallFace();
      w2.updateWallFace();
    };

    /**
     * 좌표 P를 *생성 없이* 기존 그래프(노드/벽)에 시각적으로 흡수시킨다.
     * - 노드 매칭 → 그 노드 좌표 (hoverType 'node')
     * - 벽 위 점 → 그 벽 선분 위로 사영 (hoverType 'wall')
     * - 그 외 → 원본 좌표 (hoverType 'free')
     *
     * `resolveOrCreateNode`와 달리 노드 생성/분할을 일으키지 않아 hover 프리뷰에 안전.
     */
    const snapPositionToGraph = (
      P: Vector3,
    ): { position: Vector3; hoverType: PreviewHoverType } => {
      const existing = findNearestNode(P);
      if (existing) return { position: existing.position.clone(), hoverType: 'node' };
      for (const w of useLayoutStore.getState().walls) {
        const s = w.startNode;
        const e = w.endNode;
        if (!s || !e) continue;
        if (!pointOnSegmentXZ(P, s.position, e.position, POINT_ON_WALL_EPS)) continue;
        const ABx = e.position.x - s.position.x;
        const ABz = e.position.z - s.position.z;
        const t = ((P.x - s.position.x) * ABx + (P.z - s.position.z) * ABz) / (ABx * ABx + ABz * ABz);
        return {
          position: new Vector3(s.position.x + t * ABx, P.y, s.position.z + t * ABz),
          hoverType: 'wall',
        };
      }
      return { position: P, hoverType: 'free' };
    };

    /**
     * 클릭 위치 P를 노드로 해석:
     * 1) NODE_SNAP_DISTANCE 내 기존 노드 → 그 노드 재사용
     * 2) 기존 벽 선분 위(POINT_ON_WALL_EPS) → 그 벽을 분할하면서 새 노드 생성
     * 3) 그 외 → 새 노드
     */
    const resolveOrCreateNode = (P: Vector3): Node => {
      const existing = findNearestNode(P);
      if (existing) return existing;
      const wallsSnapshot = [...useLayoutStore.getState().walls];
      for (const w of wallsSnapshot) {
        const s = w.startNode;
        const e = w.endNode;
        if (!s || !e) continue;
        if (!pointOnSegmentXZ(P, s.position, e.position, POINT_ON_WALL_EPS)) continue;
        // 점을 선분에 정확히 사영해 벽 위에 정렬
        const ABx = e.position.x - s.position.x;
        const ABz = e.position.z - s.position.z;
        const t = ((P.x - s.position.x) * ABx + (P.z - s.position.z) * ABz) / (ABx * ABx + ABz * ABz);
        const projected = new Vector3(s.position.x + t * ABx, 0, s.position.z + t * ABz);
        const newNode = Node.create(projected, layoutRegistry);
        splitWallAt(w, newNode);
        return newNode;
      }
      return Node.create(P, layoutRegistry);
    };

    /**
     * start→end 선분을 모든 교차 기존 벽과 분할하면서 sub-wall들로 생성.
     * 양 끝점 공유는 무시(이미 노드가 연결됨). 결과 wall들의 wallThick는 `thick`.
     */
    const createWallWithIntersections = (start: Node, end: Node, thick: number): Wall[] => {
      // 이미 두 노드 사이에 직접 wall이 있으면 중복 생성 방지.
      for (const w of useLayoutStore.getState().walls) {
        if (
          (w.startNode === start && w.endNode === end) ||
          (w.startNode === end && w.endNode === start)
        ) {
          return [];
        }
      }

      // start→end 선분 위에 있는 기존 노드/wall을 모두 모아 sub-segments로 쪼갠다.
      // 이렇게 해야 새 변이 *기존 외벽의 sub-walls chain*과 같은 영역에 *중복으로* 만들어지지 않음.
      const intersections: { t: number; node: Node }[] = [];
      const dx = end.position.x - start.position.x;
      const dz = end.position.z - start.position.z;
      const lenSq = dx * dx + dz * dz;
      const paramT = (p: { x: number; z: number }): number =>
        lenSq < 1e-8
          ? 0
          : ((p.x - start.position.x) * dx + (p.z - start.position.z) * dz) / lenSq;

      // (A) 새 선분 위에 있는 기존 노드들 — 그 노드를 분할점에 포함시켜 sub-walls가
      //     기존 sub-walls chain과 정확히 정렬되도록.
      for (const n of useLayoutStore.getState().nodes) {
        if (n === start || n === end) continue;
        if (!pointOnSegmentXZ(n.position, start.position, end.position, POINT_ON_WALL_EPS)) continue;
        intersections.push({ t: paramT(n.position), node: n });
      }

      // (B) 새 선분과 기존 wall의 *내부 교차* — 교차점에 새 노드 생성 + 기존 wall 분할.
      const wallsSnapshot = [...useLayoutStore.getState().walls];
      for (const w of wallsSnapshot) {
        const s = w.startNode;
        const e = w.endNode;
        if (!s || !e) continue;
        if (s === start || s === end || e === start || e === end) continue;
        const hit = segmentsIntersectXZ(start.position, end.position, s.position, e.position);
        if (!hit) continue;
        const newNode = Node.create(hit.point, layoutRegistry);
        splitWallAt(w, newNode);
        intersections.push({ t: hit.t1, node: newNode });
      }

      // t 오름차순 정렬 + 동일 t (중복 노드) 제거
      intersections.sort((a, b) => a.t - b.t);

      // sub-walls 생성. 각 쌍 (prev, current) 사이에 *이미 직접 wall이 있으면 skip*.
      const newWalls: Wall[] = [];
      const allWalls = () => useLayoutStore.getState().walls;
      const hasDirectWall = (a: Node, b: Node): boolean => {
        for (const w of allWalls()) {
          if ((w.startNode === a && w.endNode === b) || (w.startNode === b && w.endNode === a)) {
            return true;
          }
        }
        return false;
      };

      let prev = start;
      for (const x of intersections) {
        if (prev === x.node) continue;
        if (!hasDirectWall(prev, x.node)) {
          const w = Wall.create(prev, x.node, layoutRegistry);
          w.wallThick = thick;
          newWalls.push(w);
        }
        prev = x.node;
      }
      if (prev !== end && !hasDirectWall(prev, end)) {
        const last = Wall.create(prev, end, layoutRegistry);
        last.wallThick = thick;
        newWalls.push(last);
      }
      return newWalls;
    };

    /**
     * 현재 wall 그래프로 SpaceBuilder를 돌리고 spaces를 store에 반영.
     * **그리기 모드는 종료하지 않는다** — 폐쇄가 새로 만들어지면 즉시 floor를 보여주고
     * 사용자가 추가 wall을 더 이어 그릴 수 있도록 한다.
     * 폐쇄가 안 됐으면 SpaceBuilder가 dangling을 제거해 spaces는 그대로 0.
     *
     * 빌드 전에 기존 spaces를 전부 삭제한다. `Space.create`의 "wall이 이미 어떤 space에 속하면
     * 그 space를 갱신" 분기 때문에, 두 번째 폐쇄가 첫 번째 space를 덮어써 하나만 남는 버그가
     * 있었다. 매번 fresh build로 처리하면 모든 face가 새 Space로 생성된다.
     */
    const recomputeSpaces = () => {
      const existing = [...useLayoutStore.getState().spaces];
      for (const sp of existing) Space.delete(sp, layoutRegistry);
      buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
      useLayoutStore.setState((s) => ({ walls: [...s.walls], spaces: [...s.spaces] }));
      for (const space of useLayoutStore.getState().spaces) {
        space.invalidateCornerPoints();
        void space.cornerPoints;
        space.updateCenter();
        space.updateArea();
      }
    };

    /**
     * Rectangle 모드 — 시작점 + 끝점으로 4 노드 + 4 벽 + buildSpaces 일괄 생성.
     * Shift가 눌렸으면 정사각형으로 보정 (max(|dx|, |dz|), 부호는 드래그 방향 유지).
     */
    const finalizeRectangle = (rawStart: Vector3, rawEnd: Vector3, shift: boolean) => {
      const dx = rawEnd.x - rawStart.x;
      const dz = rawEnd.z - rawStart.z;
      let endX = rawEnd.x;
      let endZ = rawEnd.z;
      if (shift) {
        const side = Math.max(Math.abs(dx), Math.abs(dz));
        endX = rawStart.x + Math.sign(dx || 1) * side;
        endZ = rawStart.z + Math.sign(dz || 1) * side;
      }
      if (Math.abs(endX - rawStart.x) < RECT_MIN_SIDE || Math.abs(endZ - rawStart.z) < RECT_MIN_SIDE) {
        return; // 너무 작은 드래그는 무시
      }

      const minX = Math.min(rawStart.x, endX);
      const maxX = Math.max(rawStart.x, endX);
      const minZ = Math.min(rawStart.z, endZ);
      const maxZ = Math.max(rawStart.z, endZ);

      // 4 코너 (CCW: (minX,minZ) → (maxX,minZ) → (maxX,maxZ) → (minX,maxZ))
      const corners = [
        new Vector3(minX, 0, minZ),
        new Vector3(maxX, 0, minZ),
        new Vector3(maxX, 0, maxZ),
        new Vector3(minX, 0, maxZ),
      ];

      // ⭐ 공간 그리기 = **공간 모듈 생성** — 모듈끼리의 스냅/공유벽 결합·해제/이동/
      // 변 크기조절/개구부 설계를 그대로 획득한다. (이전: 그린 벽 4개 직접 생성 —
      // 모듈과 결합이 안 되고 편집 기능도 달랐음)
      void corners;
      {
        const sm = useSpaceModuleStore.getState();
        const id = sm.add('custom', (minX + maxX) / 2, (minZ + maxZ) / 2);
        sm.update(id, {
          w: Math.round((maxX - minX) * 100) / 100,
          d: Math.round((maxZ - minZ) * 100) / 100,
        });
      }
      // 그리기 모드는 ESC 누를 때까지 유지 — 다음 드래그를 위해 rect 상태만 리셋
      const store = useWallDrawingStore.getState();
      store.setRectStart(null);
      store.setRectEnd(null);
    };

    // ===== line 모드 이벤트 핸들러 ==============================
    const onLinePointerMove = (e: PointerEvent) => {
      const target = resolveLineTarget(e.clientX, e.clientY);
      if (!target) return;
      const store = useWallDrawingStore.getState();
      store.setPreviewEnd(target.position);
      store.setGuideLines(target.guides);
      store.setPreviewHoverType(target.hoverType);
    };

    const onLinePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const target = resolveLineTarget(e.clientX, e.clientY);
      if (!target) return;
      // 점 해석 — 기존 노드 매칭 우선, 그 다음 벽 위 점이면 그 벽을 분할하면서 새 노드 생성
      const node = target.existing ?? resolveOrCreateNode(target.position);
      const currentStart = useWallDrawingStore.getState().startNode;
      if (currentStart === null) {
        useWallDrawingStore.getState().setStartNode(node);
        return;
      }
      if (currentStart === node) return;
      const thick = useViewStore.getState().wallThickPreview;
      // 새 벽이 기존 벽들과 XZ 평면 교차하면 교차점에서 모두 분할 — sub-wall들로 생성
      const newWalls = createWallWithIntersections(currentStart, node, thick);
      const touched = new Set<Wall>(newWalls);
      for (const w of currentStart.walls) touched.add(w);
      for (const w of node.walls) touched.add(w);
      refreshFaces(touched);
      // 자동 폐쇄 감지 — 분할/추가로 만들어진 사이클은 SpaceBuilder가 즉시 floor 생성
      const prevSpaceCount = useLayoutStore.getState().spaces.length;
      recomputeSpaces();
      const newSpaceCount = useLayoutStore.getState().spaces.length;
      const store = useWallDrawingStore.getState();
      if (newSpaceCount > prevSpaceCount) {
        // 폐쇄 완성 → 다음 클릭이 새 체인의 시작점이 되도록 startNode 리셋.
        // 사용자가 기존 노드를 hover하면 NODE_SNAP_DISTANCE로 흡수돼 그 노드부터 새 체인 시작.
        store.setStartNode(null);
        store.setPreviewEnd(null);
        store.setGuideLines([]);
      } else {
        // 아직 폐쇄 안 됐으면 체인 계속 이어그리기 — endNode를 다음 startNode로
        store.setStartNode(node);
      }
    };

    // ===== rectangle 모드 이벤트 핸들러 =========================
    // 드래그가 아닌 **클릭-이동-클릭** 패턴:
    //  1. 첫 클릭 → rectStart 설정 (시작 코너 확정)
    //  2. 마우스 이동 → rectEnd 갱신해 사각형 프리뷰 유지
    //  3. 두 번째 클릭 → 사각형 확정 + 공간 생성 + 다음 사각형의 시작 코너 대기
    // ESC만 모드 종료. 사용자가 연속해서 여러 공간을 그릴 수 있다.
    const onRectPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const hit = screenToWorld(e.clientX, e.clientY);
      if (!hit) return;
      // 시작/확정 좌표를 기존 그래프(노드/벽)에 흡수 — "그려진 공간에 연결"되도록 정확히 스냅
      const { position: snapped } = snapPositionToGraph(hit);
      const store = useWallDrawingStore.getState();
      if (store.rectStart === null) {
        // 1) 첫 클릭 — 시작 코너 확정. 미리보기 끝점은 시작 코너로 초기화.
        store.setRectStart(snapped);
        store.setRectEnd(snapped);
        return;
      }
      // 2) 두 번째 클릭 — 사각형 확정. rectEnd는 이미 pointermove로 최신 위치 (Shift 보정 포함).
      const end = store.rectEnd ?? snapped;
      finalizeRectangle(store.rectStart, end, shiftPressedRef.current);
      // finalizeRectangle 내부에서 rectStart/rectEnd null로 리셋 → 다음 클릭이 새 사각형 시작
    };

    const onRectPointerMove = (e: PointerEvent) => {
      const hit = screenToWorld(e.clientX, e.clientY);
      if (!hit) return;
      // hover 좌표를 기존 그래프에 흡수 — 사용자가 어느 노드/벽에 끌렸는지 시각 마커로 즉시 확인
      const { position: snapped, hoverType } = snapPositionToGraph(hit);
      const store = useWallDrawingStore.getState();
      store.setPreviewHoverType(hoverType);
      if (!store.rectStart) {
        // 시작 코너 대기 중 — hover 마커만 표시
        store.setPreviewEnd(snapped);
        return;
      }
      // Shift면 정사각형 — preview 단계에서 보정해 사용자가 바로 확인
      let finalEnd = snapped;
      if (shiftPressedRef.current) {
        const dx = snapped.x - store.rectStart.x;
        const dz = snapped.z - store.rectStart.z;
        const side = Math.max(Math.abs(dx), Math.abs(dz));
        finalEnd = new Vector3(
          store.rectStart.x + Math.sign(dx || 1) * side,
          snapped.y,
          store.rectStart.z + Math.sign(dz || 1) * side,
        );
      }
      store.setRectEnd(finalEnd);
      // hover 마커는 *실제 사각형 끝 코너* 위치에 표시 (Shift 보정 반영)
      store.setPreviewEnd(finalEnd);
    };

    // ===== 공통 핸들러 ==========================================
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    // ESC = 그리기 모드 단순 취소 + 미사용 시작점 정리.
    // - line 모드: startNode가 *wall에 한 번도 연결 안 된* dangling이면 (=첫 클릭만 하고 ESC)
    //   layoutStore에서 그 노드를 제거. 이미 wall이 만들어진 노드는 유지.
    // - rectangle 모드: rectStart는 좌표만이라 별도 노드 정리 불필요.
    // - buildSpaces는 wall 추가 시점에 이미 자동 호출되므로 여기서는 호출 안 함.
    const onKeyDown = (e: KeyboardEvent) => {
      shiftPressedRef.current = e.shiftKey;
      if (e.code === 'Escape') {
        const ws = useWallDrawingStore.getState();
        const startNode = ws.startNode;
        if (ws.mode === 'line' && startNode && startNode.walls.length === 0) {
          useLayoutStore.getState().removeNode(startNode);
        }
        ws.disable();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      shiftPressedRef.current = e.shiftKey;
    };

    // 모드별 이벤트 바인딩 — 더블클릭은 사용하지 않는다 (자동 폐쇄로 대체)
    if (mode === 'line') {
      canvas.addEventListener('pointermove', onLinePointerMove);
      canvas.addEventListener('pointerdown', onLinePointerDown);
    } else {
      canvas.addEventListener('pointerdown', onRectPointerDown);
      canvas.addEventListener('pointermove', onRectPointerMove);
    }
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      if (mode === 'line') {
        canvas.removeEventListener('pointermove', onLinePointerMove);
        canvas.removeEventListener('pointerdown', onLinePointerDown);
      } else {
        canvas.removeEventListener('pointerdown', onRectPointerDown);
        canvas.removeEventListener('pointermove', onRectPointerMove);
      }
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled, mode, gl, camera]);

  const startMarkerPos = useMemo<[number, number, number] | null>(() => {
    if (!startNode) return null;
    return [startNode.position.x, 0.02, startNode.position.z];
  }, [startNode]);

  // Rectangle preview 4 corners
  const rectCorners = useMemo<[number, number, number][] | null>(() => {
    if (!rectStart || !rectEnd) return null;
    const minX = Math.min(rectStart.x, rectEnd.x);
    const maxX = Math.max(rectStart.x, rectEnd.x);
    const minZ = Math.min(rectStart.z, rectEnd.z);
    const maxZ = Math.max(rectStart.z, rectEnd.z);
    return [
      [minX, 0.02, minZ],
      [maxX, 0.02, minZ],
      [maxX, 0.02, maxZ],
      [minX, 0.02, maxZ],
      [minX, 0.02, minZ], // 폐쇄
    ];
  }, [rectStart, rectEnd]);

  if (!enabled) return null;

  return (
    <group>
      {/* 정렬 점선 가이드 (X 정렬 = 파랑, Z 정렬 = 초록, 직진 연장선 = 주황).
          drei `<Line>`을 사용해 store의 라인 두께 반영. GUIDE_EXTEND만큼 양쪽으로 확장. */}
      {guideLines.map((g, i) => (
        <Line
          key={i}
          points={[
            [g.from.x, 0.015, g.from.z],
            [g.to.x, 0.015, g.to.z],
          ]}
          color={g.axis === 'x' ? '#1d4ed8' : g.axis === 'z' ? '#15803d' : '#f97316'}
          dashed
          dashSize={0.3}
          gapSize={0.15}
          lineWidth={Math.max(2, drawingLineWidth * 1.2)}
          depthTest={false}
          transparent
          opacity={0.95}
        />
      ))}

      {/* line 모드 미리보기 라인 (시작 노드 → 마우스 위치) */}
      {mode === 'line' && startNode && previewEnd && (
        <Line
          points={[
            [startNode.position.x, 0.02, startNode.position.z],
            [previewEnd.x, 0.02, previewEnd.z],
          ]}
          color="#ff9800"
          lineWidth={drawingLineWidth}
          depthTest={false}
        />
      )}

      {/* line 모드 시작 노드 마커 */}
      {mode === 'line' && startMarkerPos && (
        <mesh position={startMarkerPos}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshBasicMaterial color="#ff9800" depthTest={false} />
        </mesh>
      )}

      {/* 마우스 hover 위치 마커 (line + rectangle 모드 공통) — hoverType에 따라 색/크기 분기:
          - node 매칭 (기존 노드 정확 흡수): 큰 녹색 sphere
          - wall 매칭 (벽 위 점, 클릭 시 분할): 보라색 sphere
          - free: 작은 노란 sphere */}
      {previewEnd && (
        <mesh position={[previewEnd.x, 0.025, previewEnd.z]}>
          <sphereGeometry
            args={[
              previewHoverType === 'node' ? 0.18 : previewHoverType === 'wall' ? 0.12 : 0.05,
              16,
              16,
            ]}
          />
          <meshBasicMaterial
            color={
              previewHoverType === 'node'
                ? '#22c55e'
                : previewHoverType === 'wall'
                  ? '#a855f7'
                  : '#ffd54f'
            }
            depthTest={false}
          />
        </mesh>
      )}

      {/* rectangle 모드 사각형 프리뷰 외곽선 */}
      {mode === 'rectangle' && rectCorners && (
        <Line
          points={rectCorners}
          color="#ff9800"
          lineWidth={Math.max(2, drawingLineWidth)}
          depthTest={false}
        />
      )}

      {/* rectangle 모드 시작 코너 마커 */}
      {mode === 'rectangle' && rectStart && (
        <mesh position={[rectStart.x, 0.02, rectStart.z]}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshBasicMaterial color="#ff9800" depthTest={false} />
        </mesh>
      )}

      {/* rectangle 모드의 끝 코너는 공용 previewEnd 마커가 이미 표시 — 별도 마커 불필요. */}
    </group>
  );
}

/**
 * 시작점 기준 각도를 `snapDeg` 단위로 반올림한 위치를 반환한다.
 * 거리는 유지하고 각도만 조정한다.
 */
function snapToAngle(start: Vector3, world: Vector3, snapDeg: number): Vector3 {
  const dx = world.x - start.x;
  const dz = world.z - start.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return world.clone();
  const ang = Math.atan2(dz, dx);
  const snapRad = (snapDeg * Math.PI) / 180;
  const snapped = Math.round(ang / snapRad) * snapRad;
  return new Vector3(
    start.x + Math.cos(snapped) * dist,
    world.y,
    start.z + Math.sin(snapped) * dist,
  );
}
