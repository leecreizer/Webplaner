import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import { Html } from '@react-three/drei';
import { DoubleSide, Matrix4, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { Wall } from '@/domain/structures/Wall';
import { polyGeometryExtruded } from '@/engine/mesh/MeshGenerator';
import { useViewStore } from '@/engine/stores/viewStore';
import { isModuleWall, wallSourceModules, setModuleDragging } from '@/features/spaceModules/syncModuleWalls';
import { findModuleSideForWall, resizeModuleEdge } from '@/features/spaceModules/moduleResize';
import { clearOtherSelections } from '@/features/selection/clearSelections';
import { useWallDrawingStore } from '@/features/drawing/wallDrawingStore';
import { useSelectionStore } from '@/features/selection/selectionStore';
import { useEditStore } from '@/features/editing/editStore';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { Space } from '@/domain/structures/Space';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { alignSnap, type DragGuide } from '@/features/drawing/snapHelpers';
import { DragGuideLines } from '@/features/drawing/DragGuideLines';
import { useMeshSelectionStore, meshKey } from '@/features/selection/meshSelectionStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';

const _csgEval = new Evaluator();

/** 2D 탑뷰에서 wall을 얇은 strip으로 표시할 때 사용하는 두께(m). */
const TOPVIEW_WALL_THICKNESS = 0.06;

/** 클릭 vs 드래그 구분 임계값(CSS px). */
const CLICK_VS_DRAG_PX = 5;

/**
 * 단일 Wall — 클릭 선택, (2D 모드에서) 드래그 이동, 삭제 지원.
 *
 * - 그리기 모드 비활성일 때 인터랙티브
 * - **2D 모드**: 클릭 = 선택 토글 / 드래그 = 양 끝 노드 평행 이동 + X/Z 정렬 가이드
 * - **3D 모드**: 클릭으로 선택만 (이동 금지 — 카메라 회전과 충돌 + 데이터 손상 방지)
 * - **Del/Backspace**: 선택된 wall 삭제 (Wall.delete — 양 끝 노드가 다른 wall에 연결돼 있으면 살아남음)
 *
 * 색상: 일반 그레이 / hover 노랑 / 선택 시안 / 드래그 오렌지
 */
export function WallView({ wall, color = '#cccccc' }: { wall: Wall; color?: string }) {
  const viewMode = useViewStore((s) => s.viewMode);
  const drawingEnabled = useWallDrawingStore((s) => s.enabled);
  const selectedWall = useSelectionStore((s) => s.selectedWall);
  // editStore.operations 자체를 ref-stable하게 구독 후, useMemo로 이 wall 것만 필터.
  // selector 안에서 filter()를 직접 호출하면 매번 새 배열 ref가 반환돼 zustand가 변경 감지를
  // 매 렌더마다 trigger해 무한 루프가 발생한다.
  // per-wall shallow 구독 — operations 배열 참조가 바뀌어도 이 벽의 op 목록이
  // 동일하면 리렌더/CSG 재평가를 건너뛴다 (이전: 벽 1개 변경에 전체 벽 재평가).
  const wallOperations = useEditStore(
    useShallow((s) => s.operations.filter((o) => o.targetKind === 'wall' && o.ownerId === wall.wallIndex)),
  );
  const { gl, camera } = useThree();
  const effectiveHeight = viewMode === '2D' ? TOPVIEW_WALL_THICKNESS : wall.wallHeight;
  const is2D = viewMode === '2D';

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragGuides, setDragGuides] = useState<DragGuide[]>([]);
  const isSelected = selectedWall === wall;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Delete' && e.code !== 'Backspace') return;
      // 2D 모드에서만 삭제 — 3D는 편집 전면 비활성
      if (useViewStore.getState().viewMode !== '2D') return;
      const sel = useSelectionStore.getState().selectedWall;
      if (sel !== wall) return;
      deleteWall(wall);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wall]);

  const { position, quaternion } = useMemo(() => {
    if (!wall.startNode) return { position: new Vector3(), quaternion: new Quaternion() };
    const pos = wall.startNode.position.clone();
    pos.y += effectiveHeight;
    const dir = wall.direction.lengthSq() > 0 ? wall.direction : new Vector3(0, 0, 1);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir);
    return { position: pos, quaternion: q };
  }, [wall.startNode, wall.direction, effectiveHeight]);

  const geometry = useMemo(() => {
    if (wall.isVirtual || wall.border.length < 4) return null;
    const points2D = wall.border.map((v) => new Vector2(v.x, v.z));
    const base = polyGeometryExtruded(points2D, new Vector3(), new Vector3(0, 0, 1), effectiveHeight, false);
    if (!base || wallOperations.length === 0) return base;

    // **world-only CSG 평가**: base vertices를 *처음에* world로 변환해 brush position을 identity로
    // 둔다. evaluator는 brush.matrixWorld 적용한 vertices로 평가하므로 brush position이 identity면
    // geometry 좌표가 곧 world. 결과 brush도 identity 유지되어 다음 op에서 *이중 변환되지 않는다*.
    // (이전 구현은 매 op마다 next.position을 wall position으로 복사해 두 번째 op에서 vertices가
    //  wall transform으로 *한 번 더* 변환되며 결과 mesh가 본래 위치를 벗어나는 버그가 있었음.)
    try {
      const m = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1));
      const baseWorld = base.clone();
      const bp = baseWorld.attributes.position;
      const v = new Vector3();
      for (let i = 0; i < bp.count; i++) {
        v.fromBufferAttribute(bp, i).applyMatrix4(m);
        bp.setXYZ(i, v.x, v.y, v.z);
      }
      bp.needsUpdate = true;
      baseWorld.computeVertexNormals();

      let result = new Brush(baseWorld);
      result.updateMatrixWorld();
      for (const op of wallOperations) {
        const tool = new Brush(op.boxGeometry.clone());
        tool.updateMatrixWorld();
        const next = _csgEval.evaluate(
          result,
          tool,
          op.kind === 'cut' ? SUBTRACTION : ADDITION,
        );
        // identity 유지 — 그래야 다음 op에서 vertices가 한 번만 transform됨
        next.position.set(0, 0, 0);
        next.quaternion.identity();
        next.updateMatrixWorld();
        result = next;
      }

      // wall group이 한 번 더 transform 적용하므로 결과 geometry는 다시 wall local로 inverse
      const inv = m.clone().invert();
      const geo = result.geometry.clone();
      const gpos = geo.attributes.position;
      for (let i = 0; i < gpos.count; i++) {
        v.fromBufferAttribute(gpos, i).applyMatrix4(inv);
        gpos.setXYZ(i, v.x, v.y, v.z);
      }
      gpos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    } catch (e) {
      console.warn('[WallView] CSG 평가 실패', e);
      return base;
    }
  }, [wall.border, effectiveHeight, wall.isVirtual, wallOperations, position, quaternion]);

  // wall mid-point (월드 좌표) — 삭제 버튼 anchor
  const midpoint = useMemo<[number, number, number]>(() => {
    if (!wall.startNode || !wall.endNode) return [0, 0, 0];
    return [
      (wall.startNode.position.x + wall.endNode.position.x) / 2,
      0.05,
      (wall.startNode.position.z + wall.endNode.position.z) / 2,
    ];
  }, [wall.startNode, wall.endNode, wall.border]);

  // mesh material override (reactive — Inspector 변경 즉시 반영)
  const myMeshKey = meshKey('wall', wall.wallIndex);
  const meshOverride = useMeshSelectionStore((s) => s.materials[myMeshKey]);
  const selectMesh = useMeshSelectionStore((s) => s.selectMesh);
  const meshSelected = useMeshSelectionStore((s) => s.selectedMeshKeys.includes(myMeshKey));
  const visible = useVisibilityStore((s) => !s.hidden[myMeshKey]);

  if (geometry === null || !visible) return null;

  const wallColor = dragging
    ? '#ff5722'
    : isSelected
      ? '#00bcd4'
      : hovered
        ? '#ffc107'
        : is2D
          ? '#555555'
          : meshOverride?.color ?? color;

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (drawingEnabled || !wall.startNode || !wall.endNode) return;
    // 좌클릭(button=0)만 선택/드래그 — 우클릭/가운데 버튼은 카메라 조작에 양보
    if (e.button !== 0) return;
    e.stopPropagation();
    // 3D 모드 — 클릭만 = 선택 (편집은 비활성). Shift+클릭 = 다중 추가/제거.
    if (!is2D) {
      if (!e.shiftKey) {
        const cur = useSelectionStore.getState().selectedWall;
        const next = cur === wall ? null : wall;
        useSelectionStore.getState().selectWall(next);
        if (next) clearOtherSelections('wall'); // 벽 선택 시 모델/상품/모듈 해제
      }
      selectMesh(myMeshKey, e.shiftKey);
      return;
    }
    // 모듈발 벽: 노드 직접 이동은 sync 가 원복시키므로, 드래그를 **모듈 변 크기조절**로 변환.
    // (변 핸들과 동일 로직 — 반대 변 고정, 놓으면 벽 sync 1회)
    if (isModuleWall(wall)) {
      useSelectionStore.getState().selectWall(wall);
      clearOtherSelections('wall');
      selectMesh(myMeshKey, e.shiftKey);
      const mid = wall.startNode.position.clone().add(wall.endNode.position).multiplyScalar(0.5);
      const hit = findModuleSideForWall(wallSourceModules(wall) ?? [], mid.x, mid.z);
      if (!hit) return; // 매칭 실패 시 선택만
      setModuleDragging(true); // 드래그 동안 벽 sync 동결 (이 Wall 인스턴스 유지)
      const el = gl.domElement;
      const toGround = (cx: number, cy: number): [number, number] | null => {
        const r = el.getBoundingClientRect();
        const nd = new Vector2(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
        const rc = new Raycaster();
        rc.setFromCamera(nd, camera);
        const pt = new Vector3();
        return rc.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), pt) ? [pt.x, pt.z] : null;
      };
      const onMove = (ev: PointerEvent) => {
        const gp = toGround(ev.clientX, ev.clientY);
        if (gp) resizeModuleEdge(hit.moduleId, hit.side, gp[0], gp[1]);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setModuleDragging(false); // 미룬 sync 실행 → 벽 재생성
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
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

    const worldStart = screenToWorld(downX, downY);
    if (!worldStart || !wall.startNode || !wall.endNode) return;
    const startA = wall.startNode.position.clone();
    const startB = wall.endNode.position.clone();

    const onMove = (me: PointerEvent) => {
      const dist = Math.hypot(me.clientX - downX, me.clientY - downY);
      // 3D 모드에서는 드래그 자체를 비활성 — 카메라 회전과 충돌 + 데이터 손상 방지
      if (!didDrag && dist >= CLICK_VS_DRAG_PX && is2D) {
        didDrag = true;
        setDragging(true);
        canvas.style.cursor = 'grabbing';
      }
      if (!didDrag) return;
      if (!wall.startNode || !wall.endNode) return;
      const hit = screenToWorld(me.clientX, me.clientY);
      if (!hit) return;
      const dx = hit.x - worldStart.x;
      const dz = hit.z - worldStart.z;
      // A 노드 기준으로 X/Z 정렬 검사 — 양 끝 노드는 정렬 대상에서 제외
      const targetA = new Vector3(startA.x + dx, 0, startA.z + dz);
      const { position: snappedA, guides } = alignSnap(
        targetA,
        new Set([wall.startNode, wall.endNode]),
      );
      const correctedDx = snappedA.x - startA.x;
      const correctedDz = snappedA.z - startA.z;
      wall.startNode.position.set(startA.x + correctedDx, 0, startA.z + correctedDz);
      wall.endNode.position.set(startB.x + correctedDx, 0, startB.z + correctedDz);
      setDragGuides(guides);
      const touched = new Set<typeof wall>();
      for (const w of wall.startNode.walls) touched.add(w);
      for (const w of wall.endNode.walls) touched.add(w);
      for (const w of touched) w.updateWallFace();
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
        const existing = [...useLayoutStore.getState().spaces];
        for (const sp of existing) Space.delete(sp, layoutRegistry);
        buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
        useLayoutStore.setState((s) => ({ walls: [...s.walls], spaces: [...s.spaces] }));
        for (const sp of useLayoutStore.getState().spaces) {
          sp.invalidateCornerPoints();
          void sp.cornerPoints;
          sp.updateCenter();
          sp.updateArea();
        }
        setDragging(false);
        setDragGuides([]);
        canvas.style.cursor = '';
      } else {
        // 클릭(드래그 안 함) — 선택. Shift 면 mesh multi-select 추가, 일반 클릭은 단일.
        const shift = (e as unknown as { shiftKey?: boolean }).shiftKey ?? false;
        if (!shift) {
          const cur = useSelectionStore.getState().selectedWall;
          const next = cur === wall ? null : wall;
          useSelectionStore.getState().selectWall(next);
        }
        selectMesh(myMeshKey, shift);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <group position={position} quaternion={quaternion}>
        <mesh
          geometry={geometry}
          castShadow
          receiveShadow
          userData={{ editKind: 'wall', editOwnerId: wall.wallIndex }}
          onPointerDown={onPointerDown}
          onPointerOver={(e) => {
            if (drawingEnabled || !is2D) return;
            e.stopPropagation();
            setHovered(true);
            gl.domElement.style.cursor = 'grab';
          }}
          onPointerOut={() => {
            setHovered(false);
            if (!dragging) gl.domElement.style.cursor = '';
          }}
        >
          <meshStandardMaterial
            color={wallColor}
            roughness={meshOverride?.roughness ?? 0.85}
            metalness={meshOverride?.metalness ?? 0.0}
            opacity={meshOverride?.opacity ?? 1.0}
            transparent={(meshOverride?.opacity ?? 1) < 1}
            emissive={meshOverride?.emissive ?? '#000000'}
            emissiveIntensity={meshOverride?.emissiveIntensity ?? 0}
            // 벽은 두께 있는 박스 — FrontSide 만 shadow casting 해야 self-shadow acne 없음.
            // (shadowSide=DoubleSide 면 wall 자기 backface 가 자기 frontface 에 그림자
            // 떨어뜨려 벽이 자기 자신에 어둠 acne 가 끼고 *외부에 정상 그림자가 약하게*
            // 나타남.)
            side={DoubleSide}
          />
        </mesh>
        {/* 선택 시 시안색 가장자리 라인 — 시각 piacking 표시 */}
        {(isSelected || meshSelected) && (
          <lineSegments renderOrder={999}>
            <edgesGeometry args={[geometry, 1]} />
            <lineBasicMaterial color="#22d3ee" depthTest={false} transparent opacity={0.95} />
          </lineSegments>
        )}
      </group>

      {/* 가이드 라인 + 삭제 버튼은 회전 group *밖*에 두어 좌표 변환 영향 안 받게 */}
      <DragGuideLines guides={dragGuides} />
      {/* 삭제 버튼 제거 — 삭제는 Del/Backspace 키로 (상품 선택 UX 와 통일) */}
    </>
  );
}

function deleteWall(w: Wall): void {
  Wall.delete(w, layoutRegistry);
  useSelectionStore.getState().clear();
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