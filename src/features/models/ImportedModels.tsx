import { Suspense, useRef } from 'react';
import { Box3, Vector3, type Group } from 'three';
import { useGLTF, TransformControls } from '@react-three/drei';
import { useImportedModelStore, type ImportedModel } from './importedModelStore';

/**
 * 사용자가 불러온 GLB/GLTF 모델들을 씬에 렌더링.
 *
 * - `useGLTF`(drei) 로 blob/http URL 로드 — Suspense 경계 내부에서 비동기 로드
 * - 선택된 모델은 `<TransformControls>` 로 이동 가능 (드래그 종료 시 store 반영)
 * - position / rotation(deg) / scale / visible 은 store 가 관리, 패널에서 편집
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
  const select = useImportedModelStore((s) => s.select);
  const update = useImportedModelStore((s) => s.update);
  const groupRef = useRef<Group>(null);
  const selected = selectedId === model.id;

  const { scene } = useGLTF(model.url);
  // 인스턴스마다 독립 클론 (같은 url 여러 번 배치 가능)
  const obj = scene.clone();
  // 모든 mesh 그림자 on
  obj.traverse((o) => {
    const mesh = o as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const rotRad: [number, number, number] = [
    (model.rotation[0] * Math.PI) / 180,
    (model.rotation[1] * Math.PI) / 180,
    (model.rotation[2] * Math.PI) / 180,
  ];

  const node = (
    <group
      ref={groupRef}
      position={model.position}
      rotation={rotRad}
      scale={model.scale}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        select(selected ? null : model.id);
      }}
    >
      <primitive object={obj} />
    </group>
  );

  return (
    <>
      {node}
      {selected && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode="translate"
          onObjectChange={() => {
            const p = groupRef.current!.position;
            update(model.id, { position: [p.x, p.y, p.z] });
          }}
        />
      )}
    </>
  );
}

/** 모델의 bounding box 중심/크기 (m) — 패널의 "바닥에 정렬" 등에 활용 가능. */
export function modelBounds(obj: import('three').Object3D): { center: Vector3; size: Vector3 } {
  const box = new Box3().setFromObject(obj);
  const center = new Vector3();
  const size = new Vector3();
  box.getCenter(center);
  box.getSize(size);
  return { center, size };
}
