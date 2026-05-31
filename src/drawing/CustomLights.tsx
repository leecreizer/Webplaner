import { useEffect, useRef } from 'react';
import { Mesh, Object3D, Vector3 } from 'three';
import { TransformControls } from '@react-three/drei';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { useCustomLightStore, type CustomLight } from './customLightStore';

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
        <pointLight
          position={l.position}
          color={l.color}
          intensity={l.intensity}
          distance={l.distance ?? 10}
          decay={l.decay ?? 2}
          castShadow={l.castShadow ?? false}
        />
      )}
      {l.kind === 'spot' && <SpotWithTarget light={l} />}
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

/** SpotLight + 명시적 target Object3D — store의 target 좌표를 따라간다. */
function SpotWithTarget({ light: l }: { light: CustomLight }) {
  const targetRef = useRef<Object3D>(new Object3D());
  const target = targetRef.current;

  useEffect(() => {
    target.position.set(l.target?.[0] ?? 0, l.target?.[1] ?? 0, l.target?.[2] ?? 0);
    target.updateMatrixWorld();
  }, [l.target, target]);

  return (
    <>
      <primitive object={target} />
      <spotLight
        position={l.position}
        color={l.color}
        intensity={l.intensity}
        distance={l.distance ?? 10}
        decay={l.decay ?? 1.5}
        angle={l.angle ?? Math.PI / 6}
        penumbra={l.penumbra ?? 0.4}
        castShadow={l.castShadow ?? false}
        target={target}
      />
    </>
  );
}

// Vector3 import 보존 (외부에서 사용 시)
void Vector3;
