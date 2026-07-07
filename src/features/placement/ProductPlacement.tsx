import { Component, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box3, DoubleSide, Group, Mesh, MeshStandardMaterial, Object3D, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { standardToPhysical } from '@/domain/materials/standardToPhysical';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { requestShadowUpdate } from '@/engine/lighting/ShadowDemand';
import { registerGizmo, isGizmoBusy } from '@/features/models/gizmoGuard';
import { clearOtherSelections } from '@/features/selection/clearSelections';
import { Edges, Html, TransformControls, useGLTF } from '@react-three/drei';
import { HelperScaler, isHelperRegionName, replaceableSizeOf, pickReplaceableSize } from '@/domain/products/HelperScaler';
import { readDpTypes, readDoorSlots } from '@/domain/products/ModelMarkers';
import { usePlacedProductStore, type PendingProduct, type PlacedProduct, type DoorVariant } from './placedProductStore';

const M = 1 / 1000; // mm → m
/** 드래그 중 상태 세터 — PlacedItem 직접 드래그 시 리사이즈 핸들 숨김 공유용. */
const setDraggingRef: { current: ((v: boolean) => void) | null } = { current: null };
/** 배치 상품 id → 씬 그룹 — 단일 선택 기즈모를 실제 오브젝트에 직접 부착하기 위한 레지스트리. */
const placedGroupRefs = new Map<string, Group>();
/** 도어를 몸통 앞면에서 앞으로 띄우는 간격(m). 5mm. */
const DOOR_FRONT_GAP = 5 * M;
/** 서랍(M) 슬라이드 시작 지연(초) — 도어가 **완전히** 열린 뒤 서랍이 나오도록(도어 애니메이션 ~0.8s). */
const DOOR_OPEN_DELAY = 0.9;
/** 서랍이 여러 개일 때 아래→위 순차 간격(초). */
const DRAWER_STAGGER = 0.35;
/** 상품 간 스냅(자석) 임계값(m). 이동 중 인접 상품 모서리와 이 거리 안이면 붙는다. */
const SNAP_DIST = 0.05;

/** 상품의 XZ 평면 AABB(m). 회전(ry≈90/270)이면 폭/깊이를 교환. ox/oz는 임시 이동량. */
function footprintXZ(p: PlacedProduct, ox = 0, oz = 0) {
  const rot = (((p.ry % 180) + 180) % 180);
  const near90 = Math.abs(rot - 90) < 45;
  const fw = p.renderW ?? p.w, fd = p.renderD ?? p.d; // 실제 렌더 크기 우선(스냅 시 시각 flush)
  const ex = (near90 ? fd : fw) * M; // x 방향 폭
  const ez = (near90 ? fw : fd) * M; // z 방향 깊이
  const cx = p.x + ox, cz = p.z + oz;
  return { minx: cx - ex / 2, maxx: cx + ex / 2, minz: cz - ez / 2, maxz: cz + ez / 2 };
}

/**
 * 이동 중 선택 상품(합집합 AABB)이 다른 상품과 충돌·근접하면 모서리를 맞춰 붙일 보정량(dx,dz)을 계산.
 * - 한 축이 겹치면(또는 근접) 반대 축의 모서리를 flush(맞닿음/정렬)로 스냅.
 */
function computeSnap(
  union: { minx: number; maxx: number; minz: number; maxz: number },
  others: PlacedProduct[],
) {
  let bestDx = 0, bestDz = 0, bx = SNAP_DIST, bz = SNAP_DIST;
  for (const o of others) {
    const f = footprintXZ(o);
    const zOverlap = Math.min(union.maxz, f.maxz) - Math.max(union.minz, f.minz);
    if (zOverlap > -SNAP_DIST) { // z가 겹치거나 근접 → x 모서리 스냅
      for (const [ue, oe] of [[union.minx, f.maxx], [union.maxx, f.minx], [union.minx, f.minx], [union.maxx, f.maxx]]) {
        const d = oe - ue; if (Math.abs(d) < bx) { bx = Math.abs(d); bestDx = d; }
      }
    }
    const xOverlap = Math.min(union.maxx, f.maxx) - Math.max(union.minx, f.minx);
    if (xOverlap > -SNAP_DIST) { // x가 겹치거나 근접 → z 모서리 스냅
      for (const [ue, oe] of [[union.minz, f.maxz], [union.maxz, f.minz], [union.minz, f.minz], [union.maxz, f.maxz]]) {
        const d = oe - ue; if (Math.abs(d) < bz) { bz = Math.abs(d); bestDz = d; }
      }
    }
  }
  return { dx: bestDx, dz: bestDz };
}

/**
 * 인접 도어의 허용 교차 깊이 하한. crossDepth는 0=힌지쪽(깊이 관통)~1=자유끝(살짝 접촉),
 * 안 겹치면 1. **1.0 = 관통 전혀 불가**(맞닿기 직전까지만 열림). 값을 낮추면 그만큼 서로
 * 뚫고 들어가는 걸 허용. 도어끼리 관통하면 안 되므로 1.0 유지.
 */
const DOOR_MIN_CROSS = 1.0;
/** 충돌 도어를 접촉 지점보다 더 닫는 여유 각(라디안). 5° — 맞닿아 붙는 느낌 방지. */
const DOOR_CLEAR_RAD = (5 * Math.PI) / 180;
// ── 도어 열림 제어: 도어 패널을 2D(XZ) 선분으로 보고, 겹침(교차)이 너무 깊어지기 직전까지 연다 ──
type P2 = { x: number; z: number };
/** 도어 패널 선분 [힌지, 자유끝]을 월드 XZ로. thetaRad = 열림 각(라디안, slotPos 방향 자동). */
function doorPanel(d: PlacedProduct, thetaRad: number): [P2, P2] {
  const ry = (d.ry * Math.PI) / 180;
  const halfW = (d.w * M) / 2;
  const hingeX = d.slotPos === 'R' ? halfW : -halfW;
  const a = (d.slotPos === 'R' ? 1 : -1) * thetaRad; // 열림 방향(L=−, R=+)
  const fvx = -2 * hingeX; // 닫힘 시 힌지→자유끝 벡터(x)
  const hinge = { x: hingeX, z: 0 };
  const free = { x: hingeX + fvx * Math.cos(a), z: -fvx * Math.sin(a) };
  const toW = (pt: P2): P2 => ({ x: d.x + pt.x * Math.cos(ry) + pt.z * Math.sin(ry), z: d.z - pt.x * Math.sin(ry) + pt.z * Math.cos(ry) });
  return [toW(hinge), toW(free)];
}
/**
 * 두 도어 선분 교차점의 "깊이" = min(t,u). 0=힌지쪽(완전 포개짐) ~ 1=자유끝(살짝 겹침).
 * 교차하지 않으면 1(간섭 없음). 열림 각이 커질수록 값이 작아진다(더 깊이 포개짐).
 */
function crossDepth(a1: P2, a2: P2, b1: P2, b2: P2): number {
  const d = (a2.x - a1.x) * (b2.z - b1.z) - (a2.z - a1.z) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return 1;
  const t = ((b1.x - a1.x) * (b2.z - b1.z) - (b1.z - a1.z) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.z - a1.z) - (b1.z - a1.z) * (a2.x - a1.x)) / d;
  if (t > 0 && t < 1 && u > 0 && u < 1) return Math.min(t, u);
  return 1;
}
/**
 * 도어별 열림 각(도). 인접 도어는 **부분 겹침 허용**하되, 교차 깊이가 DOOR_MIN_CROSS 밑으로
 * (=거의 완전히 포개짐) 내려가기 직전까지만 연다. 얕게 겹치거나 안 겹치면 설정값 그대로 활짝.
 */
function computeDoorClamp(placed: PlacedProduct[], openDeg: number): Map<string, number> {
  const openRad = (openDeg * Math.PI) / 180;
  const doors = placed.filter((d) => d.parentId && d.slotPos);
  const clamp = new Map<string, number>();
  for (const d of doors) clamp.set(d.id, openRad);
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const A = doors[i], B = doors[j];
      const [a1, a2] = doorPanel(A, openRad), [b1, b2] = doorPanel(B, openRad);
      if (crossDepth(a1, a2, b1, b2) >= DOOR_MIN_CROSS) continue; // 안 겹치거나 얕게 겹침 → 활짝
      // 너무 깊게 포개짐 → 교차 깊이가 MIN이 되는 각까지만 축소(부분 겹침은 유지).
      let lo = 0, hi = openRad;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        const [pa1, pa2] = doorPanel(A, mid), [pb1, pb2] = doorPanel(B, mid);
        if (crossDepth(pa1, pa2, pb1, pb2) >= DOOR_MIN_CROSS) lo = mid; else hi = mid;
      }
      // 접촉 직전(lo)에서 5° 더 닫아 여유 간격 확보(맞닿아 붙는 느낌 방지).
      const safe = Math.max(0, lo - DOOR_CLEAR_RAD);
      clamp.set(A.id, Math.min(clamp.get(A.id)!, safe));
      clamp.set(B.id, Math.min(clamp.get(B.id)!, safe));
    }
  }
  const deg = new Map<string, number>();
  clamp.forEach((r, id) => deg.set(id, (r * 180) / Math.PI));
  return deg;
}
/** 서랍 돌출량 = 깊이 × 이 비율. 2/3면 뒤 1/3이 남아 몸통을 벗어나지 않음. */
const DRAWER_OPEN_RATIO = 2 / 3;

/** 모델 로드 실패 시 박스로 폴백 */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** 배치 박스(모델 없을 때 / 폴백) — 그룹 로컬 좌표 기준 */
function BoxMesh({ p, sel }: { p: PlacedProduct; sel: boolean }) {
  return (
    <mesh position={[0, ((p.lift ?? 0) + p.h / 2) * M, 0]} castShadow receiveShadow>
      <boxGeometry args={[p.w * M, p.h * M, p.d * M]} />
      {/* 어드민이 컬러를 지정하면 그 색으로(선택 표시는 엣지로), 없으면 기존 우드 톤 */}
      <meshStandardMaterial color={p.color ?? (sel ? '#b98a3e' : '#c9a063')} roughness={0.6} />
      {sel && <Edges scale={1.001} threshold={15} color="#22d3ee" />}
    </mesh>
  );
}

/**
 * 등록된 모델(GLB)을 컨텐츠 W/D/H에 맞춰 표시.
 *
 * helper(L/R/T/B/F/K) 영역이 있는 모델은 **helper 기반 정점 스트레치**로 좌우/상하/앞뒤 패널만
 * 이동시켜 형태·텍스처를 보존한다(통짜 스케일 금지). helper가 없는 모델은 기존처럼 균등 스케일 폴백.
 */
function FittedModel({ url, p, sel, ghost = false }: { url: string; p: PlacedProduct; sel: boolean; ghost?: boolean }) {
  const { scene } = useGLTF(url, `${import.meta.env.BASE_URL}draco/`);
  const { gl, camera, scene: rootScene } = useThree();
  // 고스트 첫 등장 시 셰이더를 **비동기 선컴파일** — 동기 컴파일이 첫 프레임을 수백 ms 블록하던
  // 멈춤을 제거. 컴파일 끝날 때까지 모델은 숨기고 파란 고스트 박스만 표시(즉시 피드백).
  // 이후 실제 배치는 프로그램/텍스처 캐시를 재사용하므로 빠르다.
  const [compiled, setCompiled] = useState(!ghost);
  // ⭐ 무거운 1회성 빌드 — clone/재질 변환/HelperScaler 구성은 GLB(scene)당 한 번만.
  //   치수 변경은 아래 useMemo에서 scaler.applyResize(차분)만 재호출 → 리사이즈 드래그가
  //   매 프레임 모델 통째 재생성하던 버벅임 제거.
  const built = useMemo(() => {
    // 노드 트리만 clone — geometry 는 useGLTF 캐시와 **참조 공유**(Object3D.clone 기본 동작).
    // 정점을 실제로 변형할 메시만 아래에서 선별 복제한다. (전 메시 geometry.clone() 이
    // 배치 순간 수백 ms 멈춤의 주범이었다.)
    const clone = scene.clone(true);
    clone.traverse((o) => {
      if (o instanceof Mesh) {
        // 기본 도형(BoxMesh)처럼 그림자를 주고받게 — GLB 메시는 기본값이 false라 조명/그림자/AO가
        // 안 먹는 것처럼 보인다. 그림자 캐스팅+수신 켜서 실시간 렌더 환경요소를 동일 적용.
        o.castShadow = true;
        o.receiveShadow = true;
        // 재질을 MeshPhysicalMaterial로 변환 — ImportedModels와 동일. HDRI 환경맵(IBL) 반사·조명
        // 반응이 살아난다. (GLB 기본 Standard 재질은 환경 반사가 약함.) 인스턴스 전용 복제이므로
        // 공유 캐시 오염 없음.
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const conv = mats.map((m) => standardToPhysical(m as MeshStandardMaterial));
        o.material = Array.isArray(o.material) ? conv : conv[0];
      }
    });

    const scaler = HelperScaler.build(clone);
    const useHelper = scaler.regionCount > 0;
    // 변형(정점 이동) 대상 메시만 geometry 를 인스턴스 전용으로 복제 — 공유 캐시 오염 방지.
    // __ownGeometry 마킹은 unmount dispose 가 공유 geometry 를 지우지 않게 하는 기준.
    if (useHelper) {
      for (const m of scaler.mutatedMeshes) {
        m.geometry = m.geometry.clone();
        m.userData.__ownGeometry = true;
      }
    }
    if (typeof window !== 'undefined' && (window as unknown as { __HELPER_DEBUG__?: boolean }).__HELPER_DEBUG__) {
      const names: string[] = [];
      clone.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) names.push(o.name || '(unnamed)'); });
      // eslint-disable-next-line no-console
      console.log('[FittedModel] regionCount=', scaler.regionCount, 'useHelper=', useHelper, 'meshes=', names, scaler.getDiagnostics());
    }
    // 몸통 DP 타입(모델에 보존된 DP 노드) — 도어 매칭용. 없으면 [] (도어/일반 상품).
    const dpTypes = readDpTypes(clone);
    return { clone, scaler, useHelper, dpTypes };
  }, [scene]);

  const { obj, scale, pos, dpTypes, doorSlots, selSize, bodyCx, bodyCz, bodyMinY, drawers } = useMemo(() => {
    const { clone, scaler, useHelper, dpTypes } = built;
    // ⭐ 측정 좌표계 격리 — clone은 마운트 후에도 재계산되므로, 상위(배치 그룹 x/z/ry)와 자기
    //   변환(pos/scale 프롭)이 붙은 채 bbox/슬롯을 재면 월드 좌표가 섞여 pos 정렬값이 오염된다
    //   (리사이즈 드래그 시 깜빡임·위치 이탈). 측정 동안 부모에서 분리+identity(최초 렌더와 동일한
    //   로컬 기준)로 되돌리고, 끝나면 원상 복구한다. (R3F가 커밋 시 프롭을 다시 적용)
    const holder = clone.parent;
    const savedPos = clone.position.clone(), savedQuat = clone.quaternion.clone(), savedScale = clone.scale.clone();
    if (holder) holder.remove(clone);
    clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.set(1, 1, 1);
    clone.updateMatrixWorld(true);
    try {
    // 크기 정책: 몸통(변형 대상 메시)을 입력 치수(p.w/h/d)에 맞춰 helper 영역 기준 스트레치.
    // (GLB는 변환 시 mm→m 정규화 → origSize도 미터이므로 delta가 정상 범위. replaceableW
    //  구성품은 isTransformable에서 제외되어 고정 크기 유지된다.)
    // 목표 치수(m, y-up): x=폭(w), y=높이(h), z=깊이(d)
    // applyResize는 마지막 목표에서의 **차분만** 적용 — 같은 clone으로 연속 리사이즈 가능.
    if (useHelper) scaler.applyResize(new Vector3(p.w * M, p.h * M, p.d * M));

    // replaceable 구성품: 입력 폭(p.w)과 같은(또는 구간) 사이즈 명칭만 노출.
    const sizes = new Set<number>();
    clone.traverse((o) => {
      const s = replaceableSizeOf(o.name);
      if (s != null) sizes.add(s);
    });
    const chosenSize = pickReplaceableSize(sizes, p.w);

    // 보조 메시 렌더 처리.
    // 주의: `replaceableW`/`replaceableH` **컨테이너 노드는 숨기지 않는다**. FBX→GLB 변환기는
    // (기존 glTF 익스포터와 달리) 이 그룹 노드를 그대로 보존하는데, 컨테이너를 visible=false로
    // 두면 three.js 특성상 그 하위의 선택된 사이즈 메시까지 전부 안 보인다. 노출 제어는 오직
    // 숫자 이름 노드(900/1000…)의 chosenSize 일치 여부로만 한다.
    clone.traverse((o) => {
      const n = o.name.toLowerCase();
      const size = replaceableSizeOf(o.name);
      if (size != null) {
        o.visible = size === chosenSize; // 선택된 사이즈 구성품만 노출
      } else if (isHelperRegionName(o.name) || n === 'helper' || n === 'hotspot' || n === 'dp') {
        o.visible = false; // helper 영역/보조(DP/hotspot) 노드만 숨김 (replaceable 컨테이너는 유지)
      }
    });

    // 도어 슬롯 — 몸통 hotspot의 DL/DR(+짝 마커)로 개수·사이즈·위치 계산.
    // applyResize 이후의 clone이므로 마커도 함께 변형되어 스트레치된 몸통에 맞는 도어 크기가 나온다.
    const doorSlots = readDoorSlots(clone);

    clone.updateMatrixWorld(true);
    // 센터/바닥 정렬·선택박스용 bbox는 **실제로 보이는 메시만**으로 계산한다.
    // expandByObject는 visible=false도 포함하므로, 마커(hotspot DL/DR/X/Y, DP X/HD)·헬퍼영역
    // (L/K/T/R/F)·미선택 replaceable이 끼어 박스가 실제 모델보다 커진다(예: 마커가 x=±447 → 폭 오차).
    // 부모까지 거슬러 올라가 모두 visible일 때만 포함 → 보이는 모델에 딱 맞는 박스.
    const isEffVisible = (o: Object3D): boolean => {
      let n: Object3D | null = o;
      while (n) { if (!n.visible) return false; n = n.parent; }
      return true;
    };
    const box = new Box3();
    clone.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh && isEffVisible(o)) box.expandByObject(o);
    });
    const size = new Vector3(); box.getSize(size);
    const center = new Vector3(); box.getCenter(center);

    // 서랍(M) 슬라이드 대상 — hotspot 안의 M 노드(서브트리=서랍). **보이는(선택 사이즈) 서랍만**.
    // 열림 시 **월드 앞(+z) 방향**으로 깊이의 3/2만큼 돌출. (부모에 회전이 있어도 옆으로 새지 않게
    // 월드 +z를 부모 로컬 방향으로 변환해 이동.) 여러 개면 **아래(y 작은)부터** 순차.
    const drawers: { node: Object3D; basePos: Vector3; dir: Vector3; offset: number; y: number }[] = [];
    const _q = new Quaternion(); const _s = new Vector3();
    clone.traverse((o) => {
      if (!/^M\d*(_\d+)?$/i.test(o.name.trim()) || !isEffVisible(o)) return;
      const b = new Box3().setFromObject(o); // 월드(m) bbox
      const depth = isFinite(b.max.z - b.min.z) ? b.max.z - b.min.z : 0.3;
      const cy = isFinite(b.min.y + b.max.y) ? (b.min.y + b.max.y) / 2 : 0;
      const parent = o.parent ?? o;
      // 월드 +z를 부모 로컬 방향으로 변환(부모 회전 보정).
      parent.getWorldQuaternion(_q);
      const dir = new Vector3(0, 0, 1).applyQuaternion(_q.clone().invert()).normalize();
      // ⚠ node.position은 부모 **로컬 단위**(FBX mm: 루트 scale 0.001). 월드 돌출량(m)을
      //   부모 월드 스케일로 나눠 로컬 단위로 환산해야 실제로 그만큼 움직인다.
      parent.getWorldScale(_s);
      const sUniform = (Math.abs(_s.x) + Math.abs(_s.y) + Math.abs(_s.z)) / 3 || 1;
      const offsetLocal = (DRAWER_OPEN_RATIO * (depth || 0.3)) / sUniform;
      // clone이 재사용되므로(치수 변경 시 재계산) 원위치는 최초 1회만 캡처 — 서랍이 열려 있는
      // 중에 재계산돼도 열림 오프셋이 원위치로 굳지 않게.
      const bp = (o.userData.__basePos ??= o.position.clone()) as Vector3;
      drawers.push({ node: o, basePos: bp.clone(), dir, offset: offsetLocal, y: cy });
    });
    drawers.sort((a, b) => a.y - b.y); // 아래부터 1번

    // 도어 피봇(힌지) 방향 자동 감지 — 모델 원점(피봇) 기준 패널이 +x로 뻗으면(center.x>0) 피봇=왼쪽 → 자연 L,
    // -x로 뻗으면 피봇=오른쪽 → 자연 R. 슬롯 면(slotPos)이 자연 면과 다르면 미러(X축 반전)로 반대쪽 피봇 생성.
    const isDoorItem = !!p.slotPos;
    const naturalSide: 'L' | 'R' = center.x >= 0 ? 'L' : 'R';
    const mirror = isDoorItem && p.slotPos !== naturalSide;
    const mx = mirror ? -1 : 1;

    if (typeof window !== 'undefined' && (window as unknown as { __HELPER_DEBUG__?: boolean }).__HELPER_DEBUG__) {
      // eslint-disable-next-line no-console
      console.log('[FittedModel] 몸통 size(m)=', size.toArray().map((v) => +v.toFixed(3)),
        '입력 p(m)=', [p.w * M, p.h * M, p.d * M].map((v) => +v.toFixed(3)),
        'min/max=', box.min.toArray().map((v) => +v.toFixed(3)), box.max.toArray().map((v) => +v.toFixed(3)));
    }

    if (useHelper) {
      // 이미 정점이 목표 치수로 변형됨 → 스케일 없이 중심/바닥 정렬만.
      return {
        obj: clone,
        scale: [mx, 1, 1] as [number, number, number],
        pos: [-mx * center.x, (p.lift ?? 0) * M - box.min.y, -center.z] as [number, number, number],
        dpTypes,
        doorSlots,
        // 선택 박스는 실제 몸통 bbox(스트레치 결과)에 맞춘다 — 등록치수(p)와 미세하게 달라도 "딱 맞게".
        selSize: [size.x, size.y, size.z] as [number, number, number],
        // 도어 위치 계산용 — 몸통 모델 센터(x,z)와 바닥(min.y). (모델은 pos로 센터/바닥 정렬됨)
        bodyCx: center.x, bodyCz: center.z, bodyMinY: box.min.y,
        drawers,
      };
    }
    // helper 없는 모델: 기존 균등 스케일 폴백.
    const sx = (p.w * M) / (size.x || 1);
    const sy = (p.h * M) / (size.y || 1);
    const sz = (p.d * M) / (size.z || 1);
    return {
      obj: clone,
      scale: [sx * mx, sy, sz] as [number, number, number],
      pos: [-mx * center.x * sx, (p.lift ?? 0) * M - box.min.y * sy, -center.z * sz] as [number, number, number],
      dpTypes,
      doorSlots,
      selSize: [size.x * sx, size.y * sy, size.z * sz] as [number, number, number],
      bodyCx: center.x * sx, bodyCz: center.z * sz, bodyMinY: box.min.y * sy,
      drawers,
    };
    } finally {
      // 측정 좌표계 격리 해제 — 마운트 변환/부모 복구
      clone.position.copy(savedPos); clone.quaternion.copy(savedQuat); clone.scale.copy(savedScale);
      if (holder) holder.add(clone);
      clone.updateMatrixWorld(true);
    }
  }, [built, p.w, p.d, p.h, p.lift, p.slotPos]);

  // ghost 모델 비동기 선컴파일 (KHR_parallel_shader_compile 활용). 실패해도 그냥 표시.
  useEffect(() => {
    if (!ghost) return;
    let cancelled = false;
    setCompiled(false);
    const anyGl = gl as unknown as {
      compileAsync?: (o: Object3D, cam: unknown, scn: unknown) => Promise<unknown>;
    };
    if (typeof anyGl.compileAsync !== 'function') { setCompiled(true); return; }
    anyGl.compileAsync(obj, camera, rootScene)
      .then(() => {
        if (cancelled) return;
        // 텍스처 GPU 업로드 프리워밍 — compileAsync 는 셰이더만 컴파일하고 텍스처는
        // 첫 표시 프레임에 동기 업로드(밉맵 포함)돼 "모델 나타날 때" 프리즈를 만든다.
        // initTexture 로 표시 전 미리 업로드.
        obj.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const rec = m as unknown as Record<string, { isTexture?: boolean } | null>;
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
              const t = rec[k];
              if (t && t.isTexture) gl.initTexture(t as unknown as Parameters<typeof gl.initTexture>[0]);
            }
          }
        });
        setCompiled(true);
      })
      .catch(() => { if (!cancelled) setCompiled(true); });
    return () => { cancelled = true; };
  }, [ghost, obj, gl, camera, rootScene]);

  // 인스턴스 전용 리소스 정리 — obj 교체(치수 변경 등)·unmount 시 dispose.
  // geometry 는 __ownGeometry(변형용 인스턴스 복제)만 — 나머지는 useGLTF 캐시와 공유라 지우면 안 됨.
  // 재질은 항상 인스턴스 전용(standardToPhysical 신규 생성) → 전부 dispose (공유 텍스처는 유지됨).
  useEffect(() => {
    return () => {
      obj.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        if (mesh.userData.__ownGeometry) mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      });
    };
  }, [obj]);

  // 몸통 DP 타입을 호스트(admin)로 전달 — 도어 매칭에 사용. (DP 노드 있는 몸통만)
  useEffect(() => {
    if (dpTypes.length > 0 && p.code) {
      window.parent?.postMessage({ type: 'hp3:model-dp', code: p.code, dpTypes }, '*');
    }
  }, [dpTypes, p.code]);

  // 도어 슬롯(개수·사이즈·위치)을 호스트(admin)로 전달 — 도어 자동 부착 개수/크기 결정에 사용.
  useEffect(() => {
    if (doorSlots.length > 0 && p.code) {
      window.parent?.postMessage({ type: 'hp3:model-doorslots', code: p.code, doorSlots }, '*');
    }
  }, [doorSlots, p.code]);

  // 실제 렌더 크기(selSize)를 store에 발행 → 스냅이 등록치수가 아닌 보이는 크기로 flush되게. (부속 제외)
  useEffect(() => {
    if (!p.id || p.id === 'ghost' || p.parentId) return;
    const rw = Math.round(selSize[0] * 1000), rd = Math.round(selSize[2] * 1000);
    if (Math.abs((p.renderW ?? -1) - rw) > 1 || Math.abs((p.renderD ?? -1) - rd) > 1) {
      usePlacedProductStore.getState().update(p.id, { renderW: rw, renderD: rd });
    }
  }, [selSize, p.id, p.parentId, p.renderW, p.renderD]);

  // 이 몸통에 부착된 도어 수 — 부착 직후에도 위치/크기 보정 효과가 돌도록 의존성에 포함.
  const childDoorCount = usePlacedProductStore((s) => s.placed.filter((d) => d.parentId === p.id).length);

  // 몸통 크기/위치가 바뀌거나 도어가 부착되면, 도어(parentId === p.id)를 슬롯 기준으로 자동 정렬.
  // (고스트(p.id==='ghost') 제외. doorSlots는 몸통 dims 변경 시에만 갱신되므로 루프 없음.)
  useEffect(() => {
    if (!p.id || p.id === 'ghost' || doorSlots.length === 0 || childDoorCount === 0) return;
    const st = usePlacedProductStore.getState();
    const children = st.placed.filter((d) => d.parentId === p.id);
    const lift = p.lift ?? 0;
    const estW = Math.round(p.w / doorSlots.length); // 견적/조회 도어 사이즈 = 몸통폭 ÷ 개수
    /** 변형 테이블에서 목표 폭에 맞는 변형 선택 (정확 → 이하 중 최대 → 최소). */
    const pickVariant = (vs: DoorVariant[] | undefined, target: number): DoorVariant | null => {
      if (!vs || vs.length === 0) return null;
      const sorted = [...vs].sort((a, b) => a.size - b.size);
      const exact = sorted.find((v) => v.size === target);
      if (exact) return exact;
      const leq = sorted.filter((v) => v.size <= target);
      return leq.length ? leq[leq.length - 1] : sorted[0];
    };
    for (const door of children) {
      const slot = doorSlots.find((s) => s.pos === door.slotPos) ?? doorSlots[0];
      if (!slot) continue;
      // 슬롯 center(모델 로컬 mm) → 월드. 모델은 pos=[-bodyCx, lift*M-bodyMinY, -bodyCz]로 정렬됨.
      const cx = slot.center[0] / 1000;
      // 가로(lx)는 슬롯 중심. 앞면(lz)은 **몸통 앞면(selSize.z/2) + 5mm 갭 + 도어 깊이 절반**
      // → 도어 뒷면이 몸통 앞면에서 정확히 5mm 앞에 오도록(겹치지 않게). 몸통 회전(ry) 반영.
      // 지오메트리: **하나의 도어 모델**을 슬롯 측정값으로 resize(헬퍼-stretch). 도어 모델에 L/R/T/B
      // 헬퍼가 있으면 FittedModel이 프레임 비율 보존하며 늘린다(텍스처/비율 보존). 모델 교체 없음.
      const lx = cx - bodyCx;
      const doorHalfDepth = ((door.d ?? 30) * M) / 2;
      const lz = selSize[2] / 2 + DOOR_FRONT_GAP + doorHalfDepth;
      const rad = ((p.ry ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const doorX = p.x + cos * lx + sin * lz;               // 슬롯 가로 중심(회전 반영)
      const doorZ = p.z - sin * lx + cos * lz;               // 몸통 앞면 + 5mm(겹침 없음)
      // 도어 바닥 = 슬롯 바닥(개구부 하단). 도어는 자기 FittedModel에서 바닥(lift)에 정렬.
      const doorLiftMm = slot.center[1] + lift - bodyMinY * 1000 - slot.h / 2;
      // 견적/정보: 사이즈(몸통폭÷개수)로 카탈로그 상품 조회 → 마스터 사이즈·명칭·상품코드만 표기(모델 교체 X).
      const v = pickVariant(door.variants, estW);
      const patch: Partial<PlacedProduct> = {
        w: slot.w, h: slot.h, x: doorX, z: doorZ, lift: doorLiftMm,
        masterW: v?.masterW ?? estW, masterH: v?.masterH ?? Math.round(slot.h), masterD: v?.masterD,
      };
      if (v) {
        patch.name = v.name;
        patch.code = v.code;
        if (v.color != null) patch.color = v.color;
      }
      st.update(door.id, patch);
    }
  }, [doorSlots, p.id, p.w, p.d, p.x, p.z, p.lift, childDoorCount, bodyCx, bodyCz, bodyMinY]);

  // 서랍(M) 슬라이드 애니메이션 — **도어가 열린 다음**, 여러 개면 **아래부터 1번씩 순차로** 돌출.
  // 각 서랍 i 시작 시각 = DOOR_OPEN_DELAY + i*DRAWER_STAGGER. 닫을 땐 위→아래 역순으로 후퇴.
  const doorsOpen = usePlacedProductStore((s) => s.doorsOpen);
  const drawerProg = useRef<number[]>([]);
  const openElapsed = useRef(0);
  useFrame((_, dt) => {
    if (drawers.length === 0) return;
    if (drawerProg.current.length !== drawers.length) drawerProg.current = drawers.map(() => 0);
    // 닫히면 즉시 0으로 리셋 — 재오픈 시 서랍이 매번 처음부터 순차로 열리도록.
    // (천천히 감소시키면 오래 열어둔 뒤엔 openElapsed가 커서, 다시 열 때 모든 서랍이 동시에 열림)
    openElapsed.current = doorsOpen ? openElapsed.current + dt : 0;
    for (let i = 0; i < drawers.length; i++) {
      const startAt = DOOR_OPEN_DELAY + i * DRAWER_STAGGER; // 아래(i=0)부터
      const target = doorsOpen && openElapsed.current >= startAt ? 1 : 0;
      const cur = drawerProg.current[i];
      const next = cur + (target - cur) * Math.min(1, dt * 6);
      drawerProg.current[i] = Math.abs(target - next) < 1e-4 ? target : next;
      const dr = drawers[i], amt = dr.offset * drawerProg.current[i];
      dr.node.position.set(dr.basePos.x + dr.dir.x * amt, dr.basePos.y + dr.dir.y * amt, dr.basePos.z + dr.dir.z * amt);
      if (cur !== drawerProg.current[i]) requestShadowUpdate(); // 서랍 이동 중 섀도맵 갱신
    }
  });

  return (
    <group>
      <primitive object={obj} scale={scale} position={pos} visible={compiled} />
      {sel && (
        <mesh position={[0, (p.lift ?? 0) * M + selSize[1] / 2, 0]}>
          <boxGeometry args={selSize} />
          <meshBasicMaterial visible={false} />
          <Edges scale={1.001} threshold={15} color="#22d3ee" />
        </mesh>
      )}
      {ghost && (
        // 배치 고스트 — 모델 실제 크기(selSize)에 맞춘 반투명 파란 박스.
        <mesh position={[0, (p.lift ?? 0) * M + selSize[1] / 2, 0]}>
          <boxGeometry args={selSize} />
          <meshStandardMaterial color="#4a90d9" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** 배치 아이템 — 모델 있으면 모델, 없으면 박스. 도어(parentId+slotPos)는 힌지(바깥 변) 기준 열림 애니메이션.
 *  memo: 이동 시 store.update가 미변경 상품은 같은 객체 참조를 유지하므로, 바뀐 항목만 리렌더(끊김 완화). */
const PlacedItem = memo(function PlacedItem({ p, sel, onDown, doorsOpen, doorOpenDeg }: { p: PlacedProduct; sel: boolean; onDown: (id: string, code: string | undefined, name: string, shift: boolean) => void; doorsOpen: boolean; doorOpenDeg: number }) {
  const isDoor = !!p.parentId && !!p.slotPos;
  const hingeRef = useRef<Group>(null);
  const angleRef = useRef(0);
  // 힌지 = 도어 바깥 변. L 도어는 왼쪽(-w/2), R 도어는 오른쪽(+w/2). 그 변을 축으로 회전.
  const halfW = (p.w * M) / 2;
  const hingeX = p.slotPos === 'R' ? halfW : -halfW;
  // 열림 방향: 자유 변(안쪽)이 앞(+z)으로 swing하도록 L=음수 / R=양수. 각도는 store에서 조절(doorOpenDeg).
  const openTarget = (p.slotPos === 'R' ? 1 : -1) * (doorOpenDeg * Math.PI) / 180;

  useFrame((_, dt) => {
    if (!isDoor || !hingeRef.current) return;
    const target = doorsOpen ? openTarget : 0;
    const a = angleRef.current + (target - angleRef.current) * Math.min(1, dt * 6); // 부드럽게 수렴
    if (angleRef.current !== a) requestShadowUpdate(); // 도어 회전 중 섀도맵 갱신
    angleRef.current = Math.abs(target - a) < 1e-4 ? target : a;
    hingeRef.current.rotation.y = angleRef.current;
  });

  const content = p.modelUrl ? (
    <ModelErrorBoundary fallback={<BoxMesh p={p} sel={sel} />}>
      <Suspense fallback={<BoxMesh p={p} sel={sel} />}>
        <FittedModel url={p.modelUrl} p={p} sel={sel} />
      </Suspense>
    </ModelErrorBoundary>
  ) : (
    <BoxMesh p={p} sel={sel} />
  );

  return (
    <group
      ref={(g: Group | null) => { if (g) placedGroupRefs.set(p.id, g); else placedGroupRefs.delete(p.id); }}
      position={[p.x, 0, p.z]}
      rotation={[0, (p.ry * Math.PI) / 180, 0]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onDown(p.id, p.code, p.name, e.nativeEvent.shiftKey);
        // ⭐ 모델 직접 드래그 이동 — 기즈모 없이도 몸체를 잡고 끌면 이동 (스냅·스태킹 동일).
        //   Shift(다중선택)·부속(도어)·기즈모 조작 중엔 제외.
        if (e.nativeEvent.shiftKey || p.parentId || isGizmoBusy()) return;
        startBodyDrag(e as ThreeEvent<PointerEvent>, p);
      }}
    >
      {isDoor ? (
        // 힌지 피벗(바깥 변=슬롯 면)에서 회전 → 그 안에서 패널을 중앙으로 되돌림.
        // 좌우 미러(피봇 보정)는 FittedModel이 모델 피봇 방향을 감지해 적용한다.
        <group position={[hingeX, 0, 0]} ref={hingeRef}>
          <group position={[-hingeX, 0, 0]}>{content}</group>
        </group>
      ) : content}
    </group>
  );
});

/**
 * 상품 클릭 배치 (호스트 어드민 ↔ 웹플래너 연동).
 *
 * - 호스트가 `postMessage({ type:'hp3:place-product', name, code, w, d, h })` 보내면 배치 모드 진입
 * - 배치 모드: 바닥(y=0) 위 포인터를 따라다니는 반투명 고스트 박스 표시 (상품 치수 = w×d×h mm)
 * - 좌클릭: 해당 위치에 박스 배치 / Esc·우클릭: 취소
 * - 치수는 mm → m(/1000) 변환, 박스는 바닥에 올려둠(y = h/2)
 */
export function ProductPlacement() {
  const pending = usePlacedProductStore((s) => s.pending);
  const placed = usePlacedProductStore((s) => s.placed);
  const place = usePlacedProductStore((s) => s.place);
  const setPending = usePlacedProductStore((s) => s.setPending);
  const cancel = usePlacedProductStore((s) => s.cancel);
  const selectedIds = usePlacedProductStore((s) => s.selectedIds);
  const select = usePlacedProductStore((s) => s.select);
  const update = usePlacedProductStore((s) => s.update);
  const doorsOpen = usePlacedProductStore((s) => s.doorsOpen);
  const toggleDoors = usePlacedProductStore((s) => s.toggleDoors);
  const doorOpenDeg = usePlacedProductStore((s) => s.doorOpenDeg);
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  /** 배치 대기(pending) 상품의 스냅 보정 좌표 — 고스트 미리보기·확정 배치 공용. */
  const snapPendingPoint = (x: number, z: number): [number, number] => {
    const st = usePlacedProductStore.getState();
    if (!pending || st.placed.length === 0) return [x, z];
    const ghostP = { ...pending, id: 'ghost', x, z, ry: 0 } as PlacedProduct;
    const f = footprintXZ(ghostP);
    const others = st.placed.filter((b) => !b.parentId);
    const snap = computeSnap(f, others);
    return [x + snap.dx, z + snap.dz];
  };
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
  /** 선택 박스들의 중심 피벗(보이지 않음) — 기즈모를 여기 붙여 다중 이동/회전 */
  const [pivotObj, setPivotObj] = useState<Object3D | null>(null);
  // 기즈모 드래그 중 여부 — 이동 중에는 리사이즈 핸들 숨김, 멈추면 다시 표시
  const [gizmoDragging, setGizmoDragging] = useState(false);
  setDraggingRef.current = setGizmoDragging;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tcRef = useRef<any>(null); // TransformControls 인스턴스 — 핸들 위면 .axis 설정됨
  // 기즈모 가드 등록 — 핸들 호버/드래그 중 씬 선택 차단
  useEffect(() => {
    const tc = tcRef.current;
    if (!tc) return;
    return registerGizmo(tc as { axis: string | null; dragging: boolean });
  });
  const lastPivot = useRef<{ x: number; z: number; ry: number; y?: number }>({ x: 0, z: 0, ry: 0, y: 0 });
  const selectedSet = new Set(selectedIds);
  // 도어별 최대 열림 각(충돌 시 교차 직전까지). 배치/각도 변경 시 재계산.
  const doorClamp = useMemo(() => computeDoorClamp(placed, doorOpenDeg), [placed, doorOpenDeg]);

  // 선택이 바뀌면 피벗을 선택 박스들의 중심으로 재배치 (회전 0)
  useEffect(() => {
    if (!pivotObj || selectedIds.length === 0) return;
    const boxes = usePlacedProductStore.getState().placed.filter((p) => selectedIds.includes(p.id));
    if (boxes.length === 0) return;
    // 단일 선택은 아래 렌더에서 기즈모를 상품 그룹에 **직접 부착** — 프록시 불필요.
    // 다중 선택 — 선택 무게중심 (그룹 이동/회전 기준점)
    const cx = boxes.reduce((s, b) => s + b.x, 0) / boxes.length;
    const cz = boxes.reduce((s, b) => s + b.z, 0) / boxes.length;
    pivotObj.position.set(cx, 0, cz);
    pivotObj.rotation.set(0, 0, 0);
    lastPivot.current = { x: cx, z: cz, ry: 0, y: 0 };
  }, [pivotObj, selectedIds]);

  // 단일 선택 기즈모의 동반 이동 캡처 — onMouseDown 시점의 몸통 기준값 + follower live Group.
  const soloFollowRef = useRef<{
    base: { x: number; z: number; ry: number; lift: number };
    followers: { f: PlacedProduct; g: Group }[];
  } | null>(null);

  // 박스 클릭 선택 (Shift = 다중 토글), 호스트에 선택 정보 전송.
  // useCallback: PlacedItem memo가 유지되도록 안정 참조. (select는 zustand 액션이라 안정)
  const onBoxDown = useCallback((id: string, code: string | undefined, name: string, shift: boolean) => {
    if (isGizmoBusy()) return; // 기즈모 핸들 조작 중 — 뒤 상품 오선택 방지
    select(id, shift);
    clearOtherSelections('product'); // 상품 선택 시 벽/모델/모듈 해제
    const ids = usePlacedProductStore.getState().selectedIds;
    if (ids.length <= 1) window.parent?.postMessage({ type: 'hp3:selected', code, name }, '*');
    else window.parent?.postMessage({ type: 'hp3:selected', code, name, count: ids.length }, '*');
  }, [select]);

  // 기즈모 변경 → 선택 박스 전체에 이동/회전 델타 적용
  const onPivotChange = () => {
    if (!pivotObj) return;
    const px = pivotObj.position.x, pz = pivotObj.position.z, pry = pivotObj.rotation.y;
    const py = pivotObj.position.y;
    const last = lastPivot.current;
    const dx = px - last.x, dz = pz - last.z, dRy = pry - last.ry;
    const dy = py - (last.y ?? 0);
    const st = usePlacedProductStore.getState();
    if (gizmoMode === 'translate' && (dx || dz)) {
      // 1) 델타 적용한 임시 위치로 선택 상품 합집합 AABB 계산
      const sel = st.placed.filter((b) => selectedSet.has(b.id));
      const others = st.placed.filter((b) => !selectedSet.has(b.id) && !b.parentId); // 도어 등 부속 제외
      const union = { minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity };
      for (const b of sel) {
        const f = footprintXZ(b, dx, dz);
        union.minx = Math.min(union.minx, f.minx); union.maxx = Math.max(union.maxx, f.maxx);
        union.minz = Math.min(union.minz, f.minz); union.maxz = Math.max(union.maxz, f.maxz);
      }
      // 2) 충돌·근접 시 모서리 스냅 보정
      const snap = others.length && isFinite(union.minx) ? computeSnap(union, others) : { dx: 0, dz: 0 };
      const dLift = Math.round(dy * 1000); // m → mm
      for (const b of sel) update(b.id, {
        x: b.x + dx + snap.dx, z: b.z + dz + snap.dz,
        ...(dLift !== 0 ? { lift: Math.max(0, (b.lift ?? 0) + dLift) } : {}),
      });
    } else if (gizmoMode === 'rotate' && dRy) {
      const cx = last.x, cz = last.z, cos = Math.cos(dRy), sin = Math.sin(dRy);
      for (const b of st.placed) if (selectedSet.has(b.id)) {
        const rx = b.x - cx, rz = b.z - cz;
        update(b.id, { x: cx + rx * cos - rz * sin, z: cz + rx * sin + rz * cos, ry: b.ry + (dRy * 180) / Math.PI });
      }
    }
    lastPivot.current = { x: px, z: pz, ry: pry, y: py };
  };

  // 배치 목록이 바뀌면 호스트(어드민)로 전송 → 견적보기 등에서 사용.
  // 견적 치수는 **콘텐츠 마스터 사이즈(masterW/H/D)** 우선(없으면 실제 w/h/d). 도어는 stretch된
  // 지오메트리가 아니라 카탈로그 변형 상품의 등록 치수를 내보낸다.
  // 디바운스: 드래그 이동 중 매 프레임 postMessage(iframe 간)로 admin이 매 프레임 리렌더되어 끊기므로,
  // 변경이 멎은 뒤 ~120ms에 한 번만 전송한다.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const items = placed.map((p) => ({
        id: p.id, code: p.code, name: p.name,
        w: p.masterW ?? p.w, d: p.masterD ?? p.d, h: p.masterH ?? p.h, lift: p.lift ?? 0,
        modelCode: p.modelCode, itemCode: p.itemCode, parentId: p.parentId,
      }));
      window.parent?.postMessage({ type: 'hp3:scene', count: placed.length, items }, '*');
    }, 120);
    return () => clearTimeout(t);
  }, [placed]);

  // 기즈모 모드 단축키: G/T=이동, R=회전. O=도어 열림/닫힘 토글(애니메이션 확인용).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') setGizmoMode('rotate');
      if (e.key === 'g' || e.key === 'G' || e.key === 't' || e.key === 'T') setGizmoMode('translate');
      if (e.key === 'o' || e.key === 'O') toggleDoors();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDoors]);

  // 호스트 메시지 수신 → 배치 모드 진입
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string } & Partial<PendingProduct>;
      if (d && d.type === 'hp3:place-product') {
        setPending({ name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0, modelUrl: d.modelUrl, color: d.color, sizeRange: (d as { sizeRange?: PendingProduct['sizeRange'] }).sizeRange });
      }
      if (d && d.type === 'hp3:toggle-doors') {
        // 도어 열림/닫힘 토글(애니메이션 확인). data.open이 boolean이면 그 값으로, 없으면 토글.
        const want = (d as { open?: boolean }).open;
        const st = usePlacedProductStore.getState();
        if (typeof want === 'boolean') { if (st.doorsOpen !== want) st.toggleDoors(); }
        else st.toggleDoors();
      }
      if (d && d.type === 'hp3:update-product') {
        // 선택된 배치 컨텐츠의 치수/배치높이를 그 자리에서 수정 (새 배치 아님)
        const st = usePlacedProductStore.getState();
        // 선택이 없으면 마지막 배치 박스에 적용 (배치 직후 선택이 풀린 경우 대비)
        const targets = st.selectedIds.length > 0
          ? st.selectedIds
          : (st.placed.length ? [st.placed[st.placed.length - 1].id] : []);
        if (targets.length === 0) return;
        const patch: Partial<PendingProduct> = {};
        if (d.w != null) patch.w = d.w;
        if (d.d != null) patch.d = d.d;
        if (d.h != null) patch.h = d.h;
        if (d.lift != null) patch.lift = d.lift;
        if (d.code != null) patch.code = d.code;
        if (d.name != null) patch.name = d.name;
        if (d.modelUrl != null) patch.modelUrl = d.modelUrl;
        if (d.color != null) patch.color = d.color;
        for (const id of targets) st.update(id, patch);
        return;
      }
      if (d && d.type === 'hp3:attach-doors') {
        // 선택된 몸통에 DP 매칭 도어들을 POS(L/R)에 자동 배치 (시뮬레이션: 박스)
        const ad = e.data as { bodyW?: number; bodyD?: number; bodyH?: number; doors?: { code?: string; name?: string; w?: number; d?: number; h?: number; pos?: string; modelUrl?: string; color?: string; masterW?: number; masterH?: number; masterD?: number; modelCode?: string; itemCode?: string; variants?: DoorVariant[]; mirror?: boolean }[] };
        const st = usePlacedProductStore.getState();
        const bodyId = st.selectedIds[0] ?? (st.placed.length ? st.placed[st.placed.length - 1].id : null);
        const body = st.placed.find((p) => p.id === bodyId);
        if (!body || !ad.doors?.length) return;
        // 부착 정책: 없으면 붙이고 / 있으면 교체 / **같으면 그대로**
        const existing = st.placed.filter((p) => p.parentId === body.id);
        const sig = (codes: (string | undefined)[]) => codes.map((c) => c ?? '').sort().join('|');
        if (existing.length > 0) {
          if (sig(existing.map((p) => p.code)) === sig(ad.doors.map((dr) => dr.code))) return; // 동일 구성 — 유지
          for (const c of existing) st.remove(c.id); // 다른 구성 — 기존 부착분 제거 후 교체
        }
        const bw = (ad.bodyW || body.w) * M;
        const bd = (ad.bodyD || body.d) * M;
        // 좌/우 도어 개수 분배 → 몸통 폭 안에서 배치
        ad.doors.forEach((dr, i) => {
          const pos = (dr.pos || (i % 2 === 0 ? 'L' : 'R')).toUpperCase();
          const slotPos: 'L' | 'R' = pos.startsWith('R') ? 'R' : 'L';
          const side = slotPos === 'R' ? 1 : -1;               // L=-1, R=+1
          const dx = side * bw / 4;                            // 몸통 폭의 1/4 지점
          const dz = bd / 2;                                   // 몸통 앞면
          st.placeAt({
            name: dr.name ?? '도어', code: dr.code, w: dr.w || 600, d: dr.d || 30, h: dr.h || body.h, lift: body.lift ?? 0, modelUrl: dr.modelUrl, color: dr.color,
            // 몸통(베이스)에 연결 — 몸통 크기 변경 시 이 도어를 자동으로 새 슬롯 크기/위치로 갱신.
            parentId: body.id, slotPos,
            // 견적용 마스터 사이즈 + 식별코드(admin 카탈로그 변형 상품) + 사이즈 변형 테이블 + 미러(피봇 보정).
            masterW: dr.masterW, masterH: dr.masterH, masterD: dr.masterD, modelCode: dr.modelCode, itemCode: dr.itemCode,
            variants: dr.variants, mirror: dr.mirror,
          }, body.x + dx, body.z + dz, body.ry);
        });
        return;
      }
      if (d && d.type === 'hp3:swap-product') {
        // 선택된 배치 상품이 있으면 그 자리에서 교체, 없으면 새 배치 대기
        const st = usePlacedProductStore.getState();
        if (st.selectedId) {
          st.update(st.selectedId, { name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0, color: d.color });
        } else {
          setPending({ name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0, color: d.color });
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [setPending]);

  // Esc 취소
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancel]);

  return (
    <>
      {/* 배치된 상품 — 모델 등록 시 GLB, 없으면 박스. 빈 곳 클릭 해제는 Canvas onPointerMissed에서 처리 */}
      {placed.map((p) => (
        <PlacedItem key={p.id} p={p} sel={selectedSet.has(p.id)} onDown={onBoxDown} doorsOpen={doorsOpen} doorOpenDeg={doorClamp.get(p.id) ?? doorOpenDeg} />
      ))}

      {/* 선택 중심 피벗 + 기즈모 — 다중 선택 시 전체 이동/회전 (G=이동, R=회전) */}
      <object3D ref={setPivotObj} />
      {selectedIds.length > 0 && pivotObj && (
        (() => {
          // 단일 선택: 기즈모를 상품 그룹에 직접 부착 — 드래그 즉시 모델이 움직이고
          // (프록시 델타 방식의 한 박자 지연·최종 위치 불일치 해소), 놓을 때 store 커밋.
          const singleGroup = selectedIds.length === 1 ? placedGroupRefs.get(selectedIds[0]) : null;
          if (singleGroup) {
            const id = selectedIds[0];
            return (
              <TransformControls
                ref={tcRef}
                key={`gizmo-solo-${id}-${gizmoMode}`}
                object={singleGroup}
                mode={gizmoMode}
                space="local"
                // 3축 모두 활성 — Y(상하) 이동은 배치높이(lift)로 커밋
                showX
                showY
                showZ
                onMouseDown={() => {
                  setGizmoDragging(true);
                  // ⭐ 동반 이동 — 드래그 시작 시점의 몸통 기준값 + 부착 상품 캡처
                  const st = usePlacedProductStore.getState();
                  const b = st.placed.find((pp) => pp.id === id);
                  soloFollowRef.current = b
                    ? {
                        base: { x: b.x, z: b.z, ry: b.ry, lift: b.lift ?? 0 },
                        followers: followerGroups(b, st.placed),
                      }
                    : null;
                }}
                onObjectChange={() => {
                  const fw = soloFollowRef.current;
                  const st = usePlacedProductStore.getState();
                  const b = st.placed.find((pp) => pp.id === id);
                  if (!b) return;
                  const followerIds = new Set(fw?.followers.map((x) => x.f.id) ?? []);
                  if (gizmoMode === 'translate') {
                    const f = footprintXZ({ ...b, x: singleGroup.position.x, z: singleGroup.position.z });
                    // 자기 자식(follower)에 스냅/올라타는 자가참조 방지
                    const others = st.placed.filter((pp) => pp.id !== id && !pp.parentId && !followerIds.has(pp.id));
                    // ⭐ 스태킹: 다른 상품 발자국과 겹치면 그 **메시 윗면을 따라** 올라타며 이동.
                    //   겹침 없으면 기존 모서리 스냅 + 바닥 높이 복귀.
                    const surfY = stackSurfaceY(id, f, others);
                    if (surfY !== null) {
                      singleGroup.position.y = surfY - (b.lift ?? 0) * M; // 시각 보정(자식이 base lift 포함)
                    } else {
                      singleGroup.position.y = 0;
                      const sn = others.length ? computeSnap(f, others) : { dx: 0, dz: 0 };
                      singleGroup.position.x += sn.dx;
                      singleGroup.position.z += sn.dz;
                    }
                  }
                  // follower 들도 몸통 델타만큼 실시간 추종 (이동 + 몸통 중심 기준 회전)
                  if (fw && fw.followers.length) {
                    const dx = singleGroup.position.x - fw.base.x;
                    const dz = singleGroup.position.z - fw.base.z;
                    const dy = singleGroup.position.y;
                    const dRy = singleGroup.rotation.y - (fw.base.ry * Math.PI) / 180;
                    const cos = Math.cos(dRy), sin = Math.sin(dRy);
                    for (const { f: fo, g: fg } of fw.followers) {
                      const rx = fo.x - fw.base.x, rz = fo.z - fw.base.z; // 몸통 기준 오프셋
                      fg.position.x = fw.base.x + dx + rx * cos + rz * sin;
                      fg.position.z = fw.base.z + dz - rx * sin + rz * cos;
                      fg.position.y = dy;
                      fg.rotation.y = ((fo.ry * Math.PI) / 180) + dRy;
                    }
                  }
                  requestShadowUpdate(); // 라이브 이동/회전은 store를 안 거치므로 섀도맵 직접 갱신
                }}
                onMouseUp={() => {
                  setGizmoDragging(false);
                  // 놓는 순간 그룹의 실제 변환을 store 로 커밋 — 기즈모 위치 = 최종 위치.
                  // 스태킹 중이었다면 표면 높이를 lift 로 확정.
                  const st = usePlacedProductStore.getState();
                  const b = st.placed.find((pp) => pp.id === id);
                  const newLift = b ? Math.max(0, Math.round((singleGroup.position.y + (b.lift ?? 0) * M) * 1000)) : undefined;
                  singleGroup.position.y = 0; // 그룹 y 원복 — lift 는 store 값으로 자식이 반영
                  st.update(id, {
                    x: singleGroup.position.x,
                    z: singleGroup.position.z,
                    ry: ((singleGroup.rotation.y * 180) / Math.PI + 360) % 360,
                    ...(newLift !== undefined ? { lift: newLift } : {}),
                  });
                  // follower 커밋 — 도어는 몸통 커밋에 반응하는 정렬 효과가 재배치하므로 제외
                  const fw = soloFollowRef.current;
                  soloFollowRef.current = null;
                  if (fw && b) {
                    const dx = singleGroup.position.x - fw.base.x;
                    const dz = singleGroup.position.z - fw.base.z;
                    const dRy = singleGroup.rotation.y - (fw.base.ry * Math.PI) / 180;
                    const dLift = newLift !== undefined ? newLift - fw.base.lift : 0;
                    const cos = Math.cos(dRy), sin = Math.sin(dRy);
                    for (const { f: fo, g: fg } of fw.followers) {
                      fg.position.y = 0;
                      if (fo.parentId) continue;
                      const rx = fo.x - fw.base.x, rz = fo.z - fw.base.z;
                      st.update(fo.id, {
                        x: fw.base.x + dx + rx * cos + rz * sin,
                        z: fw.base.z + dz - rx * sin + rz * cos,
                        ry: (fo.ry + (dRy * 180) / Math.PI + 360) % 360,
                        lift: Math.max(0, (fo.lift ?? 0) + dLift),
                      });
                    }
                  }
                }}
              />
            );
          }
          return (
            <TransformControls
              ref={tcRef}
              key={`gizmo-${selectedIds.join(',')}-${gizmoMode}`}
              object={pivotObj}
              mode={gizmoMode}
              space="local"
              showX
              showY
              showZ
              onObjectChange={onPivotChange}
            />
          );
        })()
      )}

      {/* 가변 사이즈 리사이즈 핸들 — 단일 선택 + sizeRange 있는 축만 화살표 표시 */}
      {selectedIds.length === 1 && !pending && !gizmoDragging && (
        <ProductResizeHandles id={selectedIds[0]} />
      )}

      {/* 배치 모드: 바닥 인터랙션 평면 + 고스트 박스 */}
      {pending && (
        <>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            // 바닥 평면보다 살짝 위 — 레이캐스트가 이 평면을 먼저 맞춰 다른 메쉬의
            // 선택 핸들러가 pointerdown을 가로채지 못하게 함 (배치 우선)
            position={[0, 0.05, 0]}
            renderOrder={999}
            onPointerMove={(e) => {
              e.stopPropagation();
              // 고스트 미리보기에도 상품 간 스냅 적용 — 배치 전부터 붙을 위치가 보이게
              setGhost(snapPendingPoint(e.point.x, e.point.z));
            }}
            onPointerDown={(e) => {
              if (e.button === 2) { cancel(); setGhost(null); return; } // 우클릭 취소
              if (e.button !== 0) return;
              e.stopPropagation();
              // 배치 확정도 동일 스냅 (미리보기와 일치)
              const [px, pz] = snapPendingPoint(e.point.x, e.point.z);
              place(px, pz);
              setGhost(null);
            }}
          >
            <planeGeometry args={[400, 400]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
          </mesh>
          {ghost && (() => {
            const gp: PlacedProduct = { ...pending, id: 'ghost', x: ghost[0], z: ghost[1], ry: 0 };
            const ghostBox = (
              <mesh position={[0, ((pending.lift ?? 0) + pending.h / 2) * M, 0]}>
                <boxGeometry args={[pending.w * M, pending.h * M, pending.d * M]} />
                <meshStandardMaterial color="#4a90d9" transparent opacity={0.45} depthWrite={false} />
              </mesh>
            );
            return (
              <group position={[ghost[0], 0, ghost[1]]}>
                {pending.modelUrl ? (
                  <ModelErrorBoundary fallback={ghostBox}>
                    <Suspense fallback={ghostBox}>
                      {/* ghost=true → 모델 실제 크기에 맞춘 반투명 파란 박스 동반 표시 */}
                      <FittedModel url={pending.modelUrl} p={gp} sel={false} ghost={true} />
                    </Suspense>
                  </ModelErrorBoundary>
                ) : ghostBox}
              </group>
            );
          })()}
        </>
      )}
    </>
  );
}

/**
 * 상품 길이 변경 핸들 — 가변(sizeRange 설정) 축의 양쪽 면 중앙에 화살표(콘)를 띄우고,
 * 드래그하면 해당 축 치수를 변경한다 (반대 면 고정, min/max 클램프, gap 스텝 스냅).
 * 기즈모(TransformControls)와 별개의 경량 UI — 높이(h)는 윗면 화살표 하나.
 */
function ProductResizeHandles({ id }: { id: string }) {
  const p = usePlacedProductStore((s) => s.placed.find((x) => x.id === id));
  const { gl, camera } = useThree();
  const dragRef = useRef<{
    axis: 'w' | 'd' | 'h'; side: 1 | -1;
    baseW: number; baseD: number; baseH: number; baseX: number; baseZ: number;
    startT: number;
  } | null>(null);
  // 드래그 중 현재 값(mm) 라벨 — 조절 중인 축/값을 모델 옆에 표시
  const [label, setLabel] = useState<{ axis: 'w' | 'd' | 'h'; value: number } | null>(null);
  if (!p || p.parentId) return null;
  const r = p.sizeRange;
  if (!r || (!r.w && !r.d && !r.h)) return null;

  const ryRad = (p.ry * Math.PI) / 180;
  const cos = Math.cos(ryRad), sin = Math.sin(ryRad);
  const wM = (p.renderW ?? p.w) * M, dM = (p.renderD ?? p.d) * M, hM = p.h * M;
  const lift = (p.lift ?? 0) * M;
  // 로컬 축 → 월드 (PlacedItem rotation +ry 규약)
  const axisDirWorld = (axis: 'w' | 'd' | 'h', side: 1 | -1): [number, number, number] =>
    axis === 'h' ? [0, side, 0]
    : axis === 'w' ? [side * cos, 0, -side * sin]
    : [side * sin, 0, side * cos];

  /** 카메라 레이에서 (origin, dir) 축 위 최근접 파라미터 t — 축 방향 드래그 거리 측정 */
  const axisT = (clientX: number, clientY: number, origin: Vector3, dir: Vector3): number | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const nd = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const rc = new Raycaster();
    rc.setFromCamera(nd, camera);
    const ro = rc.ray.origin, rd = rc.ray.direction;
    const w0 = ro.clone().sub(origin); // ray원점 - 축원점 (부호 뒤집힘 버그 수정 — 드래그 방향 반전 원인)
    const a = rd.dot(rd), b = rd.dot(dir), c = dir.dot(dir);
    const dvec = rd.dot(w0), e = dir.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-9) return null;
    return (a * e - b * dvec) / denom; // 축 위 t (m)
  };

  const startDrag = (axis: 'w' | 'd' | 'h', side: 1 | -1) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const dir = new Vector3(...axisDirWorld(axis, side));
    const origin = new Vector3(p.x, lift + hM / 2, p.z);
    const t0 = axisT(e.nativeEvent.clientX, e.nativeEvent.clientY, origin, dir);
    if (t0 === null) return;
    dragRef.current = { axis, side, baseW: p.w, baseD: p.d, baseH: p.h, baseX: p.x, baseZ: p.z, startT: t0 };
    (e.target as Element).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const d0 = dragRef.current;
      if (!d0) return;
      const t = axisT(ev.clientX, ev.clientY, origin, dir);
      if (t === null) return;
      const deltaMm = (t - d0.startT) * 1000; // 화살표 방향으로 끈 거리(mm)
      const rr = r[d0.axis]!;
      const base = d0.axis === 'w' ? d0.baseW : d0.axis === 'd' ? d0.baseD : d0.baseH;
      let next = base + deltaMm;
      next = Math.max(rr.min, Math.min(rr.max, next));
      if (rr.gap > 0) next = rr.min + Math.round((next - rr.min) / rr.gap) * rr.gap;
      // ⭐ 리사이즈 스냅 — 드래그 중인 면이 인접 상품의 면과 SNAP_DIST 안이면 딱 맞춰
      //   줄어들거나 늘어난다 (축 정렬 상태에서만, gap 스텝보다 우선).
      if (d0.axis !== 'h') {
        const ax = dir.x, az = dir.z;
        const axisIsX = Math.abs(ax) > 0.9, axisIsZ = Math.abs(az) > 0.9;
        if (axisIsX || axisIsZ) {
          const st0 = usePlacedProductStore.getState();
          const me = st0.placed.find((x) => x.id === id);
          if (me) {
            const a = axisIsX ? d0.baseX : d0.baseZ;           // 축 위 기준 중심 좌표(m)
            const sgn = axisIsX ? Math.sign(ax) : Math.sign(az); // 드래그 면의 축 방향 부호
            const faceCoord = a + sgn * (next / 2) * M;          // 현재 면 위치(m)
            const myF = footprintXZ({ ...me, x: d0.baseX, z: d0.baseZ, [d0.axis]: next } as PlacedProduct);
            for (const o of st0.placed) {
              if (o.id === id || o.parentId) continue;
              const of = footprintXZ(o);
              // 수직축 구간이 겹칠 때만 (모서리 스냅과 동일 조건)
              const perp = axisIsX
                ? Math.min(myF.maxz, of.maxz) - Math.max(myF.minz, of.minz)
                : Math.min(myF.maxx, of.maxx) - Math.max(myF.minx, of.minx);
              if (perp < -SNAP_DIST) continue;
              const cands = axisIsX ? [of.minx, of.maxx] : [of.minz, of.maxz];
              for (const c of cands) {
                if (Math.abs(faceCoord - c) < SNAP_DIST) {
                  const snapped = Math.round(((c - a) / (sgn * M)) * 2);
                  if (snapped >= rr.min && snapped <= rr.max) next = snapped;
                }
              }
            }
          }
        }
      }
      next = Math.round(next);
      setLabel({ axis: d0.axis, value: next }); // 조절 중 값 표시
      const st = usePlacedProductStore.getState();
      if (d0.axis === 'h') { st.update(id, { h: next }); return; }
      // 폭/깊이 — 드래그한 면만 이동(반대 면 고정): 중심을 축 방향으로 절반 이동
      const grow = (next - base) / 2 * M;
      const [ax, , az] = axisDirWorld(d0.axis, d0.side);
      st.update(id, {
        ...(d0.axis === 'w' ? { w: next } : { d: next }),
        x: d0.baseX + ax * grow,
        z: d0.baseZ + az * grow,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setLabel(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // 확정 치수를 호스트(어드민)로 통지 — 상품정보 패널의 사이즈에 반영
      const cur = usePlacedProductStore.getState().placed.find((x) => x.id === id);
      if (cur) {
        window.parent?.postMessage(
          { type: 'hp3:product-resized', code: cur.code, w: cur.w, d: cur.d, h: cur.h },
          '*',
        );
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handles: { axis: 'w' | 'd' | 'h'; side: 1 | -1 }[] = [];
  if (r.w) handles.push({ axis: 'w', side: 1 }, { axis: 'w', side: -1 });
  if (r.d) handles.push({ axis: 'd', side: 1 }, { axis: 'd', side: -1 });
  if (r.h) handles.push({ axis: 'h', side: 1 });

  const COLOR: Record<'w' | 'd' | 'h', string> = { w: '#f59e0b', d: '#f59e0b', h: '#3b82f6' };
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, ryRad, 0]}>
      {label && (
        <Html
          center
          position={
            label.axis === 'w' ? [0, lift + hM + 0.25, 0]
            : label.axis === 'd' ? [0, lift + hM + 0.25, 0]
            : [0, lift + hM + 0.35, 0]
          }
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 700,
            padding: '3px 10px', borderRadius: 6, whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            {label.axis === 'w' ? '폭' : label.axis === 'd' ? '깊이' : '높이'} {label.value.toLocaleString()}mm
          </div>
        </Html>
      )}
      {handles.map(({ axis, side }) => {
        // 로컬 면 중앙 + 바깥 오프셋
        const off = 0.12;
        const pos: [number, number, number] =
          axis === 'w' ? [side * (wM / 2 + off), lift + hM / 2, 0]
          : axis === 'd' ? [0, lift + hM / 2, side * (dM / 2 + off)]
          : [0, lift + hM + off, 0];
        // 콘이 바깥을 향하게 회전 (콘 기본 +Y)
        const rot: [number, number, number] =
          axis === 'h' ? [0, 0, 0]
          : axis === 'w' ? [0, 0, side === 1 ? -Math.PI / 2 : Math.PI / 2]
          : [side === 1 ? Math.PI / 2 : -Math.PI / 2, 0, 0];
        return (
          <mesh key={`${axis}${side}`} position={pos} rotation={rot} onPointerDown={startDrag(axis, side)} renderOrder={998}>
            <coneGeometry args={[0.06, 0.16, 12]} />
            <meshBasicMaterial color={COLOR[axis]} depthTest={false} transparent opacity={0.95} />
          </mesh>
        );
      })}
    </group>
  );
}


/**
 * 스태킹 표면 높이 — 이동 중 상품의 발자국이 다른 상품과 겹치면, 겹치는 상품들의
 * 메시에 위에서 아래로 레이캐스트해 **가장 높은 윗면 y(m)** 를 반환. 겹침 없으면 null.
 * (충돌 시 밀어내는 대신 위로 올라타 배치 — 선반/책상 위 소품 배치 흐름)
 */
function stackSurfaceY(
  selfId: string,
  f: { minx: number; maxx: number; minz: number; maxz: number },
  others: PlacedProduct[],
): number | null {
  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const cx = (f.minx + f.maxx) / 2, cz = (f.minz + f.maxz) / 2;
  let top: number | null = null;
  for (const o of others) {
    if (o.id === selfId) continue;
    const of = footprintXZ(o);
    const ox = Math.min(f.maxx, of.maxx) - Math.max(f.minx, of.minx);
    const oz = Math.min(f.maxz, of.maxz) - Math.max(f.minz, of.minz);
    // 발자국이 실제로 겹칠 때만 (얕은 접촉은 스냅에 양보)
    if (ox < 0.05 || oz < 0.05) continue;
    const g = placedGroupRefs.get(o.id);
    if (!g) continue;
    ray.set(new Vector3(cx, 50, cz), down);
    const hits = ray.intersectObject(g, true);
    if (hits.length > 0) {
      const y = hits[0].point.y;
      if (top === null || y > top) top = y;
    }
  }
  return top;
}


/**
 * 몸통 이동 시 함께 움직여야 하는 부착 상품 수집 — 드래그 시작 시점의 기하 판정(BFS).
 * ① parentId 도어, ② 발자국 중심이 host 발자국 안 + 바닥높이가 host 바닥 위~윗면+5cm
 * (내부 수납·윗면 스태킹). 올린 것 위에 또 올린 것도 연쇄 포함. 관계는 저장하지 않는다.
 */
function collectFollowers(body: PlacedProduct, placed: PlacedProduct[]): PlacedProduct[] {
  const out = new Map<string, PlacedProduct>();
  const queue: PlacedProduct[] = [body];
  while (queue.length) {
    const host = queue.pop()!;
    const hf = footprintXZ(host);
    const hostBottom = (host.lift ?? 0) * M;
    const hostTop = hostBottom + host.h * M;
    for (const o of placed) {
      if (o.id === body.id || out.has(o.id)) continue;
      if (o.parentId) {
        if (o.parentId === host.id) out.set(o.id, o);
        continue;
      }
      const of = footprintXZ(o);
      const ocx = (of.minx + of.maxx) / 2, ocz = (of.minz + of.maxz) / 2;
      if (ocx < hf.minx - 0.01 || ocx > hf.maxx + 0.01 || ocz < hf.minz - 0.01 || ocz > hf.maxz + 0.01) continue;
      const bottom = (o.lift ?? 0) * M;
      // host보다 바닥이 낮으면 내가 올라탄 받침이므로 제외
      if (bottom > hostBottom + 0.001 && bottom < hostTop + 0.05) {
        out.set(o.id, o);
        queue.push(o);
      }
    }
  }
  return [...out.values()];
}

/** follower 의 live Group 페어 — 그룹이 아직 마운트 안 된 항목은 제외. */
function followerGroups(body: PlacedProduct, placed: PlacedProduct[]): { f: PlacedProduct; g: Group }[] {
  return collectFollowers(body, placed)
    .map((f) => ({ f, g: placedGroupRefs.get(f.id) }))
    .filter((x): x is { f: PlacedProduct; g: Group } => !!x.g);
}

/** 모델 몸체 직접 드래그 — 바닥 레이 기준으로 그룹을 즉시 이동(스냅+스태킹), 놓으면 store 커밋. */
function startBodyDrag(e: ThreeEvent<PointerEvent>, p: PlacedProduct): void {
  const g = placedGroupRefs.get(p.id);
  if (!g) return;
  const canvas = (e.nativeEvent.target as HTMLElement).closest('canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const cam = e.camera;
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const toGround = (cx: number, cy: number): Vector3 | null => {
    const r = canvas.getBoundingClientRect();
    const nd = new Vector2(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
    const rc = new Raycaster();
    rc.setFromCamera(nd, cam);
    const pt = new Vector3();
    return rc.ray.intersectPlane(ground, pt) ? pt : null;
  };
  const start = toGround(e.nativeEvent.clientX, e.nativeEvent.clientY);
  if (!start) return;
  const offX = start.x - p.x, offZ = start.z - p.z;
  const downX = e.nativeEvent.clientX, downY = e.nativeEvent.clientY;
  // ⭐ 동반 이동 — 드래그 시작 시점에 몸통에 부착된 상품(도어+위/안의 상품)을 캡처.
  const followers = followerGroups(p, usePlacedProductStore.getState().placed);
  const followerIds = new Set(followers.map((x) => x.f.id));
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - downX, ev.clientY - downY) < 4) return;
    if (!moved) { moved = true; setDraggingRef.current?.(true); }
    const gp = toGround(ev.clientX, ev.clientY);
    if (!gp) return;
    let nx = gp.x - offX, nz = gp.z - offZ;
    const st = usePlacedProductStore.getState();
    // 자기 자식(follower)에 스냅/올라타는 자가참조 방지
    const others = st.placed.filter((pp) => pp.id !== p.id && !pp.parentId && !followerIds.has(pp.id));
    const f = footprintXZ({ ...p, x: nx, z: nz });
    const surfY = stackSurfaceY(p.id, f, others);
    if (surfY !== null) {
      g.position.y = surfY - (p.lift ?? 0) * M;
    } else {
      g.position.y = 0;
      const sn = others.length ? computeSnap(f, others) : { dx: 0, dz: 0 };
      nx += sn.dx; nz += sn.dz;
    }
    g.position.x = nx;
    g.position.z = nz;
    // follower 들도 몸통 델타만큼 실시간 이동
    const dx = nx - p.x, dz = nz - p.z, dy = g.position.y;
    for (const { f: fo, g: fg } of followers) {
      fg.position.x = fo.x + dx;
      fg.position.z = fo.z + dz;
      fg.position.y = dy;
    }
    requestShadowUpdate(); // 라이브 이동은 store를 안 거치므로 섀도맵 직접 갱신
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    setDraggingRef.current?.(false);
    if (!moved) return;
    const st = usePlacedProductStore.getState();
    const newLift = Math.max(0, Math.round((g.position.y + (p.lift ?? 0) * M) * 1000));
    const dx = g.position.x - p.x, dz = g.position.z - p.z, dLift = newLift - (p.lift ?? 0);
    g.position.y = 0;
    st.update(p.id, { x: g.position.x, z: g.position.z, lift: newLift });
    // follower 커밋 — 도어(parentId)는 몸통 커밋에 반응하는 정렬 효과가 재배치하므로 제외
    for (const { f: fo, g: fg } of followers) {
      fg.position.y = 0;
      if (fo.parentId) continue;
      st.update(fo.id, { x: fo.x + dx, z: fo.z + dz, lift: Math.max(0, (fo.lift ?? 0) + dLift) });
    }
    window.parent?.postMessage({ type: 'hp3:product-resized', code: p.code, w: p.w, d: p.d, h: p.h }, '*');
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
