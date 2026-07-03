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
  type Texture,
} from 'three';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import { useGLTF, TransformControls } from '@react-three/drei';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { standardToPhysical } from '@/domain/materials/standardToPhysical';
import {
  useImportedModelStore,
  type ImportedModel,
  type MaterialEdit,
  type MaterialSlot,
  type PrimitiveKind,
  type TextureInfo,
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
  const { scene } = useGLTF(model.url, '/draco/');
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
    // ⚠️ rawObj를 직접 변형하면 안 됨(impure). React StrictMode가 useMemo 팩토리를 2회 호출할 때
    // rawObj가 두 번 변형돼, React가 채택한 invocation의 matMap과 메시의 실제 재질이 어긋난다
    // (재질 편집이 화면에 안 먹는 버그). memo 안에서 clone → 각 invocation이 독립 사본을 다뤄 순수.
    const c = cloneSkeleton(rawObj) as Object3D;
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
        // 이름: GLB 재질명 → 없으면 "메시명·재질N" (mat-0 같은 무의미한 라벨 방지)
        const key = std.name && std.name.length ? std.name : `${mesh.name || '재질'}·mat${idx}`;
        idx++;
        // 같은 이름(=같은 논리 재질)을 쓰는 메시가 여러 개면 **동일 phys 인스턴스를 재사용**.
        // 각자 새로 변환하면 matMap 에 없는 사본이 생겨 편집이 첫 메시에만 적용되던 버그.
        const existing = matMap.get(key);
        if (existing) return existing;
        // ⚠️ MeshPhysicalMaterial.copy(standard) 는 Standard 에 없는 Vector2(clearcoatNormalScale
        // 등)를 읽다 crash → 안전하게 공통 PBR 속성만 수동 이전.
        const phys = standardToPhysical(std);
        matMap.set(key, phys);
        slots.push({
            key,
            name: key,
            textures: collectTextureInfo(phys),
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
        return phys;
      });
      mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
    });
    return { obj: c, matMap, slots };
  }, [rawObj]);

  // 변환 머티리얼 정리 — matMap 이 교체되거나(모델 재로드) unmount 시 이전 인스턴스 dispose.
  // material.dispose() 는 텍스처를 해제하지 않으므로(원본 std 와 참조 공유) 안전하다.
  useEffect(() => {
    return () => {
      for (const mat of matMap.values()) mat.dispose();
    };
  }, [matMap]);

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

  // boxHelper geometry/material 정리 (교체·unmount 시)
  useEffect(() => {
    return () => {
      boxHelper.dispose();
    };
  }, [boxHelper]);

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
      scale: [g.scale.x, g.scale.y, g.scale.z],
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
          // 그라운드(기본 바닥 plane)는 선택을 가로채지 않는다 — '빈 공간 클릭'과 동일하게
          // 전체 선택 해제만 수행. (재질 편집은 씬 트리에서 선택해 사용)
          if (model.isGround) {
            e.stopPropagation();
            // 그라운드 2단계 클릭: 뭔가 선택돼 있으면 → 전체 해제만 (빈 공간 클릭 역할),
            // 아무것도 선택 안 된 상태면 → 그라운드 자신을 선택 (재질 편집 등).
            void (async () => {
              const [{ usePlacedProductStore }, { useMeshSelectionStore }, { useSpaceModuleStore }] =
                await Promise.all([
                  import('@/features/placement/placedProductStore'),
                  import('@/features/selection/meshSelectionStore'),
                  import('@/features/spaceModules/spaceModuleStore'),
                ]);
              const placed = usePlacedProductStore.getState();
              const meshSel = useMeshSelectionStore.getState();
              const modSel = useSpaceModuleStore.getState();
              const cur = useImportedModelStore.getState();
              const anySelected =
                placed.selectedIds.length > 0 || meshSel.selectedMeshKeys.length > 0 ||
                modSel.selectedId !== null || (cur.selectedId !== null && cur.selectedId !== model.id);
              if (anySelected) {
                if (placed.selectedIds.length > 0) { placed.select(null); window.parent?.postMessage({ type: 'hp3:deselected' }, '*'); }
                meshSel.selectMesh(null);
                modSel.select(null);
                cur.select(null);
              } else {
                cur.select(model.id); // 바닥 자체 선택 (토글: 이미 선택이면 해제)
              }
            })();
            return;
          }
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

/** 재질의 텍스처 맵 슬롯 → 한글 라벨. */
const TEXTURE_KINDS: [keyof MeshPhysicalMaterial, string][] = [
  ['map', '베이스색'],
  ['normalMap', '노멀'],
  ['roughnessMap', '거칠기'],
  ['metalnessMap', '금속성'],
  ['aoMap', 'AO'],
  ['emissiveMap', '발광'],
  ['alphaMap', '알파'],
  ['displacementMap', '변위'],
];

/** 재질이 참조하는 텍스처 정보 수집 (Inspector 표시용). */
function collectTextureInfo(mat: MeshPhysicalMaterial): TextureInfo[] {
  const out: TextureInfo[] = [];
  for (const [prop, kind] of TEXTURE_KINDS) {
    const tex = mat[prop] as Texture | null;
    if (!tex) continue;
    const img = tex.image as { width?: number; height?: number } | undefined;
    out.push({
      kind,
      name: tex.name && tex.name.length ? tex.name : `(무명 ${tex.uuid.slice(0, 8)})`,
      size: img?.width && img?.height ? `${img.width}×${img.height}` : undefined,
    });
  }
  return out;
}

/** primitive 종류 → geometry. 인테리어 스케일(~0.5m). */
function buildPrimitiveGeometry(kind: Exclude<PrimitiveKind, 'door' | 'window' | 'openingFrame'>): BufferGeometry {
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
  // 건축 요소(도어/창호/개구부)는 다중 메시 그룹 — 바닥(y=0) 원점 기준
  if (kind === 'door' || kind === 'window' || kind === 'openingFrame') {
    return buildArchGroup(kind);
  }
  const geo = buildPrimitiveGeometry(kind as Exclude<PrimitiveKind, 'door' | 'window' | 'openingFrame'>);
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

/**
 * 건축 요소 primitive — 도어(패널) / 창호(프레임+유리) / 개구부(ㄷ자 프레임).
 * 바닥(y=0) 원점, 벽 두께(0.2m) 기준 깊이. 아무 곳에나 독립 배치 가능하며
 * 모듈 벽 근처 클릭 시엔 개구부 데이터로 부착된다(ModulePlacement).
 */
function buildArchGroup(kind: 'door' | 'window' | 'openingFrame'): Object3D {
  const g = new Group();
  const mesh = (geo: BufferGeometry, mat: MeshStandardMaterial, y: number) => {
    const m = new Mesh(geo, mat);
    m.position.y = y;
    g.add(m);
    return m;
  };
  if (kind === 'door') {
    const mat = new MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.6 });
    mat.name = 'door';
    mesh(new BoxGeometry(0.9, 2.1, 0.05), mat, 1.05); // 문짝 패널
  } else if (kind === 'window') {
    const frame = new MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.4 });
    frame.name = 'window-frame';
    const glass = new MeshStandardMaterial({ color: '#93c5fd', roughness: 0.05, transparent: true, opacity: 0.35 });
    glass.name = 'window-glass';
    const W = 1.2, H = 1.2, T = 0.06, D = 0.1, SILL = 0.9;
    mesh(new BoxGeometry(W, T, D), frame, SILL + T / 2);            // 하단 프레임
    mesh(new BoxGeometry(W, T, D), frame, SILL + H - T / 2);        // 상단 프레임
    const jamb = new BoxGeometry(T, H - 2 * T, D);
    mesh(jamb, frame, SILL + H / 2).position.x = -(W - T) / 2;      // 좌 프레임
    mesh(jamb.clone(), frame, SILL + H / 2).position.x = (W - T) / 2; // 우 프레임
    mesh(new BoxGeometry(W - 2 * T, H - 2 * T, 0.02), glass, SILL + H / 2); // 유리
  } else {
    // 개구부 — ㄷ자(상단+좌우) 몰딩 프레임
    const mat = new MeshStandardMaterial({ color: '#d6d3d1', roughness: 0.7 });
    mat.name = 'opening-frame';
    const W = 1.0, H = 2.1, T = 0.08, D = 0.22;
    mesh(new BoxGeometry(W, T, D), mat, H - T / 2);                  // 상단
    const jamb = new BoxGeometry(T, H - T, D);
    mesh(jamb, mat, (H - T) / 2).position.x = -(W - T) / 2;          // 좌
    mesh(jamb.clone(), mat, (H - T) / 2).position.x = (W - T) / 2;   // 우
  }
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