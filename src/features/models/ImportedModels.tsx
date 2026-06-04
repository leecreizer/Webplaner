import { Suspense, useMemo, useRef } from 'react';
import { Box3, Box3Helper, Color, Vector3, type Group, type Object3D } from 'three';
import { useGLTF, TransformControls } from '@react-three/drei';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useImportedModelStore, type ImportedModel } from './importedModelStore';

/**
 * 사용자가 불러온 GLB/GLTF 모델들을 씬에 렌더링 + 선택/이동/회전/크기 편집.
 *
 * - `useGLTF`(drei) 로 blob/http URL 로드, Suspense 경계 내부
 * - **클론은 SkeletonUtils.clone** — 스킨드 메시/본/머티리얼/애니메이션 계층까지 보존
 *   (scene.clone() 은 skinned mesh 의 bone 바인딩이 깨질 수 있음). 모델 속성 전부 유지.
 * - 클론은 url 기준 useMemo — 매 렌더 재클론 방지 (이전 버그: 드래그/선택마다 재클론되어 깜빡임)
 * - 선택 시 시안색 bounding box + `<TransformControls>` (store.gizmoMode: translate/rotate/scale)
 */
export function ImportedModels() {
  const models = useImportedModelStore((s) => s.models);
  return (
    <Suspense fallback={null}>
      {models.filter((m) => m.visible).map((m) => (
        <ImportedModelInstance key={m.id} model={m} />
      ))}
    </Suspense>
  );
}

function ImportedModelInstance({ model }: { model: ImportedModel }) {
  const selectedId = useImportedModelStore((s) => s.selectedId);
  const gizmoMode = useImportedModelStore((s) => s.gizmoMode);
  const select = useImportedModelStore((s) => s.select);
  const update = useImportedModelStore((s) => s.update);
  const groupRef = useRef<Group>(null);
  const selected = selectedId === model.id;

  const { scene } = useGLTF(model.url);

  // url 기준 1회 클론 — SkeletonUtils 로 skinned mesh/bone/material 보존. 매 렌더 재클론 방지.
  const obj = useMemo(() => {
    const c = cloneSkeleton(scene) as Object3D;
    c.traverse((o) => {
      const mesh = o as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [scene]);

  // 선택 표시용 bounding box helper (시안)
  const boxHelper = useMemo(() => {
    const box = new Box3().setFromObject(obj);
    return new Box3Helper(box, new Color('#22d3ee'));
  }, [obj]);

  const rotRad: [number, number, number] = [
    (model.rotation[0] * Math.PI) / 180,
    (model.rotation[1] * Math.PI) / 180,
    (model.rotation[2] * Math.PI) / 180,
  ];

  // TransformControls 드래그 종료 시 store 에 pos/rot/scale 전부 반영
  const commitTransform = () => {
    const g = groupRef.current;
    if (!g) return;
    update(model.id, {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [
        (g.rotation.x * 180) / Math.PI,
        (g.rotation.y * 180) / Math.PI,
        (g.rotation.z * 180) / Math.PI,
      ],
      scale: g.scale.x, // uniform scale 가정 (TransformControls scale 은 축별이나 평균 사용)
    });
  };

  return (
    <>
      <group
        ref={groupRef}
        position={model.position}
        rotation={rotRad}
        scale={model.scale}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          select(model.id);
        }}
      >
        <primitive object={obj} />
        {selected && <primitive object={boxHelper} />}
      </group>

      {selected && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode={gizmoMode}
          onMouseUp={commitTransform}
          onObjectChange={commitTransform}
        />
      )}
    </>
  );
}

/** 모델의 bounding box 중심/크기 (m). */
export function modelBounds(obj: Object3D): { center: Vector3; size: Vector3 } {
  const box = new Box3().setFromObject(obj);
  const center = new Vector3();
  const size = new Vector3();
  box.getCenter(center);
  box.getSize(size);
  return { center, size };
}