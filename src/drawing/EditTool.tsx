import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferGeometry,
  Matrix3,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { useEditStore } from './editStore';
import { useViewStore } from './viewStore';
import { Line } from '@react-three/drei';

/**
 * 3D 에디트 도구 — Toolbar의 "에디트 모드" 활성 시 동작.
 *
 * ### 흐름
 * 1. hover로 wall/floor/ceiling mesh를 raycast → 그 face의 normal/origin/uv basis 추출
 * 2. 좌클릭 → 시작 코너 (face 평면 좌표계의 u/v 시작)
 * 3. 마우스 이동 → 사각형 프리뷰 (drei `<Line>` 으로 outline)
 * 4. 좌클릭(두번째) → 사각형 확정 → BoxGeometry 만들어 face normal 방향으로 두께만큼 압출
 * 5. **operation: 'cut'** → CSG SUBTRACTION (구멍) — wall에서 box 빼기
 *    **operation: 'extrude'** → CSG ADDITION (돌출) — wall에 box 더하기
 * 6. 결과 mesh를 **window.__editOverlays** 컬렉션에 저장 (원본은 보존)
 *
 * 카메라 ortho(2D)에서는 raycast가 위에서 내려옴 — 의도와 다르므로 3D 모드에서만 작동.
 */

/** 글로벌 overlay mesh 컬렉션 — EditOverlay 컴포넌트가 구독해 렌더. */
export interface EditOverlay {
  id: number;
  geometry: BufferGeometry;
}

let _overlaySeq = 0;
const overlayListeners = new Set<(list: EditOverlay[]) => void>();
const overlayList: EditOverlay[] = [];

function pushOverlay(geo: BufferGeometry) {
  overlayList.push({ id: ++_overlaySeq, geometry: geo });
  overlayListeners.forEach((cb) => cb([...overlayList]));
}

export function useEditOverlays(): EditOverlay[] {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((v) => v + 1);
    overlayListeners.add(cb);
    return () => {
      overlayListeners.delete(cb);
    };
  }, []);
  return overlayList;
}

/** UI 사각형 프리뷰를 그릴 4 코너 (월드 좌표) 계산. */
function rectCorners(
  origin: Vector3,
  u: Vector3,
  v: Vector3,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): [number, number, number][] {
  const p = (uu: number, vv: number) =>
    origin.clone().add(u.clone().multiplyScalar(uu)).add(v.clone().multiplyScalar(vv));
  const a = p(uMin, vMin);
  const b = p(uMax, vMin);
  const c = p(uMax, vMax);
  const d = p(uMin, vMax);
  return [
    [a.x, a.y, a.z],
    [b.x, b.y, b.z],
    [c.x, c.y, c.z],
    [d.x, d.y, d.z],
    [a.x, a.y, a.z],
  ];
}

export function EditTool() {
  const enabled = useEditStore((s) => s.enabled);
  const operation = useEditStore((s) => s.operation);
  const thickness = useEditStore((s) => s.thickness);
  const target = useEditStore((s) => s.target);
  const rect = useEditStore((s) => s.rect);
  const viewMode = useViewStore((s) => s.viewMode);
  const { gl, scene, camera } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);
  const phaseRef = useRef<'idle' | 'await-end'>('idle');

  // 캔버스 pointer 이벤트로 raycast + 사각형 그리기
  useEffect(() => {
    if (!enabled || viewMode !== '3D') {
      phaseRef.current = 'idle';
      return;
    }
    const canvas = gl.domElement;

    const screenRay = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
    };

    /**
     * mesh hit을 분석해 face normal/u/v basis를 계산. wall/floor/ceiling 메쉬 식별은
     * mesh.userData.editKind = 'wall' | 'floor' | 'ceiling' + editOwnerId 로.
     * (WallView/FloorView/CeilingView에서 userData 설정해야 함 — 추후 패치)
     */
    const hitToFaceTarget = (clientX: number, clientY: number) => {
      screenRay(clientX, clientY);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        const m = h.object as Mesh;
        const ud = m.userData;
        if (!ud?.editKind || !h.face) continue;
        // face.normal은 *mesh local 좌표*. world로 변환하려면 Matrix3.getNormalMatrix(matrixWorld)
        // 를 적용. (이전 구현은 Matrix4를 잘못된 type cast로 applyMatrix3에 전달해 결과가 부정확.)
        const normalMat = new Matrix3().getNormalMatrix(m.matrixWorld);
        const normal = h.face.normal.clone().applyMatrix3(normalMat).normalize();
        // u/v basis: face normal에 직교한 두 축. floor/ceiling은 normal ≈ ±Y이므로 u=+X,
        // v=±Z가 자연스럽고, vertical wall은 worldUp을 사용해 horizontal u를 만든다.
        const worldUp = new Vector3(0, 1, 0);
        let u: Vector3;
        if (Math.abs(normal.dot(worldUp)) > 0.95) {
          // floor (normal=+Y) 또는 ceiling (normal=-Y) — 평면이 수평
          u = new Vector3(1, 0, 0);
        } else {
          // vertical wall 등 — worldUp과 normal의 외적이 horizontal u 방향
          u = new Vector3().crossVectors(worldUp, normal);
          if (u.lengthSq() < 1e-4) u = new Vector3(1, 0, 0);
          u.normalize();
        }
        const v = new Vector3().crossVectors(normal, u).normalize();
        return {
          kind: (ud.editKind as 'wall' | 'floor' | 'ceiling'),
          ownerId: (ud.editOwnerId as number) ?? -1,
          origin: h.point.clone(),
          normal,
          u,
          v,
        };
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const ws = useEditStore.getState();
      if (phaseRef.current === 'idle') {
        // 첫 클릭 — 면 선택 + rect 시작 (uMin/uMax = 0)
        const t = hitToFaceTarget(e.clientX, e.clientY);
        if (!t) return;
        ws.setTarget(t);
        ws.setRect({ uMin: 0, uMax: 0, vMin: 0, vMax: 0 });
        phaseRef.current = 'await-end';
      } else {
        // 두번째 클릭 — 사각형 확정 + CSG
        const t = ws.target;
        const r = ws.rect;
        if (!t || !r) return;
        applyOperation(t, r, ws.thickness, ws.operation);
        ws.setTarget(null);
        ws.setRect(null);
        phaseRef.current = 'idle';
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const ws = useEditStore.getState();
      if (phaseRef.current !== 'await-end' || !ws.target) return;
      // 현재 face와 같은 plane으로 ray를 쏴 hit point의 u/v 좌표를 계산해 rect 갱신
      const t = ws.target;
      screenRay(e.clientX, e.clientY);
      // ray-plane intersect: plane through origin with normal t.normal
      const denom = raycaster.ray.direction.dot(t.normal);
      if (Math.abs(denom) < 1e-6) return;
      const tt = t.origin.clone().sub(raycaster.ray.origin).dot(t.normal) / denom;
      if (tt < 0) return;
      const hit = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(tt));
      const rel = hit.clone().sub(t.origin);
      const uu = rel.dot(t.u);
      const vv = rel.dot(t.v);
      // 첫 클릭 위치가 (0,0) → hit point가 (uu, vv) — 사각형 범위
      const uMin = Math.min(0, uu);
      const uMax = Math.max(0, uu);
      const vMin = Math.min(0, vv);
      const vMax = Math.max(0, vv);
      ws.setRect({ uMin, uMax, vMin, vMax });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        useEditStore.getState().disable();
        phaseRef.current = 'idle';
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, viewMode, gl, scene, camera, raycaster]);

  // 프리뷰 사각형 outline
  const previewCorners = useMemo<[number, number, number][] | null>(() => {
    if (!target || !rect) return null;
    return rectCorners(target.origin, target.u, target.v, rect.uMin, rect.uMax, rect.vMin, rect.vMax);
  }, [target, rect]);

  if (!enabled) return null;

  return (
    <group>
      {previewCorners && (
        <Line
          points={previewCorners}
          color={operation === 'cut' ? '#ef4444' : '#22c55e'}
          lineWidth={3}
          depthTest={false}
        />
      )}
      {/* 두께 표시용 작은 인디케이터 — 추후 */}
      {target && (
        <mesh position={[target.origin.x, target.origin.y, target.origin.z]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color="#fbbf24" depthTest={false} />
        </mesh>
      )}
      {/* 두께 슬라이더 미사용 hint 회피 */}
      <group userData={{ _thickness: thickness }} />
    </group>
  );
}

/**
 * 면 target + 사각형 rect + thickness + operation을 받아 CSG box를 만든 후, 결과 mesh geometry를
 * overlayList에 push. 원본 wall/floor/ceiling은 변경하지 않음.
 *
 * **단순화 v1**: target mesh와 box 사이의 CSG를 수행해 결과 *box 부분의 geometry*만 overlay로
 * 저장. 원본 mesh는 그대로이고, 사용자가 보는 visual은:
 *  - cut: 원본 mesh + (overlay = box shape with subtract result) — *시각상 box 부분이 사라진 것처럼
 *    안 보임*. 후속 패치에서 원본 mesh 자체를 CSG 결과로 교체 필요.
 *  - extrude: 원본 mesh + (overlay = box shape) — box가 돌출돼 보임.
 *
 * 즉 v1은 **돌출만 시각 효과 정확**. 뚫기는 시각 효과 후속 (원본 mesh 교체 필요).
 */
function applyOperation(
  target: NonNullable<ReturnType<typeof useEditStore.getState>['target']>,
  rect: NonNullable<ReturnType<typeof useEditStore.getState>['rect']>,
  thickness: number,
  operation: 'cut' | 'extrude',
): void {
  const uW = rect.uMax - rect.uMin;
  const vW = rect.vMax - rect.vMin;
  if (uW < 0.05 || vW < 0.05) return;
  const centerU = (rect.uMin + rect.uMax) / 2;
  const centerV = (rect.vMin + rect.vMax) / 2;
  // box center — face 평면 위 중심 + normal 방향으로 thickness 절반 (돌출은 외부, 뚫기는 내부)
  const dir = operation === 'extrude' ? +1 : -1;
  const centerWorld = target.origin
    .clone()
    .add(target.u.clone().multiplyScalar(centerU))
    .add(target.v.clone().multiplyScalar(centerV))
    .add(target.normal.clone().multiplyScalar((thickness / 2) * dir));

  const box = new BoxGeometry(uW, vW, thickness);
  // box를 face basis(u, v, normal)로 회전
  // BoxGeometry는 (x=u, y=v, z=normal)로 가정. 우리 basis를 적용하려면 vert를 변환.
  const positions = box.attributes.position.array as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const world = target.u.clone().multiplyScalar(x)
      .add(target.v.clone().multiplyScalar(y))
      .add(target.normal.clone().multiplyScalar(z))
      .add(centerWorld);
    positions[i] = world.x;
    positions[i + 1] = world.y;
    positions[i + 2] = world.z;
  }
  box.computeVertexNormals();

  // v2: editStore에 operation 기록 push → WallView/FloorView/CeilingView가 CSG로 적용
  useEditStore.getState().addOperation({
    kind: operation,
    targetKind: target.kind,
    ownerId: target.ownerId,
    boxGeometry: box,
  });
  // 진단용 overlay는 유지 (디버그 시 box 위치 확인 가능)
  pushOverlay(box);

  // CSG library imports (사용은 wall/floor/ceiling view에서)
  void Evaluator;
  void Brush;
  void SUBTRACTION;
  void ADDITION;
  void MeshStandardMaterial;
}