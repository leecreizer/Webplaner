import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Euler,
  Mesh,
  Object3D,
  PointLightHelper,
  SpotLightHelper,
  Vector3,
  type PointLight,
  type RectAreaLight,
  type SpotLight,
  BufferGeometry,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  SphereGeometry,
} from 'three';
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import { Line, TransformControls } from '@react-three/drei';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { useCustomLightStore, type CustomLight } from '@/engine/stores/customLightStore';
import { useLightingStore, shadowMapSizeFor } from '@/engine/stores/lightingStore';
import { isGizmoBusy, registerGizmo } from '@/features/models/gizmoGuard';

// RectAreaLight 사용을 위해 한 번 초기화 (uniforms 등록)
RectAreaLightUniformsLib.init();

/**
 * `customLightStore.lights` 배열을 구독해 동적으로 라이트들을 r3f 씬에 mount.
 *
 * - 각 라이트는 위치 마커 sphere를 가지며, 마커를 클릭하면 store의 `selectedId`가 설정됨.
 * - **선택된 라이트는 `<TransformControls>`(translate 모드)로 마우스 드래그 이동 가능** —
 *   드래그 종료 시 새 position을 store에 반영.
 * - 마커 위 hover/선택 색 분기: 일반 노랑 / hover 주황 / 선택 시안.
 */
export function CustomLights() {
  const lights = useCustomLightStore((s) => s.lights);
  const selectedId = useCustomLightStore((s) => s.selectedId);

  return (
    <group>
      {lights.map((l) => (
        <CustomLightInstance key={l.id} light={l} selected={l.id === selectedId} />
      ))}
    </group>
  );
}

function CustomLightInstance({ light: l, selected }: { light: CustomLight; selected: boolean }) {
  const select = useCustomLightStore((s) => s.select);
  const update = useCustomLightStore((s) => s.update);
  // 전역 그림자 품질 → mapSize (low=1024, medium=2048, high=4096, ultra=8192).
  // 1024 는 가장자리 계단 현상이 심함 — 디폴트 'high'(4096)로 큰 향상.
  const shadowQuality = useLightingStore((s) => s.shadowQuality);
  const mapSize = shadowMapSizeFor(shadowQuality);
  const markerRef = useRef<Mesh>(null);
  const tcRef = useRef<{ axis: string | null; dragging: boolean } | null>(null);
  // 기즈모 모드 — 홈플래너3 다른 기즈모와 같은 키(R 회전 · G/T 이동), 편집 패널 버튼과 같은 값(저장소).
  // 끝점(target)은 스포트만 — 비추는 점을 옮긴다. 다른 조명에선 이동으로 본다
  const storeMode = useCustomLightStore((s) => s.gizmoMode);
  const setGizmoMode = useCustomLightStore((s) => s.setGizmoMode);
  const gizmoMode = storeMode === 'target' && l.kind !== 'spot' ? 'translate' : storeMode;
  const targetRef = useRef<Mesh>(null);
  // 스포트가 지금 비추는 점(회전이 있으면 그 방향·예전 거리, 없으면 target)
  const aim = l.kind === 'spot' ? spotAim(l) : null;
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // 키 위치(code)로 — 한글 입력 상태면 e.key 가 ㄱ·ㅎ·ㅅ 으로 들어와 단축키가 안 먹었다
      if (e.code === 'KeyR') setGizmoMode('rotate');
      if (e.code === 'KeyG' || e.code === 'KeyT') setGizmoMode('translate');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);
  // 기즈모 가드 등록 — 손잡이 위·끄는 중엔 다른 물체 선택 금지
  useEffect(() => {
    if (!tcRef.current) return;
    return registerGizmo(tcRef.current);
  });
  // 마커 회전 = 조명 회전(기즈모 회전 손잡이가 마커를 돌린다) — 모든 조명
  useEffect(() => {
    if (!markerRef.current) return;
    const r = lightRotation(l);
    markerRef.current.rotation.set(r[0], r[1], r[2]);
  }, [l]);

  // store의 position 변경을 mesh에 동기화 (외부에서 position이 변경된 경우 — 예: 패널 슬라이더)
  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.position.set(l.position[0], l.position[1], l.position[2]);
    }
  }, [l.position]);

  const markerColor = selected ? '#22d3ee' : '#fbbf24';
  const markerSize = selected ? 0.18 : 0.12;

  return (
    <group>
      {/* 라이트 본체 */}
      {l.kind === 'point' && (
        <PointLightInstance light={l} selected={selected} mapSize={mapSize} />
      )}
      {l.kind === 'spot' && <SpotWithTarget light={l} selected={selected} mapSize={mapSize} />}
      {l.kind === 'rect' && <RectLightInstance light={l} selected={selected} />}
      {/* 영역 표시 — 고른 조명만: 사각 = 퍼짐 각도로 벌어지는 사각뿔대, 스포트 = 콘, 점 = 구. 길이·반지름 = 도달 거리 */}
      {selected && <LightReach light={l} />}
      {l.kind === 'hemisphere' && (
        <hemisphereLight
          position={hemiSkyDir(l)}
          color={l.color}
          groundColor={l.groundColor ?? '#404040'}
          intensity={l.intensity}
        />
      )}

      {/* 위치 마커 — 클릭으로 선택 토글, 선택 시 시각 강조 */}
      <mesh
        ref={markerRef}
        position={l.position}
        userData={{ focusId: `light:${l.id}` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // 기즈모 핸들 조작 중이면 선택 가로채기 금지 (핸들 뒤 메시 오선택 방지)
          if (isGizmoBusy()) return;
          e.stopPropagation();
          select(selected ? null : l.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <sphereGeometry args={[markerSize, 14, 14]} />
        <meshBasicMaterial color={markerColor} depthTest={false} transparent opacity={0.95} />
      </mesh>

      {/* 스포트 끝점 — 비추는 점과 이어 주는 선. 점을 누르거나 패널 「끝점」이면 기즈모가 이 점을 옮긴다 */}
      {selected && aim && (
        <>
          <Line points={[l.position, aim]} color="#f472b6" lineWidth={1.5} dashed dashSize={0.1} gapSize={0.06} />
          <mesh
            ref={targetRef}
            position={aim}
            onPointerDown={(e) => {
              if (e.button !== 0 || isGizmoBusy()) return;
              e.stopPropagation();
              setGizmoMode('target');
            }}
          >
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshBasicMaterial color="#f472b6" depthTest={false} transparent opacity={0.95} />
          </mesh>
        </>
      )}

      {/* 선택 시 TransformControls. 마커가 대상(끝점 모드면 스포트 끝점). R = 회전 · G/T = 이동 (모든 조명) */}
      {selected && markerRef.current && (gizmoMode !== 'target' || targetRef.current) && (
        <TransformControls
          ref={tcRef as never}
          key={`light-gizmo-${l.id}-${gizmoMode}`}
          object={gizmoMode === 'target' ? targetRef.current! : markerRef.current}
          mode={gizmoMode === 'rotate' ? 'rotate' : 'translate'}
          space={gizmoMode === 'rotate' ? 'local' : 'world'}
          size={0.7}
          onObjectChange={() => {
            if (gizmoMode === 'target') {
              // 끝점을 옮기면 회전은 버리고 target 이 방향을 정한다
              const t = targetRef.current!.position;
              update(l.id, { target: [t.x, t.y, t.z], rotation: undefined });
              return;
            }
            const m = markerRef.current!;
            if (gizmoMode === 'rotate') update(l.id, { rotation: [m.rotation.x, m.rotation.y, m.rotation.z] });
            else update(l.id, { position: [m.position.x, m.position.y, m.position.z] });
          }}
        />
      )}
    </group>
  );
}

/** 사각 조명 기본 방향 — 아래(-Y)를 향함. three RectAreaLight 는 자기 -Z 쪽으로 빛을 낸다 */
const RECT_DOWN: [number, number, number] = [-Math.PI / 2, 0, 0];

/**
 * 조명 회전(라디안) — 값이 없으면 종류별 기본: 사각 아래 · 스포트는 target 쪽을 -Z 로 · 나머지 0.
 * 패널 회전 슬라이더와 기즈모 마커가 같은 값을 쓴다.
 */
export function lightRotation(l: CustomLight): [number, number, number] {
  if (l.rotation) return l.rotation;
  if (l.kind === 'rect') return RECT_DOWN;
  if (l.kind === 'spot' && l.target) {
    // -Z 가 target 을 향하도록 — Object3D.lookAt 은 +Z 를 향하게 하므로 반대쪽 점을 본다
    const o = new Object3D();
    o.position.set(...l.position);
    const t = new Vector3(...l.target);
    o.lookAt(o.position.clone().multiplyScalar(2).sub(t));
    return [o.rotation.x, o.rotation.y, o.rotation.z];
  }
  return [0, 0, 0];
}

const REACH_FILL = { color: '#facc15', transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide } as const;
const REACH_EDGE = '#facc15';
const noRaycast = () => null;

/**
 * 조명 영역 표시(고른 조명만) — 퍼짐·도달 거리를 눈으로 본다.
 * - 사각: 면에서 빛 방향(-Z)으로 퍼짐 각도(퍼짐 1 = 90°, 그리기는 80° 까지)만큼 벌어지는 사각뿔대, 길이 = 도달 거리(기본 3m)
 * - 스포트: 콘 각도·도달 거리의 원뿔 · 점: 도달 거리 반지름의 구
 * 경로 추적은 실제 빛처럼 거리 제곱으로 약해질 뿐 끊기지 않는다 — 도달 거리는 래스터의 끊는 거리이자 눈대중용 표시다
 * 발광 재질(MeshBasic)이라 경로 추적 장면엔 안 들어가고 위에 덧그려진다. 클릭은 통과
 */
function LightReach({ light: l }: { light: CustomLight }) {
  const L = l.distance && l.distance > 0 ? l.distance : 3;
  const geo = useMemo(() => {
    if (l.kind === 'rect') {
      const w = (l.width ?? 2) / 2, h = (l.height ?? 1) / 2;
      const ex = L * Math.tan((Math.min(80, (l.spread ?? 1) * 90) * Math.PI) / 180);
      const W = w + ex, H = h + ex;
      const n = [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]];
      const f = [[-W, -H, -L], [W, -H, -L], [W, H, -L], [-W, H, -L]];
      const pos: number[] = [];
      const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < 4; i++) quad(n[i], n[(i + 1) % 4], f[(i + 1) % 4], f[i]);
      quad(f[0], f[1], f[2], f[3]);
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      const edges: [number, number, number][] = [];
      for (let i = 0; i < 4; i++) edges.push(n[i] as never, f[i] as never, f[i] as never, f[(i + 1) % 4] as never);
      return { fill: g, edges };
    }
    if (l.kind === 'spot') {
      const r = L * Math.tan(l.angle ?? Math.PI / 6);
      const g = new ConeGeometry(r, L, 48, 1, true);
      g.translate(0, -L / 2, 0); // 꼭짓점을 원점(조명)에
      g.rotateX(Math.PI / 2); // 밑면을 -Z(빛 방향)로
      return { fill: g, edges: [] as [number, number, number][] };
    }
    if (l.kind === 'point') return { fill: new SphereGeometry(L, 32, 16), edges: [] as [number, number, number][] };
    return null;
  }, [l.kind, l.width, l.height, l.spread, l.angle, L]);
  useEffect(() => () => geo?.fill.dispose(), [geo]);
  if (!geo) return null;
  const rot = l.kind === 'point' ? ([0, 0, 0] as [number, number, number]) : lightRotation(l);
  return (
    <group position={l.position} rotation={rot}>
      <mesh geometry={geo.fill} raycast={noRaycast}>
        <meshBasicMaterial {...REACH_FILL} />
      </mesh>
      {geo.edges.length > 0 && <Line points={geo.edges} segments color={REACH_EDGE} lineWidth={1} transparent opacity={0.8} />}
      {l.kind === 'point' && (
        <mesh geometry={geo.fill} raycast={noRaycast}>
          <meshBasicMaterial color={REACH_EDGE} wireframe transparent opacity={0.15} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** 스포트가 비추는 점 — 회전이 있으면 그 방향으로 예전 target 거리(없으면 2m), 없으면 target */
export function spotAim(l: CustomLight): [number, number, number] {
  if (!l.rotation) return l.target ?? [0, 0, 0];
  const p = new Vector3(...l.position);
  const d = l.target ? Math.max(0.5, p.distanceTo(new Vector3(...l.target))) : 2;
  return p.addScaledVector(lightForward(l), d).toArray() as [number, number, number];
}

/** 회전으로 정한 빛 방향(-Z) 단위 벡터 */
function lightForward(l: CustomLight): Vector3 {
  const [x, y, z] = lightRotation(l);
  return new Vector3(0, 0, -1).applyEuler(new Euler(x, y, z));
}

/** 반구 조명의 하늘 방향 — three HemisphereLight 는 position 을 하늘 쪽 방향으로 쓴다. 기본 위(+Y)를 회전 */
function hemiSkyDir(l: CustomLight): [number, number, number] {
  const [x, y, z] = l.rotation ?? [0, 0, 0];
  const v = new Vector3(0, 1, 0).applyEuler(new Euler(x, y, z));
  return [v.x, v.y, v.z];
}

/**
 * 사각(면) 조명 — 회전 포함. 선택하면 빛이 나가는 면을 보여 준다(RectAreaLightHelper).
 * 예전엔 회전 값이 없어 늘 정면(수평)으로만 빛을 냈다(사용자 보고 「조명에 회전이 없네」).
 */
function RectLightInstance({ light: l, selected }: { light: CustomLight; selected: boolean }) {
  const ref = useRef<RectAreaLight>(null);
  const r = l.rotation ?? RECT_DOWN;
  useEffect(() => {
    if (!selected || !ref.current) return;
    const helper = new RectAreaLightHelper(ref.current, '#22d3ee');
    ref.current.add(helper);
    return () => {
      helper.removeFromParent();
      helper.dispose();
    };
  }, [selected]);
  // 퍼짐 — three RectAreaLight 엔 없는 값이라 userData 로 경로 추적(MutracerRenderer convertLight)에 넘긴다.
  // 경로 추적은 조명을 버전이 바뀔 때만 다시 변환하므로 값이 바뀔 때마다 버전을 올린다
  useEffect(() => {
    const o = ref.current;
    if (!o) return;
    o.userData.mutracerSpread = l.spread ?? 1;
    o.userData.mutracerVersion = ((o.userData.mutracerVersion as number | undefined) ?? 0) + 1;
  }, [l]);
  return (
    <rectAreaLight
      ref={ref}
      position={l.position}
      rotation={r}
      color={l.color}
      intensity={l.intensity}
      width={l.width ?? 2}
      height={l.height ?? 1}
    />
  );
}

/** PointLight + 선택 시 PointLightHelper 자동 시각화 + shadow.autoUpdate 옵션. */
function PointLightInstance({
  light: l,
  selected,
  mapSize,
}: {
  light: CustomLight;
  selected: boolean;
  mapSize: number;
}) {
  const ref = useRef<PointLight>(null);
  const { scene } = useThree();
  // 선택 시 PointLightHelper 추가
  useEffect(() => {
    if (!selected || !ref.current) return;
    const helper = new PointLightHelper(ref.current, 0.2, '#22d3ee');
    scene.add(helper);
    return () => {
      scene.remove(helper);
      helper.dispose();
    };
  }, [selected, scene]);
  // shadow.autoUpdate 라이브 적용 — false 면 light 변경되어도 shadow 캐싱 유지
  useEffect(() => {
    if (ref.current) ref.current.shadow.autoUpdate = l.shadowAutoUpdate ?? true;
  }, [l.shadowAutoUpdate]);
  // light.radius — gkjohnson path tracer 가 point/spot 의 소프트 그림자에 직접 사용.
  // raster shadow-radius 와 별개로 *PT* 그림자 부드러움을 결정. shadowRadius 슬라이더 공유.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (ref.current) (ref.current as any).radius = (l.shadowRadius ?? 4) * 0.05;
  }, [l.shadowRadius]);
  return (
    <pointLight
      ref={ref}
      key={`pt-${l.castShadow ? 1 : 0}-${l.shadowRadius ?? 4}-${mapSize}`}
      position={l.position}
      color={l.color}
      intensity={l.intensity}
      distance={l.distance ?? 10}
      decay={l.decay ?? 2}
      castShadow={l.castShadow ?? false}
      shadow-intensity={l.shadowIntensity ?? 1}
      shadow-mapSize={[mapSize, mapSize]}
      shadow-radius={l.shadowRadius ?? 4}
      shadow-blurSamples={Math.max(8, Math.min(50, Math.round((l.shadowRadius ?? 4) * 4)))}
      shadow-bias={-0.0005}
      shadow-normalBias={0.02}
      shadow-camera-near={0.1}
      shadow-camera-far={Math.max(l.distance ?? 10, 0.5)}
    />
  );
}

/** SpotLight + 명시적 target Object3D — store의 target 좌표를 따라간다. */
function SpotWithTarget({
  light: l,
  selected,
  mapSize,
}: {
  light: CustomLight;
  selected: boolean;
  mapSize: number;
}) {
  const targetRef = useRef<Object3D>(new Object3D());
  const target = targetRef.current;
  const lightRef = useRef<SpotLight>(null);
  const { scene } = useThree();

  useEffect(() => {
    if (l.rotation) {
      // 회전이 있으면 그 방향으로 — 거리는 예전 target 거리(없으면 2m)
      const p = new Vector3(...l.position);
      const d = l.target ? Math.max(0.5, p.distanceTo(new Vector3(...l.target))) : 2;
      target.position.copy(p.addScaledVector(lightForward(l), d));
    } else {
      target.position.set(l.target?.[0] ?? 0, l.target?.[1] ?? 0, l.target?.[2] ?? 0);
    }
    target.updateMatrixWorld();
  }, [l, target]);

  // 선택 시 cone helper 시각화
  useEffect(() => {
    if (!selected || !lightRef.current) return;
    const helper = new SpotLightHelper(lightRef.current, '#22d3ee');
    scene.add(helper);
    const id = setInterval(() => helper.update(), 100);
    return () => {
      clearInterval(id);
      scene.remove(helper);
      helper.dispose();
    };
  }, [selected, scene]);

  // shadow.autoUpdate 라이브 적용
  useEffect(() => {
    if (lightRef.current) lightRef.current.shadow.autoUpdate = l.shadowAutoUpdate ?? true;
  }, [l.shadowAutoUpdate]);
  // light.radius — PT 소프트 그림자 (raster shadow-radius 와 별개)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (lightRef.current) (lightRef.current as any).radius = (l.shadowRadius ?? 4) * 0.05;
  }, [l.shadowRadius]);

  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={lightRef}
        key={`sp-${l.castShadow ? 1 : 0}-${(l.angle ?? 0).toFixed(2)}-${l.shadowRadius ?? 4}-${mapSize}`}
        position={l.position}
        color={l.color}
        intensity={l.intensity}
        distance={l.distance ?? 10}
        decay={l.decay ?? 1.5}
        angle={l.angle ?? Math.PI / 6}
        penumbra={l.penumbra ?? 0.4}
        castShadow={l.castShadow ?? false}
        shadow-intensity={l.shadowIntensity ?? 1}
        target={target}
        // 전역 shadowQuality 따라 mapSize 1024~8192. PCFShadowMap 기준 큰 mapSize 가
        // 가장자리 계단을 줄이는 가장 큰 요소. blurSamples cap 25 → 50.
        shadow-mapSize={[mapSize, mapSize]}
        shadow-radius={l.shadowRadius ?? 4}
        shadow-blurSamples={Math.max(8, Math.min(50, Math.round((l.shadowRadius ?? 4) * 4)))}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-near={0.1}
        shadow-camera-far={Math.max(l.distance ?? 10, 0.5)}
      />
    </>
  );
}

// Vector3 import 보존 (외부에서 사용 시)
void Vector3;
