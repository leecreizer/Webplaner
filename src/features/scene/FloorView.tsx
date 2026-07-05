import { useMemo } from 'react';
import { DoubleSide, Vector2, Vector3 } from 'three';
import { useMeshSelectionStore, meshKey } from '@/features/selection/meshSelectionStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { Space } from '@/domain/structures/Space';
import { polyGeometry, polyGeometryExtruded } from '@/engine/mesh/MeshGenerator';
import { useEditStore } from '@/features/editing/editStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { Plane, Raycaster } from 'three';
import { useThree } from '@react-three/fiber';
import { useLayoutStore } from '@/domain/state/layoutStore';
import type { Wall } from '@/domain/structures/Wall';
import { isModuleWall, wallSourceModules, setModuleDragging } from '@/features/spaceModules/syncModuleWalls';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';

const _csgEval = new Evaluator();

/**
 * Space의 바닥면을 그리는 r3f 컴포넌트.
 *
 * Unity의 `Floor` + `CeilingFloorBase.DirtyUpdate` + `MeshGenerator.GeneratePolyToMesh` 조합을
 * 단일 컴포넌트로 통합. `space.cornerPoints`를 Triangulator로 삼각분할.
 *
 * @param thickness 단차 내림 두께(m, Y 음의 방향 압출). 기본 0 (단면).
 *   단면이어도 material의 `shadowSide=DoubleSide` + `castShadow` 조합으로 양방향에서
 *   shadow map에 잡혀 빛이 투과되지 않는다.
 */
export function FloorView({
  space,
  thickness = 0,
  color = '#ffffff',
}: {
  space: Space;
  thickness?: number;
  color?: string;
}) {
  // editStore.operations를 ref-stable하게 구독 후 useMemo로 floor만 필터 (무한 루프 방지)
  const allEditOps = useEditStore((s) => s.operations);
  const floorOps = useMemo(
    () => allEditOps.filter((o) => o.targetKind === 'floor' && o.ownerId === space.spaceIndex),
    [allEditOps, space.spaceIndex],
  );

  // mesh 선택 + 사용자 material override + visibility
  const { gl, camera } = useThree();
  const myKey = meshKey('floor', space.spaceIndex);
  const visible = useVisibilityStore((s) => !s.hidden[myKey] && !s.removed[myKey]);
  const selected = useMeshSelectionStore((s) => s.selectedMeshKeys.includes(myKey));
  const override = useMeshSelectionStore((s) => s.materials[myKey]);
  const selectMesh = useMeshSelectionStore((s) => s.selectMesh);
  const effectiveColor = override?.color ?? color;
  const effectiveRoughness = override?.roughness ?? 0.95;
  const effectiveMetalness = override?.metalness ?? 0.0;
  const effectiveOpacity = override?.opacity ?? 1.0;

  const geometry = useMemo(() => {
    const pts = space.cornerPoints;
    if (pts.length < 3) return null;
    const origin = new Vector3(0, Space.DEFAULT_FLOOR_HEIGHT + thickness, 0);
    const base =
      thickness === 0
        ? polyGeometry(pts as Vector2[], origin, new Vector3(0, 0, 1), false)
        : polyGeometryExtruded(pts as Vector2[], origin, new Vector3(0, 0, 1), thickness, false);
    if (!base || floorOps.length === 0) return base;
    // floor mesh는 group transform 없이 world 좌표 그대로 — brush들도 world 좌표라 단순 평가
    try {
      let result = new Brush(base);
      result.updateMatrixWorld();
      for (const op of floorOps) {
        const tool = new Brush(op.boxGeometry.clone());
        tool.updateMatrixWorld();
        const next = _csgEval.evaluate(
          result,
          tool,
          op.kind === 'cut' ? SUBTRACTION : ADDITION,
        );
        result = next;
      }
      return result.geometry;
    } catch (e) {
      console.warn('[FloorView] CSG 평가 실패', e);
      return base;
    }
  }, [space.cornerPoints, thickness, floorOps]);

  if (geometry === null || !visible) return null;

  return (
    <group>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        userData={{ editKind: 'floor', editOwnerId: space.spaceIndex }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          // ⭐ 2D 탑뷰: 바닥 드래그 = **공간 통째 이동** (벽 그리기로 만든 자유형 공간 포함).
          //   - 공간의 벽이 전부 한 모듈 소유면 → 모듈 이동으로 위임 (스냅/동반이동 유지)
          //   - 그 외(그린 벽 공간) → 소속 노드들을 함께 평행이동
          if (useViewStore.getState().viewMode === '2D' && !useEditStore.getState().enabled) {
            startSpaceDrag(e.nativeEvent, space, gl.domElement, camera);
            return;
          }
          // 에디트 모드일 때만 바닥(표면) 선택(재질/뚫기·돌출용). 그 외엔 바닥=배경 →
          // 클릭 시 상품·메시 선택 전부 해제(오브젝트 아닌 화면 클릭 = 해제).
          if (useEditStore.getState().enabled) {
            selectMesh(myKey, e.shiftKey);
          } else {
            selectMesh(null);
            const ps = usePlacedProductStore.getState();
            if (ps.selectedIds.length > 0) { ps.select(null); window.parent?.postMessage({ type: 'hp3:deselected' }, '*'); }
          }
        }}
      >
        <meshStandardMaterial
          color={effectiveColor}
          roughness={effectiveRoughness}
          metalness={effectiveMetalness}
          opacity={effectiveOpacity}
          transparent={effectiveOpacity < 1}
          emissive={override?.emissive ?? '#000000'}
          emissiveIntensity={override?.emissiveIntensity ?? 0}
          side={DoubleSide}
          shadowSide={DoubleSide}
        />
      </mesh>
      {/* 선택 시 시안색 가장자리 라인 — depthTest=false 로 다른 mesh 뒤에 있어도 보임 */}
      {selected && (
        <lineSegments renderOrder={999}>
          <edgesGeometry args={[geometry, 1]} />
          <lineBasicMaterial color="#22d3ee" depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      )}
    </group>
  );
}


/** 2D 바닥 드래그 — 공간 전체 이동. 모듈 공간이면 모듈 store 로 위임, 그린 공간이면 노드 평행이동. */
const CLICK_PX = 4;
function startSpaceDrag(
  down: PointerEvent,
  space: Space,
  canvas: HTMLCanvasElement,
  camera: Parameters<Raycaster['setFromCamera']>[1],
): void {
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const toGround = (cx: number, cy: number): Vector3 | null => {
    const r = canvas.getBoundingClientRect();
    const nd = new Vector2(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
    const rc = new Raycaster();
    rc.setFromCamera(nd, camera);
    const pt = new Vector3();
    return rc.ray.intersectPlane(ground, pt) ? pt : null;
  };
  const start = toGround(down.clientX, down.clientY);
  if (!start) return;

  // 공간 벽 분류 — 전부 같은 모듈 소유면 모듈 이동으로 위임
  const walls = [...space.walls.keys()];
  const moduleIds = new Set<string>();
  let hasDrawn = false;
  for (const w of walls) {
    const ids = isModuleWall(w) ? wallSourceModules(w) : undefined;
    if (ids && ids.length > 0) ids.forEach((id) => moduleIds.add(id));
    else hasDrawn = true;
  }
  const singleModule = !hasDrawn && moduleIds.size === 1 ? [...moduleIds][0] : null;

  if (singleModule) {
    // 모듈 이동으로 위임 — 기존 스냅/상품 동반이동/sync 스로틀 그대로
    const st = useSpaceModuleStore.getState();
    const m = st.modules.find((x) => x.id === singleModule);
    if (!m) return;
    const offX = start.x - m.x, offZ = start.z - m.z;
    let moved = false;
    setModuleDragging(true);
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < CLICK_PX) return;
      moved = true;
      const gp = toGround(ev.clientX, ev.clientY);
      if (!gp) return;
      useSpaceModuleStore.getState().transformModule(singleModule, { x: gp.x - offX, z: gp.z - offZ });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setModuleDragging(false);
      if (!moved) useSpaceModuleStore.getState().select(singleModule); // 클릭 = 모듈 선택
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return;
  }

  // 그린 벽 공간 — 소속 노드 전체를 평행이동 (혼합 공간 포함, 모듈 벽 노드는 제외)
  const nodes = new Set<Wall['startNode']>();
  for (const w of walls) {
    if (isModuleWall(w)) continue; // 모듈 벽은 sync 원본이라 직접 이동 금지
    if (w.startNode) nodes.add(w.startNode);
    if (w.endNode) nodes.add(w.endNode);
  }
  if (nodes.size === 0) return;
  const base = [...nodes].map((n) => ({ n: n!, x: n!.position.x, z: n!.position.z }));
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < CLICK_PX) return;
    moved = true;
    const gp = toGround(ev.clientX, ev.clientY);
    if (!gp) return;
    const dx = gp.x - start.x, dz = gp.z - start.z;
    for (const b of base) b.n.position.set(b.x + dx, 0, b.z + dz);
    const touched = new Set<Wall>();
    for (const b of base) for (const w of b.n.walls) touched.add(w);
    for (const w of touched) w.updateWallFace();
    useLayoutStore.setState((s) => ({ walls: [...s.walls] }));
    space.invalidateCornerPoints();
    void space.cornerPoints;
    space.updateCenter();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
