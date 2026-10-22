import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, Euler, MathUtils, Raycaster, Vector3, type Mesh, type Object3D, type PerspectiveCamera } from 'three';
import { useViewStore } from '@/engine/stores/viewStore';
import { useHomvueStore } from './homvueStore';
import { isGizmoBusy } from '@/features/models/gizmoGuard';
import { EYE_HEIGHT_CM, FOCUS_PITCH_DEG } from './homvueTravel';

/**
 * Homvue 투어(1인칭) 카메라 — 언리얼 HVPlayer · HVPlayerActionComponent · HVTravelControllerComponent 대응.
 *
 * - 눈높이 1.4m, 가로 시야각 90°(언리얼 FollowCamera) — three.js 는 세로 시야각이라 화면 비율로 환산
 * - WASD·방향키 이동(시선의 수평 방향 기준, Shift 2배), 드래그 둘러보기, 휠 = 눈 위치에서 뒤로 빼기(언리얼 Zoom = 스프링암 길이)
 * - 투어 지점·방 이동 요청이 오면 0.8초 가감속으로 이동(언리얼 TravelTo + MoveCurve)
 * - 벽·가구에 막힘 (언리얼 AddActorWorldOffset 의 sweep) — 무릎·가슴 높이 광선, 부딪히면 벽을 따라 미끄러짐.
 *   그래도 새어 나가지 않게 눈 위치는 아파트 경계 안에 가둔다 (벽을 뚫고 나가면 투어가 끝난 것처럼 보였음)
 * - Esc = 투어 끝 (궤도 카메라로 돌아감)
 *
 * 이동·회전·줌 속도는 언리얼 블루프린트 기본값이라 소스에 숫자가 없다 — 보통 걸음 속도로 둔 값.
 */
const EYE = EYE_HEIGHT_CM / 100;
const UE_HORIZONTAL_FOV = 90;
const WALK_SPEED = 2.5; // m/s
const LOOK_SPEED = 0.004; // rad / px
const ARM_STEP = 0.002; // m / 휠 delta
const MAX_ARM = 3; // m
const TRAVEL_SEC = 0.8;
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
/** 뒤로 뺀 카메라가 벽 앞에서 멈추는 여유 */
const ARM_MARGIN = 0.15;
/** 몸 반지름 — 벽에서 이만큼 떨어져 멈춘다 */
const BODY_RADIUS = 0.25;
/** 충돌 광선 높이(바닥 기준) — 무릎·가슴 */
const RAY_HEIGHTS = [0.4, 1.3];
/**
 * 따라가기 시간 — 마우스·키는 목표값을 바꾸고 카메라가 목표를 따라간다(지수 감쇠, 0 = 바로).
 * 회전·걷기는 0: 0.06초·0.12초로 부드럽게 했더니 「바로바로 적용이 안 된다」(사용자 2026-10-21)로 되돌렸다.
 * 브라우저는 마우스 이동을 화면마다 한 번씩 모아 주므로 바로 반영해도 끊기지 않는다(헤드리스 시험의 16ms 타이머
 * 마우스가 화면과 어긋나 끊겨 보였던 것). 휠로 카메라를 뒤로 빼는 것만 짧게 부드럽게.
 */
const LOOK_SMOOTH_S = 0;
const MOVE_SMOOTH_S = 0;
const ARM_SMOOTH_S = 0.05;
const follow = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

export function HomvueWalkControls() {
  const active = useHomvueStore((s) => s.walk && s.plan !== null);
  return active ? <WalkController /> : null;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function WalkController() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const plan = useHomvueStore((s) => s.plan);
  const ray = useRef(new Raycaster());
  const st = useRef({
    eye: new Vector3(),
    yaw: 0,
    pitch: 0,
    arm: 0,
    /** 목표 — 마우스·휠이 바꾸고 yaw·pitch·arm 이 따라간다 */
    tyaw: 0,
    tpitch: 0,
    tarm: 0,
    /** 걷는 속도(m/s) — 키를 누르면 가속, 떼면 감속 */
    vel: new Vector3(),
    keys: new Set<string>(),
    anim: null as null | { from: Vector3; to: Vector3; t: number; yaw?: [number, number]; pitch?: [number, number] },
    seq: -1,
    roomCheck: 0,
  });
  // 화면 시험용 — 눈 위치·뒤로 뺀 거리 확인
  useEffect(() => {
    (window as unknown as { __homvueWalk?: unknown }).__homvueWalk = st.current;
    return () => {
      delete (window as unknown as { __homvueWalk?: unknown }).__homvueWalk;
    };
  }, []);

  useEffect(() => {
    const s = st.current;
    const prevFov = camera.fov;
    const e = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    s.yaw = s.tyaw = e.y;
    s.pitch = s.tpitch = 0;
    s.eye.set(camera.position.x, useHomvueStore.getState().offset[1] + EYE, camera.position.z);

    // 화각 — 기본은 언리얼 카메라(가로 화각 고정, 창 비율 따라 세로 환산). 투어 중에 조명·렌더 패널 「카메라 화각」을
    // 움직이면 그 값(세로)을 따른다 — 둘러보기를 끝내면 원래 화각으로
    let userFov = false;
    const applyFov = () => {
      if (userFov) camera.fov = useViewStore.getState().cameraFov;
      else {
        const h = MathUtils.degToRad(UE_HORIZONTAL_FOV);
        camera.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / camera.aspect));
      }
      camera.updateProjectionMatrix();
    };
    applyFov();
    const offFov = useViewStore.subscribe((v, p) => {
      if (v.cameraFov === p.cameraFov) return;
      userFov = true;
      applyFov();
    });

    const el = gl.domElement;
    // 끌기 시작 문턱 4px — 클릭(선택) 판정과 같다. 문턱 없이 돌리면 클릭할 때 손 떨림 1~2px 로도 시점이 돌아
    // 경로 추적이 매번 처음부터 다시 쌓였다(사용자 보고 「선택할 때마다 샘플링 리셋」)
    let drag: { x: number; y: number; sx: number; sy: number; on: boolean } | null = null;
    const onDown = (ev: PointerEvent) => {
      if (isGizmoBusy()) return; // 기즈모 손잡이를 잡았다 — 시점을 돌리지 않는다
      if (ev.button === 0 || ev.button === 2) drag = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, on: false };
    };
    const onMove = (ev: PointerEvent) => {
      if (!drag) return;
      if (!drag.on && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) <= 4) return;
      drag.on = true;
      s.tyaw -= (ev.clientX - drag.x) * LOOK_SPEED;
      s.tpitch = MathUtils.clamp(s.tpitch - (ev.clientY - drag.y) * LOOK_SPEED, -1.4, 1.4);
      drag.x = ev.clientX;
      drag.y = ev.clientY;
    };
    const onUp = () => {
      drag = null;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      s.tarm = MathUtils.clamp(s.tarm + ev.deltaY * ARM_STEP, 0, MAX_ARM);
    };
    const onKey = (pressed: boolean) => (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = ev.key.toLowerCase();
      if (pressed && k === 'escape') {
        useHomvueStore.getState().setWalk(false);
        return;
      }
      if (!MOVE_KEYS.includes(k)) return;
      if (pressed) s.keys.add(k);
      else s.keys.delete(k);
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    const onBlur = () => s.keys.clear();

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', applyFov);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', applyFov);
      offFov();
      camera.fov = userFov ? useViewStore.getState().cameraFov : prevFov;
      camera.updateProjectionMatrix();
    };
  }, [camera, gl]);

  useFrame((_, dt) => {
    const s = st.current;
    const { travel, offset } = useHomvueStore.getState();
    if (travel && travel.seq !== s.seq) {
      s.seq = travel.seq;
      const [x, , z] = travel.target;
      s.anim = { from: s.eye.clone(), to: new Vector3(x, offset[1] + EYE, z), t: 0 };
      if (travel.look) {
        // 언리얼 FocusRoom: 수평 방향으로 캡처 지점을 보고 고개 10° 숙임. 가까운 쪽으로 돌도록 각도 차를 ±π 로
        const dx = travel.look[0] - x;
        const dz = travel.look[2] - z;
        if (dx * dx + dz * dz > 1e-6) {
          const target = Math.atan2(-dx, -dz);
          const diff = MathUtils.euclideanModulo(target - s.yaw + Math.PI, Math.PI * 2) - Math.PI;
          s.anim.yaw = [s.yaw, s.yaw + diff];
          s.anim.pitch = [s.pitch, MathUtils.degToRad(FOCUS_PITCH_DEG)];
        }
      }
    }

    if (s.anim) {
      s.anim.t = Math.min(1, s.anim.t + dt / TRAVEL_SEC);
      const k = ease(s.anim.t);
      s.eye.lerpVectors(s.anim.from, s.anim.to, k);
      if (s.anim.yaw) s.yaw = s.tyaw = MathUtils.lerp(s.anim.yaw[0], s.anim.yaw[1], k);
      if (s.anim.pitch) s.pitch = s.tpitch = MathUtils.lerp(s.anim.pitch[0], s.anim.pitch[1], k);
      s.vel.set(0, 0, 0);
      if (s.anim.t >= 1) s.anim = null;
    } else {
      const k = s.keys;
      const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      // 시선의 수평 방향 기준 (언리얼 Move: 컨트롤 회전의 Yaw 만)
      const want = new Vector3(-Math.sin(s.tyaw) * fwd + Math.cos(s.tyaw) * side, 0, -Math.cos(s.tyaw) * fwd - Math.sin(s.tyaw) * side);
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(WALK_SPEED * (k.has('shift') ? 2 : 1));
      s.vel.lerp(want, follow(dt, MOVE_SMOOTH_S));
      if (s.vel.lengthSq() < 1e-6) s.vel.set(0, 0, 0);
      const move = s.vel.clone().multiplyScalar(dt);
      if (move.lengthSq() > 0) {
        const blockers = collidables(scene, plan?.id);
        const floorY = useHomvueStore.getState().offset[1];
        // 정면이 막히면 x·z 축으로 나눠 다시 시도 — 벽을 따라 미끄러진다
        let moved = false;
        for (const tryMove of [move, new Vector3(move.x, 0, 0), new Vector3(0, 0, move.z)]) {
          if (tryMove.lengthSq() === 0 || blocked(ray.current, blockers, s.eye, floorY, tryMove)) continue;
          s.eye.add(tryMove);
          moved = true;
          break;
        }
        if (!moved) s.vel.set(0, 0, 0); // 벽에 막히면 그 자리에 선다(밀던 속도를 남기지 않음)
        const bounds = apartmentBounds(scene, plan?.id);
        if (bounds) {
          s.eye.x = MathUtils.clamp(s.eye.x, bounds.min.x + BODY_RADIUS, bounds.max.x - BODY_RADIUS);
          s.eye.z = MathUtils.clamp(s.eye.z, bounds.min.z + BODY_RADIUS, bounds.max.z - BODY_RADIUS);
        }
      }
    }

    if (!s.anim) {
      const a = follow(dt, LOOK_SMOOTH_S);
      s.yaw += (s.tyaw - s.yaw) * a;
      s.pitch += (s.tpitch - s.pitch) * a;
      // 거의 다 따라왔으면 맞춰 끝낸다 — 미세하게 계속 움직이면 경로 추적이 멈춘 것으로 보지 않는다
      if (Math.abs(s.tyaw - s.yaw) < 1e-5) s.yaw = s.tyaw;
      if (Math.abs(s.tpitch - s.pitch) < 1e-5) s.pitch = s.tpitch;
    }
    s.arm += (s.tarm - s.arm) * follow(dt, ARM_SMOOTH_S);
    if (Math.abs(s.tarm - s.arm) < 1e-4) s.arm = s.tarm;
    const look = new Vector3(-Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch));
    // 뒤로 빼기(스프링암) 충돌 — 언리얼 CameraBoom bDoCollisionTest. 없으면 카메라가 벽을 통과해 옆방이 보인다
    let arm = s.arm;
    if (arm > 0) {
      const back = look.clone().negate();
      ray.current.set(s.eye, back);
      ray.current.far = arm + ARM_MARGIN;
      const hit = ray.current.intersectObjects(collidables(scene, plan?.id), false)[0];
      if (hit) arm = Math.max(0, hit.distance - ARM_MARGIN);
    }
    camera.position.copy(s.eye).addScaledVector(look, -arm);
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');

    // 지금 방 — 눈 아래 바닥이 어느 방 것인지(언리얼 CurrentTraveledRoomMaster). 0.25초마다
    s.roomCheck += dt;
    if (s.roomCheck > 0.25) {
      s.roomCheck = 0;
      const room = roomUnder(ray.current, scene, plan?.id, s.eye);
      if (room && room !== useHomvueStore.getState().currentRoom) useHomvueStore.setState({ currentRoom: room });
    }
  });

  return null;
}

/** 충돌 대상 목록은 메시가 2,000개 가까이 되어 매 프레임 새로 모으지 않고 1초마다 갱신한다 */
let _collCache: { key: string; at: number; list: Mesh[] } | null = null;
function collidables(scene: Object3D, planId: string | undefined): Mesh[] {
  const now = performance.now();
  const key = `${planId}:${useHomvueStore.getState().showCeiling}`;
  if (_collCache && _collCache.key === key && now - _collCache.at < 1000) return _collCache.list;
  const list = collectCollidables(scene, planId);
  _collCache = { key, at: now, list };
  return list;
}

/** 충돌 대상 — 조립된 평면의 메시 중 천장·투어 지점(표시용)을 뺀 것 */
function collectCollidables(scene: Object3D, planId: string | undefined): Mesh[] {
  const root = planId ? scene.getObjectByName(`homvue:${planId}`) : undefined;
  const out: Mesh[] = [];
  root?.traverse((o) => {
    if (o.name === 'homvue:travel') return;
    const m = o as Mesh;
    if (!m.isMesh || !m.visible) return;
    out.push(m);
  });
  return out.filter((m) => {
    let p: Object3D | null = m;
    while (p) {
      if (p.name === 'homvue:travel' || !p.visible) return false; // 천장은 숨김 상태면 visible=false
      p = p.parent;
    }
    return true;
  });
}

function blocked(rc: Raycaster, meshes: Mesh[], eye: Vector3, floorY: number, move: Vector3): boolean {
  const dir = move.clone().normalize();
  rc.far = move.length() + BODY_RADIUS;
  for (const h of RAY_HEIGHTS) {
    rc.set(new Vector3(eye.x, floorY + h, eye.z), dir);
    if (rc.intersectObjects(meshes, false).length) return true;
  }
  return false;
}

/** 아파트 경계(천장 제외) — 장면 좌표. 걷는 동안 매 프레임 부품 수천 개를 훑지 않게 1초마다 */
let _boundsCache: { key: string; at: number; box: Box3 | null } | null = null;
function apartmentBounds(scene: Object3D, planId: string | undefined): Box3 | null {
  const now = performance.now();
  if (_boundsCache && _boundsCache.key === planId && now - _boundsCache.at < 1000) return _boundsCache.box;
  const box = computeBounds(scene, planId);
  _boundsCache = { key: planId ?? '', at: now, box };
  return box;
}
function computeBounds(scene: Object3D, planId: string | undefined): Box3 | null {
  const root = planId ? scene.getObjectByName(`homvue:${planId}`) : undefined;
  if (!root) return null;
  const box = new Box3();
  root.traverse((o) => {
    const h = o.userData?.homvue as { blueprint?: string } | undefined;
    if (h?.blueprint?.includes('/APT/') && !/cell?ing/i.test(h.blueprint)) box.expandByObject(o);
  });
  return box.isEmpty() ? null : box;
}

/** 눈 위치 바로 아래 바닥이 속한 방 (바닥 부품에 붙인 homvueFloorRoom) */
function roomUnder(rc: Raycaster, scene: Object3D, planId: string | undefined, eye: Vector3): string | null {
  const root = planId ? scene.getObjectByName(`homvue:${planId}`) : undefined;
  if (!root) return null;
  const floors: Object3D[] = [];
  root.traverse((o) => {
    if (o.userData?.homvueFloorRoom) floors.push(o);
  });
  rc.set(eye, new Vector3(0, -1, 0));
  rc.far = 3;
  const hit = rc.intersectObjects(floors, true)[0];
  let p: Object3D | null = hit?.object ?? null;
  while (p && !p.userData?.homvueFloorRoom) p = p.parent;
  return (p?.userData.homvueFloorRoom as string | undefined) ?? null;
}
