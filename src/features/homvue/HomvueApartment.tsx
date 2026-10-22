import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Html, useGLTF } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Box3,
  DoubleSide,
  Group,
  Matrix4,
  Mesh as ThreeMesh,
  type BufferGeometry,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { useHomvueStore } from './homvueStore';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { isCeiling, placedProducts, sameDotSpace, showableProducts, type PlacedItem, type PlanData } from './homvueAssets';
import { ueTransformToMatrix } from './ueTransform';
import { HomvueTravelPoints } from './HomvueTravelPoints';
import { HomvueGizmo, homvueGizmoState, homvueProductObjects, type HomvueGizmoTarget } from './HomvueGizmo';
import { isGizmoBusy } from '@/features/models/gizmoGuard';
import { HomvueLights } from './HomvueLights';
import { bakedGlb, wallRoom } from './homvueMaterials';
import { applyGlassMode, applyMaterialParams, ownerKey } from './homvueMaterialParams';
import { syncMatEdits } from './homvueMaterialEdit';
import { useMutracerStore } from '@/engine/stores/mutracerStore';
// 평면을 열면 언리얼 노출·해·후처리를 조명·렌더 설정에 넣는다(부작용 import)
import './homvueEnvironment';

const DRACO = `${import.meta.env.BASE_URL}draco/`;
/** 홈플래너3 기본 바닥판(y=0)과 아파트 바닥이 같은 높이면 깜빡인다(z-fighting) — 5mm 띄운다. */
const FLOOR_LIFT = 0.005;

/**
 * Homvue 평면 조립 — 언리얼 평면 레벨 그대로:
 * - 기본 레벨의 아파트 블루프린트(외벽·방별 벽·바닥·천장)
 * - 기본 레벨의 고정 설비(조명·콘센트·수전·쿡탑 …)
 * - 기본 레벨에 직접 놓인 Datasmith 메시(StaticMeshActor 687~1,669개 — 주방·욕실·문·창호 등), 레벨 좌표 그대로 GLB 하나
 * - 방마다 고른 모듈 레벨의 바닥·가구 (방 스타일 = 모듈, 언리얼 ChangeRoomModule 대응)
 * - 상품 클릭 = 선택(노란 상자), 패널에서 교체 — 언리얼 상품 선택·ChangeProduct 대응
 * - 집 부품·방 바닥·레벨 메시도 클릭하면 선택 + 기즈모(HomvueGizmo) — 물체 종류를 가리지 않는다
 * - 투어 중에는 지금 방의 「보여 줄 상품」 위에 점(언리얼 WB_Dot) — 누르면 선택
 *
 * 모두 언리얼 위치·회전·크기를 ueTransformToMatrix 로 옮겨 같은 좌표계에 둔다(실측 검증된 축 대응).
 * 홈플래너3 카메라·그리드 기준에 맞춰 천장을 뺀 아파트 범위의 가운데를 원점으로, 바닥을 y=0(+5mm)으로 옮긴다.
 */
export function HomvueApartment() {
  const plan = useHomvueStore((s) => s.plan);
  if (!plan) return null;
  return (
    <LoadErrorBoundary key={plan.id}>
      <Suspense fallback={null}>
        <PlanAssembly plan={plan} />
      </Suspense>
    </LoadErrorBoundary>
  );
}

/**
 * @param shell 집 부품(벽·천장·바닥·레벨 메시) — 재질을 양면으로. 변환된 GLB 는 대부분 단면이라 경로 추적(MuTracer 는
 *   three 재질 side === DoubleSide 일 때만 양면)에서 뒷면에 닿은 광선이 그대로 통과해 바깥 빛이 벽을 뚫고 들어오고
 *   실내 빛이 새어 나간다. 같은 GLB 는 집 부품끼리만 쓰므로 공유 재질을 바꿔도 상품에는 영향이 없다.
 */
function prepare(obj: Object3D, item: PlacedItem, shell = false) {
  obj.matrixAutoUpdate = false;
  obj.matrix.copy(ueTransformToMatrix(item.location_cm, item.rotation_deg, item.scale));
  // 블루프린트 GLB 의 맨 위 노드에는 블루프린트 기본 크기(루트 컴포넌트 RelativeScale)가 들어 있다. 레벨에 놓인
  // 크기(item.scale)는 그 값을 곱하는 게 아니라 **대신하는** 실제 크기라, 그대로 두면 두 번 곱해진다 —
  // 액자 10~11.6배·TV 1.5배·술병 0.015배 등 34개 GLB(실측). 레벨 메시 묶음은 레벨 좌표 그대로라 제외.
  if (!item.blueprint.startsWith('/LevelStatic/')) for (const c of obj.children) c.scale.set(1, 1, 1);
  if (shell) obj.updateMatrixWorld(true);
  // 언리얼 재질 실제 값(반사·거칠기·금속성·유리 투과·패브릭 솜털감) — 양면·발광 처리보다 먼저
  obj.userData.homvueParams = applyMaterialParams(obj, ownerKey(item.blueprint), useHomvueStore.getState().matParams);
  litUnlitMaterials(obj);
  let unlit = 0;
  obj.traverse((o) => {
    const m = o as Object3D & { isMesh?: boolean; castShadow: boolean; receiveShadow: boolean; material?: Material | Material[] };
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    if (shell && m.material) {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat.side !== DoubleSide) {
          mat.side = DoubleSide;
          mat.needsUpdate = true;
        }
      }
      if (isWideSurface(m) && unglowSurface(m as unknown as Mesh)) unlit++;
    }
  });
  if (unlit) obj.userData.homvueUnlit = unlit;
  obj.userData.homvue = { blueprint: item.blueprint, product: item.product?.code };
  scaleLamps(obj, useHomvueStore.getState().lightScale);
  return obj;
}

/**
 * glTF 「unlit」 재질(KHR_materials_unlit → MeshBasicMaterial)을 발광 표준 재질로 — 화면·조명 갓·LED 등 40개 상품.
 * 경로 추적 모드는 MeshBasicMaterial 을 편집 보조물(기즈모·투어 점)로 보고 렌더에서 빼 위에 겹쳐 그려서,
 * 태블릿 화면이 벽·TV 를 뚫고 보였다. 발광 재질로 바꾸면 장면의 일부로 가려지고, 경로 추적에선 빛도 낸다.
 */
/**
 * 조명 기구의 발광 재질(렌즈·갓·LED)도 「실내 조명」 배율을 따른다 — 기본 배율(1)일 때 언리얼 값 그대로.
 * 배율은 언리얼 조명 액터(사각·스포트)에만 걸려 있어서, 0 으로 내려도 경로 추적에선 발광 재질 9천여 삼각형이
 * 계속 방을 밝혔다(43 거실 밝기의 약 20%, 실측). 원래 세기는 재질 userData 에 한 번 저장해 두고 곱한다.
 */
const LAMP_SCALE_BASE = 1;
function scaleLamps(root: Object3D, lightScale: number) {
  const k = lightScale / LAMP_SCALE_BASE;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as MeshStandardMaterial;
      if (!std.emissive) continue;
      if (std.userData.homvueLampBase === undefined) std.userData.homvueLampBase = std.emissiveIntensity;
      std.emissiveIntensity = std.userData.homvueLampBase * k;
    }
  });
}

const lit = new WeakMap<Material, Material>();
function litUnlitMaterials(obj: Object3D) {
  obj.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const conv = (m: Material): Material => {
      const b = m as MeshBasicMaterial;
      if (!b.isMeshBasicMaterial) return m;
      let s = lit.get(m);
      if (!s) {
        s = new MeshStandardMaterial({
          name: m.name,
          color: 0x000000,
          emissive: b.color.clone(),
          emissiveMap: b.map,
          emissiveIntensity: 1,
          roughness: 0.3,
          metalness: 0,
          transparent: m.transparent,
          opacity: m.opacity,
          alphaTest: m.alphaTest,
          side: m.side,
        });
        s.userData = { ...m.userData, homvueUnlitToEmissive: true };
        lit.set(m, s);
      }
      return s;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
}

function PlanAssembly({ plan }: { plan: PlanData }) {
  const materials = useHomvueStore((s) => s.materials);
  const matWall = useHomvueStore((s) => s.matWall);
  const matFloor = useHomvueStore((s) => s.matFloor);
  const matProduct = useHomvueStore((s) => s.matProduct);
  const lightScale = useHomvueStore((s) => s.lightScale);
  // 집 부품은 항상 원래 GLB — 벽지는 구운 GLB 의 재질만 가져와 덮는다(BakedMaterials). 구운 GLB 로 통째 바꾸면
  // 이 목록 전체가 다시 불러오기(Suspense)에 걸려 집이 통째로 사라졌다 나타나고, 경로 추적은 새 형상이라
  // 장면 전체를 다시 올린다(실측 벽지 변경 11초).
  const apartment = useMemo(() => plan.base.apartment.filter((i) => i.glb), [plan]);
  const gltfs = useGLTF(apartment.map((i) => i.glb!), DRACO) as unknown as { scene: Object3D }[];
  // 투어(1인칭) 중에는 언리얼처럼 천장이 항상 보인다
  const showCeiling = useHomvueStore((s) => s.showCeiling || s.walk);
  const modules = useHomvueStore((s) => s.modules);
  const overrides = useHomvueStore((s) => s.overrides);
  const selected = useHomvueStore((s) => s.selected);
  const walk = useHomvueStore((s) => s.walk);
  const currentRoom = useHomvueStore((s) => s.currentRoom);
  const dotKeys = useMemo(
    () => new Set(showableProducts(plan, modules, overrides).filter((p) => sameDotSpace(p.room, currentRoom)).map((p) => p.key)),
    [plan, modules, overrides, currentRoom],
  );

  const parts = useMemo(
    () => apartment.map((item, i) => ({ item, obj: prepare(gltfs[i].scene.clone(true), item, true) })),
    [apartment, gltfs],
  );
  // 벽마다 고른 벽지의 구운 GLB (없으면 null = 원래 재질)
  const wallBakes = useMemo(
    () =>
      apartment.map((item) => {
        const room = wallRoom(item.blueprint);
        return room ? bakedGlb(item, 'wall', matWall[room], materials) : null;
      }),
    [apartment, matWall, materials],
  );

  // 원점 맞춤은 처음 불러온 벽 기준으로 고정 — 벽지를 바꿔도(같은 형태) 집이 움직이지 않게
  const offsetRef = useRef<{ id: string; v: [number, number, number] } | null>(null);
  const offset = useMemo<[number, number, number]>(() => {
    if (offsetRef.current?.id === plan.id) return offsetRef.current.v;
    const box = new Box3();
    for (const { item, obj } of parts) {
      if (isCeiling(item)) continue;
      obj.updateMatrixWorld(true);
      box.expandByObject(obj);
    }
    if (box.isEmpty()) return [0, 0, 0];
    const c = box.getCenter(new Vector3());
    const v: [number, number, number] = [-c.x, -box.min.y + FLOOR_LIFT, -c.z];
    offsetRef.current = { id: plan.id, v };
    return v;
  }, [parts, plan.id]);

  // 기본 레벨 고정 설비 + 방마다 고른 모듈의 가구 (변환 전 상품은 건너뜀 — 패널에 개수 표시)
  const products = useMemo(
    () =>
      placedProducts(plan, modules, overrides)
        .filter((p) => p.item.glb)
        .map((p) => ({ ...p, baked: bakedGlb(p.item, 'product', matProduct[p.key], materials) })),
    [plan, modules, overrides, matProduct, materials],
  );
  // 기본 레벨 Datasmith 메시 묶음 — 이미 레벨 좌표라 변환은 단위 행렬
  const levelStatic = useMemo<PlacedItem | null>(
    () =>
      plan.base.static
        ? { blueprint: '/LevelStatic/' + plan.base.level, glb: plan.base.static, location_cm: [0, 0, 0], rotation_deg: [0, 0, 0], scale: [1, 1, 1] }
        : null,
    [plan],
  );
  // 방 바닥 — 고른 모듈 레벨에 들어 있는 아파트 블루프린트. 원점 맞춤(offset)은 기본 레벨 벽만 기준이라 바꿔도 집이 안 움직인다
  const floors = useMemo(
    () =>
      plan.rooms.flatMap((room) => {
        const m = room.modules.find((x) => x.no === modules[room.type]);
        return (m?.apartment ?? [])
          .filter((i) => i.glb)
          .map((item, i) => ({ key: `${room.type}-${m!.no}-apt${i}`, item, baked: bakedGlb(item, 'floor', matFloor[room.type], materials) }));
      }),
    [plan, modules, matFloor, materials],
  );

  useEffect(() => {
    useHomvueStore.getState().setLoadState('ready');
  }, [parts]);

  // 집 부품(외벽·방별 벽·바닥·천장)도 기즈모 대상 — 상품처럼 고르고 옮긴다(이번 화면에서만)
  useEffect(() => {
    const keys = parts.map(({ obj, item }, i) => registerPart(`part:apt-${i}`, obj, { centerPivot: true, label: `집 부품 · ${item.blueprint.split('/').pop()}` }));
    return () => keys.forEach((k) => unregisterPart(k));
  }, [parts]);

  useEffect(() => {
    useHomvueStore.getState().setOffset(offset);
  }, [offset]);

  // 실내 조명 배율 → 이미 놓인 부품의 발광 재질 (새로 놓이는 것은 prepare 에서)
  const groupRef = useRef<Object3D>(null);
  // 유리 굴절·커스틱 — 켜고 끌 때 + 부품이 늦게 들어오므로 2초마다 다시 맞춘다(바뀐 것만 고친다)
  const glassRefraction = useMutracerStore((s) => s.mt.glassRefraction);
  useEffect(() => {
    const apply = () => groupRef.current && applyGlassMode(groupRef.current, glassRefraction);
    apply();
    const id = window.setInterval(apply, 2000);
    return () => window.clearInterval(id);
  }, [glassRefraction]);
  useEffect(() => {
    if (groupRef.current) scaleLamps(groupRef.current, lightScale);
  }, [lightScale]);

  return (
    <group
      ref={groupRef}
      position={offset}
      name={`homvue:${plan.id}`}
      onPointerMissed={(e) => {
        // 기즈모 손잡이는 처리기가 없는 물체라 「빈 곳 클릭」으로 들어온다 — 그때 선택을 풀면 기즈모가 사라진다
        if (isGizmoBusy() || homvueGizmoState.dragging) return;
        if ((e as MouseEvent).button === 0) useHomvueStore.getState().select(null);
      }}
    >
      {parts.map(({ item, obj }, i) =>
        // 숨긴 천장은 처리기를 달지 않는다 — three.js 광선은 숨긴 물체도 맞혀서 천장이 모든 클릭을 가로챈다
        isCeiling(item) && !showCeiling ? (
          <CompiledPrimitive key={`apt-${i}`} object={obj} visible={false} />
        ) : (
          <CompiledPrimitive key={`apt-${i}`} object={obj} onClick={selectOnClick(`part:apt-${i}`)} onPointerDown={stopDown} />
        ),
      )}
      {parts.map(({ item, obj }, i) =>
        wallBakes[i] ? (
          <Suspense key={`aptmat-${i}`} fallback={null}>
            <BakedMaterials target={obj} item={item} url={wallBakes[i]!} shell />
          </Suspense>
        ) : null,
      )}
      {levelStatic && (
        <Suspense fallback={null}>
          <LevelStatic item={levelStatic} showCeiling={showCeiling} />
        </Suspense>
      )}
      {floors.map(({ key, item, baked }) => (
        <Suspense key={`${key}:${item.glb}`} fallback={null}>
          <ShellPart pkey={`part:floor:${key}`} item={item} room={key.split('-')[0]} baked={baked} />
        </Suspense>
      ))}
      {products.map(({ key, item, baked }) => (
        <Suspense key={`${key}:${item.glb}`} fallback={null}>
          <PlacedProduct pkey={key} item={item} baked={baked} selected={key === selected} dot={walk && dotKeys.has(key)} />
        </Suspense>
      ))}
      <HomvueTravelPoints plan={plan} />
      <HomvueGizmo />
      {plan.base.lights && <HomvueLights lights={plan.base.lights} />}
    </group>
  );
}

/**
 * 넓은 벽·천장 면의 발광 끄기 (사용자 지시 2026-10-20).
 * 언리얼 원본에 발광 재질이 깔린 면이 있다 — 43·59C·84A 천장 판(기본색 검정 + 흰 발광 3~8, 2.3×2.8m 이상)과
 * 벽 재질 Material__WALL(흰 발광 1.0, 43 외벽 등). 그대로 두면 천장·벽 전체가 빛나 보인다.
 * - 대상: 집 부품 중 한 면이 0.5㎡ 넘는 메시. 조명 기구의 작은 렌즈(수 cm)는 그대로 빛난다
 * - 발광을 끄고, 기본색이 거의 검정이면 발광색을 기본색으로 옮긴다(검은 천장이 되지 않게)
 * - 같은 재질을 작은 조명과 함께 쓸 수 있어 넓은 면에만 재질을 복제해 고친다
 */
const WIDE_SURFACE_M2 = 0.5;
const _box = new Box3();
const _size = new Vector3();
function isWideSurface(m: Object3D) {
  _box.setFromObject(m).getSize(_size);
  return Math.max(_size.x * _size.y, _size.y * _size.z, _size.x * _size.z) > WIDE_SURFACE_M2;
}
function unglowSurface(mesh: Mesh): boolean {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  let changed = false;
  const next = list.map((mat) => {
    const std = mat as MeshStandardMaterial;
    const glows = !!std.emissive && (std.emissiveMap != null || Math.max(std.emissive.r, std.emissive.g, std.emissive.b) * (std.emissiveIntensity ?? 1) > 0.001);
    if (!glows) return mat;
    changed = true;
    const c = std.clone();
    if (!c.map && Math.max(c.color.r, c.color.g, c.color.b) < 0.05) c.color.copy(c.emissive).multiplyScalar(0.9);
    c.emissive.setRGB(0, 0, 0);
    c.emissiveIntensity = 0;
    c.emissiveMap = null;
    c.userData.homvueUnlit = true;
    c.needsUpdate = true;
    return c;
  });
  if (changed) mesh.material = Array.isArray(mesh.material) ? next : next[0];
  return changed;
}

/** 기즈모 대상 등록 — Z 키 맞추기(FocusSelection)용 표식도 단다. key 를 돌려준다 */
function registerPart(key: string, obj: Object3D, extra?: Partial<HomvueGizmoTarget>): string {
  obj.userData.focusId = `homvue:${key}`;
  obj.userData.homvuePartKey = key;
  homvueProductObjects.set(key, { obj, ...extra });
  syncMatEdits(key); // 편집 패널에서 고친 재질(물체가 새로 만들어졌어도)
  return key;
}
function unregisterPart(key: string) {
  homvueProductObjects.delete(key);
  if (useHomvueStore.getState().selected === key) useHomvueStore.getState().select(null);
}

/** 누르면 선택 — 끌어서 둘러보던 손을 뗀 것(4px 넘게 움직임)·기즈모 손잡이 위·끄는 중엔 고르지 않는다.
 *  벽·바닥도 처리기를 단다 — R3F 는 처리기가 달린 물체만 광선 검사를 하므로, 없으면 벽 너머 상품이 눌린다. */
function canPick(e: ThreeEvent<MouseEvent>): boolean {
  if (e.delta > 4 || yieldsToDot(e) || isGizmoBusy() || homvueGizmoState.dragging) return false;
  e.stopPropagation();
  return true;
}
const selectOnClick = (key: string) => (e: ThreeEvent<MouseEvent>) => {
  if (!canPick(e)) return;
  const target = homvueProductObjects.get(key);
  if (target?.centerPivot) target.pivotAt = e.point.clone();
  useHomvueStore.getState().select(key);
};

/** 모듈 레벨의 아파트 부품(방 바닥) — 벽처럼 클릭을 받아 선택 + 기즈모 */
function ShellPart({ pkey, item, room, baked }: { pkey: string; item: PlacedItem; room?: string; baked: string | null }) {
  const g = useGLTF(item.glb!, DRACO) as unknown as { scene: Object3D };
  const obj = useMemo(() => {
    const o = prepare(g.scene.clone(true), item, true);
    // 방 바닥 — 카메라가 어느 방에 있는지(지금 방) 판단과 투어 점 바닥 붙이기에 쓴다
    if (room) o.userData.homvueFloorRoom = room;
    return o;
  }, [g, item, room]);
  useEffect(() => {
    registerPart(pkey, obj, { centerPivot: true, label: `방 바닥 · ${item.blueprint.split('/').pop()}` });
    return () => unregisterPart(pkey);
  }, [pkey, obj]);
  return (
    <>
      <CompiledPrimitive object={obj} onClick={selectOnClick(pkey)} onPointerDown={stopDown} />
      {baked && (
        <Suspense fallback={null}>
          <BakedMaterials target={obj} item={item} url={baked} shell />
        </Suspense>
      )}
    </>
  );
}

/**
 * 재질 변경 — 고른 재질로 구운 GLB(형상은 원래 것과 같다, 변환본 90쌍 실측)에서 **재질만** 가져와 원래 메시에 입힌다.
 * - 형상이 그대로라 경로 추적(MuTracer)은 재질 교체만 한다. GLB 를 통째로 바꾸면 새 형상이라 장면 전체를 다시
 *   올렸다(바닥 9초·벽 11초 실측).
 * - 새 GLB 를 받는 동안엔 이전 재질이 그대로 보인다(빈자리 없음). passive effect 는 Suspense 가 다시 걸려도 유지된다.
 * - 메시 수가 다르면(예외) 원래 재질을 둔다.
 */
function BakedMaterials({ target, item, url, shell = false }: { target: Object3D; item: PlacedItem; url: string; shell?: boolean }) {
  const g = useGLTF(url, DRACO) as unknown as { scene: Object3D };
  const src = useMemo(() => prepare(g.scene.clone(true), item, shell), [g, item, shell]);
  const compiled = useAsyncCompile(src);
  useEffect(() => {
    if (!compiled) return; // 셰이더가 준비될 때까지 이전 재질 유지
    const to = meshList(target);
    const from = meshList(src);
    if (to.length !== from.length) {
      console.warn('[Homvue] 재질 GLB 메시 수가 달라 건너뜀', url, to.length, from.length);
      return;
    }
    const prev = to.map((m) => m.material);
    to.forEach((m, i) => (m.material = from[i].material));
    return () => to.forEach((m, i) => (m.material = prev[i]));
  }, [target, src, url, compiled]);
  return null;
}

/**
 * 셰이더를 브라우저 병렬 컴파일(KHR_parallel_shader_compile)로 미리 만든다 — 끝나면 true.
 * 언리얼 조명 21~38개가 모든 재질 셰이더에 들어가 셰이더 하나 컴파일이 약 0.9초다. 그냥 그리면 처음 쓸 때
 * 화면을 멈추고 하나씩 컴파일해 43 평면을 열 때 42초(셰이더 48개) 멈췄다(실측). 병렬 컴파일은 화면을 멈추지 않는다.
 */
function useAsyncCompile(obj: Object3D): boolean {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const [done, setDone] = useState<Object3D | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let raf = 0;
    if (!watchMainTarget(scene, () => get().camera)) {
      // 처음 한 번은 장면이 실제로 그려져 출력 대상을 알 때까지 기다린다
      const wait = () => (mainTargetKnown ? setRetry((n) => n + 1) : (raf = requestAnimationFrame(wait)));
      raf = requestAnimationFrame(wait);
      return () => cancelAnimationFrame(raf);
    }
    // 실제 그릴 때와 같은 출력 대상으로 — 후처리(EffectComposer)는 중간 버퍼에 그려 톤매핑·색공간이 달라지고,
    // 그러면 셰이더 열쇠가 달라 미리 만든 것을 못 쓰고 다시 컴파일한다(실측: 48 → 90개)
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(mainTarget);
    const job = withRasterLights(scene, () => gl.compileAsync(obj, camera, scene));
    gl.setRenderTarget(prev);
    job
      .catch((e) => console.warn('[Homvue] 셰이더 미리 컴파일 실패 — 그릴 때 컴파일', e))
      .finally(() => {
        queueTextures(gl, obj);
        queueWarmDraw(gl, scene, obj);
        if (alive) setDone(obj);
      });
    return () => {
      alive = false;
    };
  }, [gl, camera, scene, obj, retry]);
  return done === obj;
}

/**
 * 텍스처 GPU 업로드를 뒤에서 조금씩 — 프레임마다 약 6ms 만.
 * three.js 는 물체가 처음 화면에 들어오는 순간 그 텍스처를 한꺼번에 올린다(밉맵 포함). 84A 는 텍스처 600여 장이라
 * 처음 둘러볼 때 2.5fps·4.7초 멈춤이었다(두 번째부터 48fps, 실측). 미리 컴파일(compileAsync)은 셰이더만 만든다.
 */
const texQueue: Texture[] = [];
const texQueued = new WeakSet<Texture>();
let texPump = 0;
function queueTextures(gl: WebGLRenderer, root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) {
        const t = v as Texture | null;
        if (t && (t as Texture).isTexture && !texQueued.has(t)) {
          texQueued.add(t);
          texQueue.push(t);
        }
      }
    }
  });
  if (!texPump && texQueue.length) {
    const pump = () => {
      const until = performance.now() + 6;
      while (texQueue.length && performance.now() < until) gl.initTexture(texQueue.shift()!);
      texPump = texQueue.length ? requestAnimationFrame(pump) : 0;
    };
    texPump = requestAnimationFrame(pump);
  }
}

/**
 * 미리 그려 보기 — 보이지 않는 1×1 버퍼에 메시를 한 번씩 그린다(프레임마다 몇 개씩).
 * Windows Chrome(ANGLE·D3D11)은 셰이더 컴파일 일부를 **처음 그릴 때**로 미룬다. 병렬 미리 컴파일이 끝났어도
 * 84A 를 처음 둘러볼 때 셰이더 대기(onFirstUse) 6.6초로 0.5~2.5fps 였다(실측, 두 번째부터 48fps).
 * - 전용 레이어(WARM_LAYER)에 그 메시와 조명만 올려 그린다 — 조명 수가 같아야 같은 셰이더다
 * - 출력 대상은 실제 장면과 같은 종류(후처리 중간 버퍼) — 셰이더 열쇠·D3D 출력 형식이 같아야 한다
 * - 그림자 지도는 이 렌더에서 다시 그리지 않는다(autoUpdate 잠시 끔)
 */
const WARM_LAYER = 30;
const warmQueue: Mesh[] = [];
const warmed = new Set<string>();
let warmDrawn = 0;
let warmPump = 0;
let warmRT: WebGLRenderTarget | null = null;
const warmCam = new PerspectiveCamera();
warmCam.layers.set(WARM_LAYER);
// 화면 시험용 — 남은 미리 그리기·텍스처 수
(window as unknown as { __homvueWarm?: unknown }).__homvueWarm = () => ({ warm: warmQueue.length, tex: texQueue.length, drawn: warmDrawn, target: mainTarget ? `${mainTarget.texture.type}/${mainTarget.samples}` : String(mainTarget) });
function queueWarmDraw(gl: WebGLRenderer, scene: Scene, root: Object3D) {
  // 셰이더는 재질·형상 속성 조합마다 하나 — 같은 조합은 한 번만 그려 보면 된다(84A 메시 5천 개 → 수백)
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const key = mats.map((x) => x.uuid).join('+') + '|' + Object.keys(m.geometry.attributes).sort().join(',');
    if (warmed.has(key)) return;
    warmed.add(key);
    warmQueue.push(m);
  });
  if (warmPump || !warmQueue.length) return;
  const pump = () => {
    warmPump = 0;
    // 후처리 없이 화면에 바로 그리는 상태면 미리 그려 볼 대상이 화면이라 하지 않는다(그릴 때 컴파일)
    if (!mainTarget) {
      if (!mainTargetKnown) warmPump = requestAnimationFrame(pump); // 아직 모름 — 다음 프레임에
      else warmQueue.length = 0;
      return;
    }
    const until = performance.now() + 8;
    while (warmQueue.length && performance.now() < until) {
      const batch: { m: Mesh; mask: number; culled: boolean }[] = [];
      while (warmQueue.length && batch.length < 6) {
        const m = warmQueue.shift()!;
        let shown = !!m.parent;
        for (let p: Object3D | null = m; p && shown; p = p.parent) shown = p.visible;
        if (shown) batch.push({ m, mask: m.layers.mask, culled: m.frustumCulled });
      }
      if (!batch.length) continue;
      scene.traverse((o) => {
        if ((o as { isLight?: boolean }).isLight) o.layers.enable(WARM_LAYER);
      });
      for (const b of batch) {
        b.m.layers.enable(WARM_LAYER);
        b.m.frustumCulled = false;
      }
      const t = mainTarget;
      // 실제 출력 대상과 같은 형식(자료형·다중 샘플) — ANGLE 은 출력 형식마다 그래픽 카드용 셰이더를 따로 만든다
      if (!warmRT || warmRT.texture.type !== t.texture.type || warmRT.samples !== t.samples) {
        warmRT?.dispose();
        warmRT = new WebGLRenderTarget(1, 1, { type: t.texture.type, samples: t.samples, depthBuffer: true });
      }
      warmDrawn += batch.length;
      const prev = gl.getRenderTarget();
      const autoShadow = gl.shadowMap.autoUpdate;
      const bg = scene.background;
      gl.shadowMap.autoUpdate = false;
      scene.background = null;
      gl.setRenderTarget(warmRT);
      withRasterLights(scene, () => gl.render(scene, warmCam));
      gl.setRenderTarget(prev);
      scene.background = bg;
      gl.shadowMap.autoUpdate = autoShadow;
      for (const b of batch) {
        b.m.layers.mask = b.mask;
        b.m.frustumCulled = b.culled;
      }
    }
    if (warmQueue.length) warmPump = requestAnimationFrame(pump);
  };
  warmPump = requestAnimationFrame(pump);
}

/** 래스터로 그릴 때 빠지는 조명(HomvueLights rasterSkip)을 잠시 숨긴 채로 — 셰이더의 조명 수가 실제 래스터와 같도록 */
function withRasterLights<T>(scene: Scene, fn: () => T): T {
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData.rasterSkip && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  try {
    return fn();
  } finally {
    for (const o of hidden) o.visible = true;
  }
}

/** 주 카메라로 장면을 그릴 때의 출력 대상 — 후처리가 켜져 있으면 중간 버퍼, 아니면 null(화면) */
let mainTarget: WebGLRenderTarget | null = null;
let mainTargetKnown = false;
const watched = new WeakSet<Scene>();
/** 출력 대상을 이미 알면 true */
function watchMainTarget(scene: Scene, currentCamera: () => Camera): boolean {
  if (watched.has(scene)) return mainTargetKnown;
  watched.add(scene);
  // 장면의 onBeforeRender 는 (renderer, scene, camera, renderTarget) 로 불린다(three WebGLRenderer.render)
  type SceneHook = (this: Scene, ...args: unknown[]) => void;
  const before = scene.onBeforeRender as unknown as SceneHook;
  (scene as unknown as { onBeforeRender: SceneHook }).onBeforeRender = function (...args) {
    // 경로 추적 모드의 편집 보조물 렌더(화면에 바로)는 기준으로 삼지 않는다 — MutracerRenderer OverlayPass
    // 경로 추적 모드에선 래스터 대체 화면(mainRasterPass)만 기준 — 그 밖의 렌더(편집 보조물·r3f 기본 렌더)는 화면에 바로 그려
    // 기준을 null 로 덮어써, 미리 그려 보기가 건너뛰어지고 첫 움직임 때 셰이더 대기 7~9초가 났다(실측)
    const sc = args[1] as Scene;
    const mt = useLightingStore.getState().giMode === 'mutracer';
    if (args[2] === currentCamera() && !sc.userData.overlayPass && (!mt || sc.userData.mainRasterPass)) {
      mainTarget = (args[3] as WebGLRenderTarget | null) ?? null;
      mainTargetKnown = true;
    }
    before.apply(this, args);
  };
  return false;
}

/** 셰이더가 준비된 뒤에 보이는 primitive — 준비 전엔 숨겨 둔다(그리지 않으니 컴파일도 안 일어난다) */
function CompiledPrimitive({ object, visible = true, ...rest }: { object: Object3D; visible?: boolean } & Record<string, unknown>) {
  const ready = useAsyncCompile(object);
  // 미니맵 캡처가 다 보일 때까지 기다리는 표시
  object.userData.homvueCompiling = !ready;
  return <primitive object={object} visible={visible && ready} {...rest} />;
}

function meshList(root: Object3D): Mesh[] {
  const list: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) list.push(o as Mesh);
  });
  return list;
}

/** 기본 레벨 Datasmith 메시 묶음. 이름(node_*)으로는 천장을 가를 수 없어 높이로 가른다 —
 *  바닥에서 2.2m 위에 있는 메시는 천장 쪽(천장 판·몰딩·천장 조명)으로 보고 블루프린트 천장과 똑같이 숨긴다/보인다 */
const CEILING_LIKE_Y = 2.2;
function LevelStatic({ item, showCeiling }: { item: PlacedItem; showCeiling: boolean }) {
  const g = useGLTF(item.glb!, DRACO) as unknown as { scene: Object3D };
  const obj = useMemo(() => {
    const o = prepare(g.scene.clone(true), item, true);
    o.updateMatrixWorld(true);
    const box = new Box3();
    o.traverse((m) => {
      if (!(m as { isMesh?: boolean }).isMesh) return;
      box.setFromObject(m);
      if (box.min.y > CEILING_LIKE_Y) m.userData.homvueCeiling = true;
    });
    return mergeByMaterial(o);
  }, [g, item]);
  useEffect(() => {
    obj.traverse((m) => {
      if (m.userData.homvueCeiling) m.visible = showCeiling;
    });
  }, [obj, showCeiling]);
  // 이 레벨에서 고른 메시 등록 해제(평면을 바꾸면)
  useEffect(
    () => () => {
      for (const k of (obj.userData.homvuePartKeys as Set<string> | undefined) ?? []) unregisterPart(k);
    },
    [obj],
  );
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!canPick(e)) return;
    const key = levelStaticTarget(obj, e.object as Mesh, e.faceIndex ?? -1);
    if (key) useHomvueStore.getState().select(key);
  };
  return <CompiledPrimitive object={obj} onClick={onClick} onPointerDown={stopDown} />;
}

/**
 * 레벨 메시 클릭 → 기즈모 대상 key. 합친 덩어리를 맞혔으면 맞힌 삼각형으로 원래 메시를 찾는다.
 * - 고르기만 해서는 덩어리를 쪼개지 않는다 — 원래 메시 자리에 빈 자리 표시(Group)만 만들어 기즈모를 단다.
 *   덩어리 형상을 바꾸면 경로 추적이 장면 형상을 다시 올려 몇 초 래스터로 돌아가기 때문이다
 * - 처음 잡아 끌 때(onDragStart) 그 메시를 덩어리에서 떼어 자리 표시 아래로 옮긴다 — 끄는 동안은 어차피 래스터 화면이다
 */
function levelStaticTarget(root: Object3D, hit: Mesh, faceIndex: number): string | null {
  const keys = ((root.userData.homvuePartKeys as Set<string> | undefined) ??= new Set<string>());
  for (let o: Object3D | null = hit; o && o !== root; o = o.parent) {
    const k = o.userData.homvuePartKey as string | undefined;
    if (k && homvueProductObjects.has(k)) return k;
  }
  const merged = hit.userData.homvueMerged as MergeSource[] | undefined;
  if (!merged) {
    // 합치지 않은 메시(여러 재질·변형) — 상자 가운데에 축 그룹을 끼워 그 그룹을 옮긴다(형상은 그대로라 바로 한다)
    const geo = hit.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const center = geo.boundingBox!.getCenter(new Vector3());
    const pivot = new Group();
    pivot.name = hit.name;
    hit.updateMatrix();
    new Matrix4().multiplyMatrices(hit.matrix, new Matrix4().makeTranslation(center.x, center.y, center.z)).decompose(pivot.position, pivot.quaternion, pivot.scale);
    hit.parent!.add(pivot);
    pivot.add(hit);
    hit.position.copy(center).negate();
    hit.quaternion.identity();
    hit.scale.set(1, 1, 1);
    hit.matrixAutoUpdate = true;
    const localBox = geo.boundingBox!.clone().translate(center.clone().negate());
    pivot.userData.focusBox = localBox;
    const key = registerPart(`part:static:${hit.uuid}`, pivot, { localBox, label: `레벨 메시 · ${hit.name}` });
    hit.userData.homvuePartKey = key;
    keys.add(key);
    return key;
  }
  if (faceIndex < 0) return null;
  let at = 0;
  const source = merged.find((s) => (at += s.tris) > faceIndex);
  if (!source) return null;
  const key = `part:static:${source.src.uuid}`;
  if (homvueProductObjects.has(key)) return key;
  // 기즈모 중심 = 메시 상자 가운데 — Datasmith 메시는 원점이 레벨 원점에 있는 것이 많아 손잡이가 엉뚱한 데 뜬다
  const geo = source.src.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const center = geo.boundingBox!.getCenter(new Vector3());
  const proxy = new Group();
  proxy.name = source.src.name;
  new Matrix4().multiplyMatrices(source.local, new Matrix4().makeTranslation(center.x, center.y, center.z)).decompose(proxy.position, proxy.quaternion, proxy.scale);
  hit.parent!.add(proxy);
  const localBox = geo.boundingBox!.clone().translate(center.clone().negate());
  proxy.userData.focusBox = localBox;
  let split = false;
  registerPart(key, proxy, {
    label: `레벨 메시 · ${source.src.name}`,
    materials: [source.mat],
    localBox,
    onDragStart: () => {
      if (split) return;
      split = true;
      splitFromMerged(source);
      const mesh = new ThreeMesh(geo, source.mat);
      mesh.name = source.src.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.homvuePartKey = key;
      if (source.ceiling) mesh.userData.homvueCeiling = true;
      mesh.position.copy(center).negate();
      proxy.visible = source.owner.visible;
      proxy.add(mesh);
    },
  });
  keys.add(key);
  return key;
}

/** 덩어리에서 메시 하나를 뺀다 — 남은 메시로 형상을 다시 합쳐 새 메시로 바꿔 끼운다(남은 게 없으면 덩어리를 뺀다) */
function splitFromMerged(source: MergeSource) {
  const owner = source.owner;
  const list = (owner.userData.homvueMerged as MergeSource[]).filter((s) => s !== source);
  const parent = owner.parent!;
  parent.remove(owner);
  owner.geometry.dispose();
  if (!list.length) return;
  const geos = list.map((s) => s.src.geometry.clone().applyMatrix4(s.local));
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const x of geos) x.dispose();
  if (!geo) return;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const next = new ThreeMesh(geo, owner.material);
  next.name = owner.name;
  next.castShadow = owner.castShadow;
  next.receiveShadow = owner.receiveShadow;
  next.visible = owner.visible;
  next.userData = { ...owner.userData, homvueMerged: list };
  for (const s of list) s.owner = next;
  parent.add(next);
}

/**
 * 움직이지 않는 레벨 메시 묶음을 재질별로 한 덩어리로 합친다 — 같은 재질·같은 정점 속성·천장 여부끼리.
 * 84A 레벨 메시는 1,350개(재질 123개)라 래스터가 화면마다 그만큼 그리기 명령을 내려 기본 뷰어 회전이 초당 43장이었다
 * (그리기 명령 준비가 주 스레드 시간 대부분, 실측). 합친 형상은 원래 위치(월드 변환)를 정점에 굽는다.
 * 합친 메시 안의 원래 메시는 MergeSource 로 기억해 두어 클릭으로 고르고 끌 때 떼어 낸다(levelStaticTarget).
 */
/** 합친 덩어리 안의 원래 메시 하나 — 클릭한 삼각형으로 찾고, 끌 때 떼어 낸다 */
interface MergeSource {
  src: Mesh;
  /** 루트 기준 변환 */
  local: Matrix4;
  /** 삼각형 수 — 합친 순서대로 이어 붙는다 */
  tris: number;
  mat: Material;
  ceiling: boolean;
  /** 지금 이 메시가 들어 있는 덩어리 */
  owner: ThreeMesh;
}

function mergeByMaterial(root: Object3D): Object3D {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<string, { mat: Material; ceiling: boolean; geos: BufferGeometry[]; sources: MergeSource[] }>();
  const keep: Object3D[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material) || m.geometry.morphAttributes.position) {
      keep.push(m);
      return;
    }
    const geo = m.geometry;
    const key = [m.material.uuid, m.userData.homvueCeiling ? 'c' : '', geo.index ? 'i' : '', Object.keys(geo.attributes).sort().join(',')].join('|');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat: m.material, ceiling: !!m.userData.homvueCeiling, geos: [], sources: [] }));
    const local = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
    g.geos.push(geo.clone().applyMatrix4(local));
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    g.sources.push({ src: m, local, tris, mat: m.material, ceiling: !!m.userData.homvueCeiling, owner: null as unknown as ThreeMesh });
  });
  const out = new Group();
  out.name = root.name;
  out.userData = root.userData;
  out.matrixAutoUpdate = false;
  out.matrix.copy(root.matrix);
  for (const { mat, ceiling, geos, sources } of groups.values()) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    if (geos.length > 1) for (const x of geos) x.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new ThreeMesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (ceiling) mesh.userData.homvueCeiling = true;
    for (const s of sources) s.owner = mesh;
    mesh.userData.homvueMerged = sources;
    out.add(mesh);
  }
  // 여러 재질·변형 메시는 그대로 — 루트 기준 위치로 옮겨 붙인다
  for (const m of keep) {
    const c = m.clone();
    new Matrix4().multiplyMatrices(inv, m.matrixWorld).decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  return out;
}

/** 아래에 깔린 홈플래너3 물체(기본 바닥판 등)는 pointerdown 으로 선택되므로 거기서도 막는다 */
const stopDown = (e: ThreeEvent<PointerEvent>) => {
  if (isGizmoBusy()) return;
  if (!yieldsToDot(e)) e.stopPropagation();
};

/** 투어 점은 항상 위에 그려지므로(언리얼 화면 UI 점과 같게) 점이 함께 맞았으면 점에 양보한다 */
function yieldsToDot(e: ThreeEvent<MouseEvent | PointerEvent>): boolean {
  return e.intersections.some((i) => {
    for (let o: Object3D | null = i.object; o; o = o.parent) if (o.userData?.homvueDot) return true;
    return false;
  });
}

/** 상품 하나 — 같은 GLB 가 여러 번 놓이면(다운라이트 등) 캐시된 원본을 복제해 쓴다.
 *  누르면 선택 — 끌어서 둘러보던 손을 뗀 것(4px 넘게 움직임)은 선택으로 치지 않는다. */
function PlacedProduct({ pkey, item, baked, selected, dot }: { pkey: string; item: PlacedItem; baked: string | null; selected: boolean; dot: boolean }) {
  const g = useGLTF(item.glb!, DRACO) as unknown as { scene: Object3D };
  const obj = useMemo(() => prepare(g.scene.clone(true), item), [g, item]);
  // 기즈모가 붙을 물체 등록 — 옮기면 item 이 바뀌어 새 물체가 다시 등록된다. Z 키 맞추기(FocusSelection)용 표식도
  useEffect(() => {
    obj.userData.focusId = `homvue:${pkey}`;
    homvueProductObjects.set(pkey, { obj, item, label: item.product?.name ?? item.blueprint.split('/').pop() });
    syncMatEdits(pkey);
    // 고른 상품이 옮겨져 새 물체가 됐으면 기즈모·편집 패널이 바로 새 물체를 보게(옛 물체에 붙은 채 남지 않게)
    if (useHomvueStore.getState().selected === pkey) useHomvueStore.getState().bumpEdit();
    return () => {
      if (homvueProductObjects.get(pkey)?.obj === obj) homvueProductObjects.delete(pkey);
    };
  }, [pkey, obj, item]);
  // 선택 상자 — 부모(아파트 그룹) 좌표의 경계. 붙이기 전이라 matrixWorld = 자기 행렬
  const box = useMemo(() => {
    obj.updateMatrixWorld(true);
    return new Box3().setFromObject(obj);
  }, [obj]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || yieldsToDot(e) || isGizmoBusy() || homvueGizmoState.dragging) return;
    e.stopPropagation();
    useHomvueStore.getState().select(pkey);
  };
  return (
    <>
      <CompiledPrimitive object={obj} onClick={onClick} onPointerDown={stopDown} />
      {baked && (
        <Suspense fallback={null}>
          <BakedMaterials target={obj} item={item} url={baked} />
        </Suspense>
      )}
      {selected && <box3Helper args={[box, 0xfacc15]} />}
      {dot && (
        <Html position={[(box.min.x + box.max.x) / 2, box.max.y + 0.08, (box.min.z + box.max.z) / 2]} center zIndexRange={[15, 0]}>
          <button
            data-homvue-dot={pkey}
            onClick={() => {
              if (!isGizmoBusy() && !homvueGizmoState.dragging) useHomvueStore.getState().select(pkey);
            }}
            style={selected ? dotActiveStyle : dotStyle}
            title={item.product?.name}
          />
        </Html>
      )}
    </>
  );
}

/** GLB 하나라도 못 불러오면 장면을 깨뜨리지 않고 패널에 오류만 표시 */
class LoadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    useHomvueStore.getState().setLoadState('error', String((error as Error)?.message ?? error));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const dotStyle: React.CSSProperties = {
  width: 14, height: 14, borderRadius: 7, border: '2px solid #fff', background: 'rgba(2,132,199,0.85)',
  boxShadow: '0 0 0 2px rgba(2,132,199,0.35)', cursor: 'pointer', padding: 0,
};
const dotActiveStyle: React.CSSProperties = { ...dotStyle, background: '#facc15', boxShadow: '0 0 0 3px rgba(250,204,21,0.45)' };
