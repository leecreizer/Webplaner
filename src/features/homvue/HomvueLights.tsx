import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Box3, Color, Matrix4, Object3D, Quaternion, Vector3, type Light, type SpotLight } from 'three';
import { isGizmoBusy } from '@/features/models/gizmoGuard';
import { homvueGizmoState, homvueProductObjects } from './HomvueGizmo';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { useHomvueStore } from './homvueStore';
import type { HomvueLight } from './homvueAssets';
import { matrixToUeTransform, ueTransformToMatrix } from './ueTransform';

RectAreaLightUniformsLib.init();

/**
 * 실내 조명 — 언리얼 평면 기본 레벨의 RectLight · SpotLight (data/light-info.json). 태양은 홈플래너3 것을 쓴다.
 *
 * 물리량 환산 (언리얼 Lumens 단위):
 * - 사각 조명: 휘도 L = Φ / (π · 면적)   — 한쪽으로 고르게 퍼지는 면광원
 * - 스포트:    광도 I = Φ / (2π · (1 − cos 바깥각))
 * 언리얼은 카메라 노출(EV)로 화면 밝기를 맞추므로 절대값은 그대로 쓸 수 없다 — 조명끼리의 비율은 원본대로 두고
 * 전체 배율(lightScale, 패널 「실내 조명」)만 맞춘다. 기본 1 = 언리얼 값 그대로 — 밝기는 평면의 언리얼 노출이 맞춘다(homvueEnvironment).
 * (예전 기본 3 은 노출 없이 조명만 키워 맞춘 값이었다 — 43 의 언리얼 노출 ×2.7 과 비슷)
 *
 * 방향: 언리얼 조명은 자기 +X 쪽으로 빛을 낸다. 사각 조명의 가로 = 자기 Y, 세로 = 자기 Z.
 *
 * 래스터는 카메라에 가까운 조명만 — 사각 {@link RASTER_RECT}개 · 스포트 {@link RASTER_SPOT}개 (경로 추적은 전부).
 * three.js 래스터는 장면의 모든 조명을 모든 재질 셰이더에 넣는다. 84A 는 38개라 셰이더 컴파일이 조명 없을 때의
 * 약 5배(평면을 열 때 멈춘 시간 합 10.7초 ↔ 2.2초, 실측)였고 그리는 것도 무거웠다. 고르는 조명이 바뀌어도
 * **개수는 늘 같게** 둔다 — 개수가 바뀌면 모든 셰이더를 다시 컴파일한다.
 * 뺀 조명은 `userData.rasterSkip` 표시 — 래스터 모드에선 숨기고, 경로 추적 모드에선 보이게 두되 래스터로 그릴 때만
 * 잠시 숨긴다(MutracerRenderer OverlayPass·HomvueApartment 미리 컴파일).
 */
const RASTER_RECT = 4;
const RASTER_SPOT = 8;
const POOL_EVERY_S = 0.5;
export function HomvueLights({ lights }: { lights: HomvueLight[] }) {
  const scale = useHomvueStore((s) => s.lightScale);
  // 편집 패널(HomvueInspector)에서 고친 값 — 조명 번호(원래 목록 순서)로 덮는다
  const edits = useHomvueStore((s) => s.lightEdits);
  // 천장 위 100m×100m 채움 조명(RectLight7 · Top_RectLight)은 뺀다 — 언리얼에서는 천장이 그림자로 막아 실내에 닿지 않는데
  // (투어 중 천장은 항상 보임: HVPlayer::CheckCameraOutPlan 호출이 꺼져 있음) 웹 사각 조명은 그림자가 없어 천장을 뚫고 비춘다
  const indoor = lights
    .map((l, index) => ({ l: edits[index] ? { ...l, ...edits[index] } : l, index }))
    .filter(({ l }) => !(l.kind === 'rect' && (l.width_cm ?? 0) * (l.height_cm ?? 0) > 100 * 100 * 100));
  const group = useRef<Object3D>(null);
  const mutracer = useLightingStore((s) => s.giMode === 'mutracer');
  const camera = useThree((s) => s.camera);
  const acc = useRef(0);
  const choose = () => {
    if (!group.current) return;
    const eye = camera.getWorldPosition(new Vector3());
    const pick = (list: Light[], k: number) => {
      const sorted = list
        .map((l) => ({ l, d: l.getWorldPosition(new Vector3()).distanceToSquared(eye) }))
        .sort((a, b) => a.d - b.d);
      sorted.forEach(({ l }, i) => {
        l.userData.rasterSkip = i >= k;
        l.visible = mutracer || i < k;
      });
    };
    const rects: Light[] = [];
    const spots: Light[] = [];
    group.current.traverse((o) => {
      if ((o as { isRectAreaLight?: boolean }).isRectAreaLight) rects.push(o as Light);
      else if ((o as { isSpotLight?: boolean }).isSpotLight) spots.push(o as Light);
    });
    pick(rects, RASTER_RECT);
    pick(spots, RASTER_SPOT);
  };
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < POOL_EVERY_S) return;
    acc.current = 0;
    choose();
  });
  // 처음(부품 셰이더 미리 컴파일보다 먼저 — 레이아웃 단계)과 모드가 바뀔 때 바로 고른다
  useLayoutEffect(choose, [mutracer, camera, lights]);
  return (
    <group ref={group} name="homvue:lights">
      {indoor.map(({ l, index }) => (
        <group key={index}>
          {l.kind === 'rect' ? <RectLight l={l} scale={scale} /> : <Spot l={l} scale={scale} />}
          <LightHandle l={l} index={index} />
        </group>
      ))}
    </group>
  );
}

/**
 * 조명 손잡이 — 기즈모·편집 패널 대상(key `light:<번호>`). 축 = 언리얼 조명 축(x = 빛 방향 +X, y = 위 +Z)이라
 * 놓을 때 행렬을 그대로 언리얼 위치·회전으로 바꿔 저장한다(조명 자체는 저장된 값으로 다시 그려진다).
 * 「조명 위치 표시」를 켜면 작은 점이 보이고 누르면 고른다.
 */
const HANDLE_BOX = new Box3(new Vector3(-0.12, -0.12, -0.12), new Vector3(0.12, 0.12, 0.12));
function LightHandle({ l, index }: { l: HomvueLight; index: number }) {
  const handle = useMemo(() => new Object3D(), []);
  const showMarker = useHomvueStore((s) => s.showLightMarkers);
  const selected = useHomvueStore((s) => s.selected === `light:${index}`);
  const { pos, dir, up } = basis(l);
  handle.position.copy(pos);
  handle.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(dir, up, dir.clone().cross(up)));
  handle.scale.set(1, 1, 1);
  handle.updateMatrix();
  useEffect(() => {
    const key = `light:${index}`;
    const save = () => {
      handle.updateMatrix();
      const ue = matrixToUeTransform(handle.matrix);
      useHomvueStore.getState().setLightEdit(index, { location_cm: ue.location_cm, rotation_deg: ue.rotation_deg });
    };
    handle.userData.focusId = `homvue:${key}`;
    homvueProductObjects.set(key, { obj: handle, localBox: HANDLE_BOX, onChange: save, onCommit: save, label: `${l.kind === 'rect' ? '사각' : '스포트'} 조명 · ${l.actor}` });
    return () => {
      if (homvueProductObjects.get(key)?.obj === handle) homvueProductObjects.delete(key);
    };
  }, [handle, index, l.kind, l.actor]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || isGizmoBusy() || homvueGizmoState.dragging) return;
    e.stopPropagation();
    useHomvueStore.getState().select(`light:${index}`);
  };
  return (
    <primitive object={handle}>
      {(showMarker || selected) && (
        // 발광 재질 — 경로 추적 장면에 들어가지 않고 위에 덧그려진다
        <mesh onClick={onClick} renderOrder={20}>
          <sphereGeometry args={[0.06, 12, 8]} />
          <meshBasicMaterial color={selected ? '#facc15' : l.kind === 'rect' ? '#38bdf8' : '#fb923c'} depthTest={false} transparent opacity={0.9} />
        </mesh>
      )}
    </primitive>
  );
}

function basis(l: HomvueLight) {
  const m = ueTransformToMatrix(l.location_cm, l.rotation_deg);
  const pos = new Vector3().setFromMatrixPosition(m);
  const dir = new Vector3(1, 0, 0).transformDirection(m); // 언리얼 +X
  const up = new Vector3(0, 1, 0).transformDirection(m); // 언리얼 +Z (웹 y)
  return { pos, dir, up };
}

function lightColor(l: HomvueLight) {
  const c = l.color ? new Color(l.color[0] / 255, l.color[1] / 255, l.color[2] / 255) : new Color(1, 1, 1);
  if (l.temperature) c.multiply(kelvinToColor(l.temperature));
  return c;
}

function RectLight({ l, scale }: { l: HomvueLight; scale: number }) {
  const { pos, quat, w, h, nits, color } = useMemo(() => {
    const { pos, dir, up } = basis(l);
    // 빛이 나가는 쪽이 -Z 가 되도록(three 조명 규칙) 축을 세운다
    const z = dir.clone().negate();
    const x = new Vector3().crossVectors(up, z).normalize();
    const y = new Vector3().crossVectors(z, x).normalize();
    const quat = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    const w = (l.width_cm ?? 100) / 100;
    const h = (l.height_cm ?? 100) / 100;
    const nits = l.units === 'lumens' ? (l.intensity ?? 0) / (Math.PI * w * h) : (l.intensity ?? 0) / (w * h);
    return { pos, quat, w, h, nits, color: lightColor(l) };
  }, [l]);
  return <rectAreaLight position={pos} quaternion={quat} width={w} height={h} intensity={nits * scale} color={color} />;
}

function Spot({ l, scale }: { l: HomvueLight; scale: number }) {
  const ref = useRef<SpotLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const { pos, aim, angle, penumbra, cd, color, distance } = useMemo(() => {
    const { pos, dir } = basis(l);
    const outer = Math.min(89, l.outer_deg ?? 44) * (Math.PI / 180);
    const inner = Math.min(l.inner_deg ?? 0, l.outer_deg ?? 44) * (Math.PI / 180);
    const cd = l.units === 'lumens' ? (l.intensity ?? 0) / (2 * Math.PI * (1 - Math.cos(outer))) : (l.intensity ?? 0);
    return {
      pos, aim: pos.clone().add(dir), angle: outer, penumbra: outer > 0 ? 1 - inner / outer : 0, cd,
      color: lightColor(l), distance: l.radius_cm ? l.radius_cm / 100 : 0,
    };
  }, [l]);
  useLayoutEffect(() => {
    target.position.copy(aim);
    target.updateMatrixWorld();
    if (ref.current) ref.current.target = target;
  }, [aim, target]);
  return (
    <>
      <primitive object={target} />
      <spotLight ref={ref} position={pos} angle={angle} penumbra={penumbra} intensity={cd * scale} color={color} distance={distance} decay={2} />
    </>
  );
}

/** 색온도(K) → RGB (Tanner Helland 근사) */
export function kelvinToColor(k: number): Color {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new Color(c(r), c(g), c(b));
}
