import { Suspense, useEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Box3Helper,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import { useGLTF, TransformControls } from '@react-three/drei';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  useImportedModelStore,
  type ImportedModel,
  type MaterialEdit,
  type MaterialSlot,
  type PrimitiveKind,
} from './importedModelStore';

/**
 * 불러온 GLB/GLTF 모델 + 기본 도형(primitive)을 씬에 렌더링 + 선택/이동/회전/크기/머티리얼 편집.
 *
 * - GLTF: useGLTF + SkeletonUtils.clone (skinned mesh/bone 보존)
 * - primitive: plane/box/sphere/cone/cylinder/torus/torusKnot/teapot/tube geometry 생성
 * - 두 경로 모두 머티리얼을 MeshPhysicalMaterial 로 변환 → 동일한 PBR 편집 시스템 공유
 */
export function ImportedModels() {
  const models = useImportedModelStore((s) => s.models);
  return (
    <Suspense fallback={null}>
      {models
        .filter((m) => m.visible)
        .map((m) =>
          m.primitive ? (
            <PrimitiveInstance key={m.id} model={m} />
          ) : (
            <GltfInstance key={m.id} model={m} />
          ),
        )}
    </Suspense>
  );
}

/** GLTF/GLB — useGLTF 로 로드 후 클론. */
function GltfInstance({ model }: { model: ImportedModel }) {
  const { scene } = useGLTF(model.url);
  const obj = useMemo(() => cloneSkeleton(scene) as Object3D, [scene]);
  return <ModelBody model={model} obj={obj} />;
}

/** 기본 도형 — geometry + 기본 MeshStandardMaterial 로 그룹 생성. */
function PrimitiveInstance({ model }: { model: ImportedModel }) {
  const obj = useMemo(() => buildPrimitiveGroup(model.primitive!), [model.primitive]);
  return <ModelBody model={model} obj={obj} />;
}

/**
 * 공용 본체 — obj(고유 Object3D)를 받아 머티리얼 Physical 변환 + 슬롯 수집 + edit 적용 +
 * 선택 outline + TransformControls. GLTF/primitive 공통.
 */
function ModelBody({ model, obj: rawObj }: { model: ImportedModel; obj: Object3D }) {
  const selectedId = useImportedModelStore((s) => s.selectedId);
  const gizmoMode = useImportedModelStore((s) => s.gizmoMode);
  const select = useImportedModelStore((s) => s.select);
  const update = useImportedModelStore((s) => s.update);
  const setMaterialSlots = useImportedModelStore((s) => s.setMaterialSlots);
  const groupRef = useRef<Group>(null);
  const selected = selectedId === model.id;

  // 머티리얼 → MeshPhysicalMaterial 인스턴스별 변환 + 슬롯 수집 (full PBR 편집 + 캐시 오염 방지)
  const { obj, matMap, slots } = useMemo(() => {
    const c = rawObj;
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
        // ⚠️ MeshPhysicalMaterial.copy(standard) 는 Standard 에 없는 Vector2(clearcoatNormalScale
        // 등)를 읽다 crash → 안전하게 공통 PBR 속성만 수동 이전.
        const phys = standardToPhysical(std);
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
  }, [rawObj]);

  // 슬롯 목록 store 등록 (Inspector 용)
  useEffect(() => {
    setMaterialSlots(model.id, slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  // 머티리얼 edit 라이브 적용 (edit 없으면 원본 → reset 처리)
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
      mat.transparent = (e.transparent ?? o.transparent ?? false) || opacity < 1;
      mat.needsUpdate = true;
    }
  }, [model.materialEdits, slots, matMap]);

  const boxHelper = useMemo(() => {
    const box = new Box3().setFromObject(obj);
    return new Box3Helper(box, new Color('#22d3ee'));
  }, [obj]);

  const rotRad: [number, number, number] = [
    (model.rotation[0] * Math.PI) / 180,
    (model.rotation[1] * Math.PI) / 180,
    (model.rotation[2] * Math.PI) / 180,
  ];

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
      scale: g.scale.x,
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

/**
 * MeshStandardMaterial(또는 이미 Physical) → MeshPhysicalMaterial 안전 변환.
 * MeshPhysicalMaterial.copy() 는 source 에 physical-only Vector2 속성이 없으면 crash 하므로
 * 공통 PBR 속성만 수동 이전한다 (맵은 참조 공유 — 텍스처 메모리 절약).
 */
function standardToPhysical(std: MeshStandardMaterial): MeshPhysicalMaterial {
  const phys = new MeshPhysicalMaterial();
  phys.name = std.name;
  phys.color.copy(std.color);
  phys.roughness = std.roughness;
  phys.metalness = std.metalness;
  phys.emissive.copy(std.emissive);
  phys.emissiveIntensity = std.emissiveIntensity;
  phys.opacity = std.opacity;
  phys.transparent = std.transparent;
  phys.side = std.side;
  phys.flatShading = std.flatShading;
  phys.vertexColors = std.vertexColors;
  phys.wireframe = std.wireframe;
  phys.envMapIntensity = std.envMapIntensity;
  // 텍스처 맵 — 참조 공유
  phys.map = std.map;
  phys.normalMap = std.normalMap;
  if (std.normalScale) phys.normalScale.copy(std.normalScale);
  phys.roughnessMap = std.roughnessMap;
  phys.metalnessMap = std.metalnessMap;
  phys.emissiveMap = std.emissiveMap;
  phys.aoMap = std.aoMap;
  phys.aoMapIntensity = std.aoMapIntensity;
  phys.alphaMap = std.alphaMap;
  phys.bumpMap = std.bumpMap;
  phys.bumpScale = std.bumpScale;
  phys.displacementMap = std.displacementMap;
  phys.needsUpdate = true;
  return phys;
}

/** primitive 종류 → geometry. 인테리어 스케일(~0.5m). */
function buildPrimitiveGeometry(kind: PrimitiveKind): BufferGeometry {
  switch (kind) {
    case 'plane': return new PlaneGeometry(1, 1);
    case 'box': return new BoxGeometry(0.6, 0.6, 0.6);
    case 'sphere': return new SphereGeometry(0.4, 48, 32);
    case 'cone': return new ConeGeometry(0.4, 0.8, 48);
    case 'cylinder': return new CylinderGeometry(0.35, 0.35, 0.8, 48);
    case 'torus': return new TorusGeometry(0.4, 0.15, 24, 64);
    case 'torusKnot': return new TorusKnotGeometry(0.32, 0.11, 160, 24);
    case 'teapot': return new TeapotGeometry(0.35);
    case 'tube': {
      // 부드러운 S 곡선 경로의 튜브
      const curve = new CatmullRomCurve3([
        new Vector3(-0.5, -0.3, 0),
        new Vector3(-0.2, 0.3, 0.2),
        new Vector3(0.2, -0.3, -0.2),
        new Vector3(0.5, 0.3, 0),
      ]);
      return new TubeGeometry(curve, 64, 0.08, 16, false);
    }
  }
}

/** primitive geometry + 기본 머티리얼로 Group 생성 (ModelBody 가 Physical 로 변환). */
function buildPrimitiveGroup(kind: PrimitiveKind): Object3D {
  const geo = buildPrimitiveGeometry(kind);
  const mat = new MeshStandardMaterial({
    color: kind === 'plane' ? '#ffffff' : '#bfc4cc',
    roughness: 0.55,
    metalness: 0.0,
    side: kind === 'plane' ? DoubleSide : undefined,
  });
  mat.name = kind;
  const mesh = new Mesh(geo, mat);
  // plane 은 기본 +Z 향 → 바닥처럼 눕히기 (-90° X)
  if (kind === 'plane') mesh.rotation.x = -Math.PI / 2;
  const g = new Group();
  g.add(mesh);
  return g;
}

/** 모델 bounding box 중심/크기 (m). */
export function modelBounds(obj: Object3D): { center: Vector3; size: Vector3 } {
  const box = new Box3().setFromObject(obj);
  const center = new Vector3();
  const size = new Vector3();
  box.getCenter(center);
  box.getSize(size);
  return { center, size };
}