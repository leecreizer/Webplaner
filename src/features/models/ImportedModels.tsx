import { Suspense, useEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Box3Helper,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
} from 'three';
import { useGLTF, TransformControls } from '@react-three/drei';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  useImportedModelStore,
  type ImportedModel,
  type MaterialEdit,
  type MaterialSlot,
} from './importedModelStore';

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
  const setMaterialSlots = useImportedModelStore((s) => s.setMaterialSlots);
  const groupRef = useRef<Group>(null);
  const selected = selectedId === model.id;

  const { scene } = useGLTF(model.url);

  // url 기준 1회 클론 — SkeletonUtils 로 skinned mesh/bone 보존. 머티리얼은 *인스턴스별 복제 +
  // MeshPhysicalMaterial 로 변환* 해 full PBR(transmission/clearcoat) 편집 가능 + 캐시 원본
  // 오염 방지. 변환 결과를 key→material 맵으로 보관해 edit 라이브 적용.
  const { obj, matMap, slots } = useMemo(() => {
    const c = cloneSkeleton(scene) as Object3D;
    const matMap = new Map<string, MeshPhysicalMaterial>();
    const slots: MaterialSlot[] = [];
    let idx = 0;
    c.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const converted = mats.map((m) => {
        const std = m as MeshStandardMaterial;
        // Standard/기타 → Physical 변환 (.copy 가 Standard 속성 전부 복사, 맵은 참조 공유)
        const phys = new MeshPhysicalMaterial();
        phys.copy(std as unknown as MeshPhysicalMaterial);
        const key = std.name && std.name.length ? std.name : `mat-${idx}`;
        idx++;
        if (!matMap.has(key)) {
          matMap.set(key, phys);
          slots.push({
            key,
            name: key,
            original: {
              color: '#' + phys.color.getHexString(),
              roughness: phys.roughness,
              metalness: phys.metalness,
              emissive: '#' + phys.emissive.getHexString(),
              emissiveIntensity: phys.emissiveIntensity,
              opacity: phys.opacity,
              transparent: phys.transparent,
              transmission: phys.transmission ?? 0,
              ior: phys.ior ?? 1.5,
              clearcoat: phys.clearcoat ?? 0,
              clearcoatRoughness: phys.clearcoatRoughness ?? 0,
            },
          });
        }
        return phys;
      });
      mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
    });
    return { obj: c, matMap, slots };
  }, [scene]);

  // 슬롯 목록을 store 에 등록 (Inspector 가 읽음) — 1회.
  useEffect(() => {
    setMaterialSlots(model.id, slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  // 머티리얼 edit 라이브 적용 — edit 없으면 원본값. (change + reset 모두 처리)
  useEffect(() => {
    for (const slot of slots) {
      const mat = matMap.get(slot.key);
      if (!mat) continue;
      const o = slot.original;
      const e: MaterialEdit = model.materialEdits?.[slot.key] ?? {};
      mat.color.set(e.color ?? o.color ?? '#ffffff');
      mat.roughness = e.roughness ?? o.roughness ?? 1;
      mat.metalness = e.metalness ?? o.metalness ?? 0;
      mat.emissive.set(e.emissive ?? o.emissive ?? '#000000');
      mat.emissiveIntensity = e.emissiveIntensity ?? o.emissiveIntensity ?? 1;
      mat.transmission = e.transmission ?? o.transmission ?? 0;
      mat.ior = e.ior ?? o.ior ?? 1.5;
      mat.clearcoat = e.clearcoat ?? o.clearcoat ?? 0;
      mat.clearcoatRoughness = e.clearcoatRoughness ?? o.clearcoatRoughness ?? 0;
      const opacity = e.opacity ?? o.opacity ?? 1;
      mat.opacity = opacity;
      // transmission>0 이거나 opacity<1 이면 투명 처리
      mat.transparent = (e.transparent ?? o.transparent ?? false) || opacity < 1;
      mat.needsUpdate = true;
    }
  }, [model.materialEdits, slots, matMap]);

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