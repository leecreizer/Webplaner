import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Mesh,
  Object3D,
  PointLightHelper,
  SpotLightHelper,
  Vector3,
  type PointLight,
  type SpotLight,
} from 'three';
import { TransformControls } from '@react-three/drei';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { useCustomLightStore, type CustomLight } from '@/engine/stores/customLightStore';
import { useLightingStore, shadowMapSizeFor } from '@/engine/stores/lightingStore';

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
      {l.kind === 'rect' && (
        <rectAreaLight
          position={l.position}
          color={l.color}
          intensity={l.intensity}
          width={l.width ?? 2}
          height={l.height ?? 1}
        />
      )}
      {l.kind === 'hemisphere' && (
        <hemisphereLight
          color={l.color}
          groundColor={l.groundColor ?? '#404040'}
          intensity={l.intensity}
        />
      )}

      {/* 위치 마커 — 클릭으로 선택 토글, 선택 시 시각 강조 */}
      <mesh
        ref={markerRef}
        position={l.position}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
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

      {/* 선택 시 TransformControls (translate). 마커가 target. 드래그 종료 시 store 갱신. */}
      {selected && markerRef.current && (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          size={0.7}
          onObjectChange={() => {
            const p = markerRef.current!.position;
            update(l.id, { position: [p.x, p.y, p.z] });
          }}
        />
      )}
    </group>
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
    target.position.set(l.target?.[0] ?? 0, l.target?.[1] ?? 0, l.target?.[2] ?? 0);
    target.updateMatrixWorld();
  }, [l.target, target]);

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
