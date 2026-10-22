import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, Sphere, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { useHomvueStore } from '@/features/homvue/homvueStore';
import { useImportedModelStore } from '@/features/models/importedModelStore';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';
import { useCustomLightStore } from '@/engine/stores/customLightStore';

/**
 * Z 키 — 선택한 모델로 카메라를 맞춘다(회전 중심을 모델 가운데로, 화면에 꽉 차게). 사용자 요청 2026-10-21.
 *
 * 대상(먼저 찾은 것): Homvue 상품 → 홈플래너3 배치 상품(하나만 고른 경우) → 불러온 모델 → 추가한 조명.
 * 장면의 물체는 `userData.focusId` 로 찾는다(각 물체가 자기 id 를 달아 둔다).
 * - 기본 뷰어(궤도 카메라): 지금 보는 방향 그대로(돌리지 않음) 모델을 정중앙에, 경계 구가 화면에 들어오는 거리로 0.4초 동안 옮긴다
 * - Homvue 투어(1인칭): 그 자리에서 모델 쪽으로 시선만 돌린다 — 벽을 뚫고 옮기지 않는다
 * Ctrl·Alt·⌘ 와 함께 누르면 무시(Ctrl+Z 되돌리기).
 */
export function FocusSelection() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const anim = useRef<null | { t: number; fromPos: Vector3; toPos: Vector3; fromTarget: Vector3; toTarget: Vector3 }>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 키 위치(code)로 — 한글 입력 상태면 e.key 가 'ㅋ' 이라 Z 가 안 먹었다
      if (e.code !== 'KeyZ') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const id = selectedFocusId();
      if (!id) return;
      let obj: Object3D | null = null;
      scene.traverse((o) => {
        if (!obj && o.userData.focusId === id) obj = o;
      });
      if (!obj) return;
      // 메시가 없는 자리 표시 물체(떼어 내기 전 레벨 메시)는 자기 좌표 상자(focusBox)를 달아 둔다
      const target = obj as Object3D;
      const focusBox = target.userData.focusBox as Box3 | undefined;
      target.updateWorldMatrix(true, false);
      const box = focusBox ? focusBox.clone().applyMatrix4(target.matrixWorld) : new Box3().setFromObject(target);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new Sphere());
      // 조명은 표시 구(지름 0.2~0.4m)만 잡혀 지나치게 다가간다 — 주변이 보이게 최소 반경 1m
      if (id.startsWith('light:')) sphere.radius = Math.max(sphere.radius, 1);
      const center = sphere.center;
      const hv = useHomvueStore.getState();
      const walk = (window as unknown as { __homvueWalk?: { eye: Vector3; tyaw: number; tpitch: number } }).__homvueWalk;
      if (hv.walk && walk) {
        // 투어 — 시선만 모델 쪽으로
        const d = center.clone().sub(walk.eye);
        walk.tyaw = Math.atan2(-d.x, -d.z);
        walk.tpitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        return;
      }
      if (!controls) return;
      // 화면에 꽉 차게 — 세로·가로 시야 중 좁은 쪽에 경계 구가 들어오는 거리(여유 1.25배)
      const vfov = (camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      const fov = Math.min(vfov, hfov);
      const dist = Math.max(0.3, (sphere.radius / Math.sin(fov / 2)) * 1.25);
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.5, 1).normalize();
      // 보던 방향은 그대로 — 카메라를 돌리지 않고 모델을 정중앙에 놓고 거리만 맞춘다(사용자 지시: 회전 없이 줌).
      // 카메라·회전 중심이 같은 방향을 유지한 채 함께 옮겨지므로 움직이는 동안에도 돌지 않는다
      anim.current = {
        t: 0,
        fromPos: camera.position.clone(),
        toPos: center.clone().addScaledVector(dir, dist),
        fromTarget: controls.target.clone(),
        toTarget: center.clone(),
      };
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, scene, controls]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    // 느린 프레임은 1/30초까지만 센다 — 경로 추적에서 래스터로 넘어가는 첫 프레임이 200ms 걸려 0.4초 이동의 절반을
    // 한 번에 건너뛰어 순간이동처럼 보였다(실측)
    a.t = Math.min(1, a.t + Math.min(dt, 1 / 30) / 0.4);
    const k = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

/** 지금 고른 모델의 focusId — 없으면 null */
function selectedFocusId(): string | null {
  const hv = useHomvueStore.getState().selected;
  if (hv) return `homvue:${hv}`;
  const placed = usePlacedProductStore.getState().selectedIds;
  if (placed.length === 1) return `placed:${placed[0]}`;
  const model = useImportedModelStore.getState().selectedId;
  if (model) return `model:${model}`;
  const light = useCustomLightStore.getState().selectedId;
  if (light) return `light:${light}`;
  return null;
}
