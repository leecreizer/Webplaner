import { Component, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box3, DoubleSide, Group, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';
import { Edges, TransformControls, useGLTF } from '@react-three/drei';
import { HelperScaler, isHelperRegionName, replaceableSizeOf, pickReplaceableSize } from '@/domain/products/HelperScaler';
import { readDpTypes, readDoorSlots } from '@/domain/products/ModelMarkers';
import { usePlacedProductStore, type PendingProduct, type PlacedProduct, type DoorVariant } from './placedProductStore';

const M = 1 / 1000; // mm → m
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
  const ex = (near90 ? p.d : p.w) * M; // x 방향 폭
  const ez = (near90 ? p.w : p.d) * M; // z 방향 깊이
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
      <meshStandardMaterial color={sel ? '#b98a3e' : '#c9a063'} roughness={0.6} />
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
  const { scene } = useGLTF(url);
  const { obj, scale, pos, dpTypes, doorSlots, selSize, bodyCx, bodyCz, bodyMinY, drawers } = useMemo(() => {
    // useGLTF 공유 geometry 보호 — 인스턴스 전용 deep clone 후 변형.
    const clone = scene.clone(true);
    clone.traverse((o) => {
      if (o instanceof Mesh) o.geometry = o.geometry.clone();
    });

    const scaler = HelperScaler.build(clone);
    const useHelper = scaler.regionCount > 0;
    if (typeof window !== 'undefined' && (window as unknown as { __HELPER_DEBUG__?: boolean }).__HELPER_DEBUG__) {
      const names: string[] = [];
      clone.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) names.push(o.name || '(unnamed)'); });
      // eslint-disable-next-line no-console
      console.log('[FittedModel] regionCount=', scaler.regionCount, 'useHelper=', useHelper, 'meshes=', names, scaler.getDiagnostics());
    }
    // 크기 정책: 몸통(변형 대상 메시)을 입력 치수(p.w/h/d)에 맞춰 helper 영역 기준 스트레치.
    // (GLB는 변환 시 mm→m 정규화 → origSize도 미터이므로 delta가 정상 범위. replaceableW
    //  구성품은 isTransformable에서 제외되어 고정 크기 유지된다.)
    // 목표 치수(m, y-up): x=폭(w), y=높이(h), z=깊이(d)
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

    // 몸통 DP 타입(모델에 보존된 DP 노드) — 도어 매칭용. 없으면 [] (도어/일반 상품).
    const dpTypes = readDpTypes(clone);
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
      drawers.push({ node: o, basePos: o.position.clone(), dir, offset: offsetLocal, y: cy });
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
  }, [scene, p.w, p.d, p.h, p.lift]);

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
    openElapsed.current = doorsOpen ? openElapsed.current + dt : Math.max(0, openElapsed.current - dt);
    for (let i = 0; i < drawers.length; i++) {
      const startAt = DOOR_OPEN_DELAY + i * DRAWER_STAGGER; // 아래(i=0)부터
      const target = doorsOpen && openElapsed.current >= startAt ? 1 : 0;
      const cur = drawerProg.current[i];
      const next = cur + (target - cur) * Math.min(1, dt * 6);
      drawerProg.current[i] = Math.abs(target - next) < 1e-4 ? target : next;
      const dr = drawers[i], amt = dr.offset * drawerProg.current[i];
      dr.node.position.set(dr.basePos.x + dr.dir.x * amt, dr.basePos.y + dr.dir.y * amt, dr.basePos.z + dr.dir.z * amt);
    }
  });

  return (
    <group>
      <primitive object={obj} scale={scale} position={pos} />
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
      position={[p.x, 0, p.z]}
      rotation={[0, (p.ry * Math.PI) / 180, 0]}
      onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onDown(p.id, p.code, p.name, e.nativeEvent.shiftKey); }}
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
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
  /** 선택 박스들의 중심 피벗(보이지 않음) — 기즈모를 여기 붙여 다중 이동/회전 */
  const [pivotObj, setPivotObj] = useState<Object3D | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tcRef = useRef<any>(null); // TransformControls 인스턴스 — 핸들 위면 .axis 설정됨
  const lastPivot = useRef<{ x: number; z: number; ry: number }>({ x: 0, z: 0, ry: 0 });
  const selectedSet = new Set(selectedIds);

  // 선택이 바뀌면 피벗을 선택 박스들의 중심으로 재배치 (회전 0)
  useEffect(() => {
    if (!pivotObj || selectedIds.length === 0) return;
    const boxes = usePlacedProductStore.getState().placed.filter((p) => selectedIds.includes(p.id));
    if (boxes.length === 0) return;
    const cx = boxes.reduce((s, b) => s + b.x, 0) / boxes.length;
    const cz = boxes.reduce((s, b) => s + b.z, 0) / boxes.length;
    pivotObj.position.set(cx, 0, cz);
    pivotObj.rotation.set(0, 0, 0);
    lastPivot.current = { x: cx, z: cz, ry: 0 };
  }, [pivotObj, selectedIds]);

  // 박스 클릭 선택 (Shift = 다중 토글), 호스트에 선택 정보 전송.
  // useCallback: PlacedItem memo가 유지되도록 안정 참조. (select는 zustand 액션이라 안정)
  const onBoxDown = useCallback((id: string, code: string | undefined, name: string, shift: boolean) => {
    select(id, shift);
    const ids = usePlacedProductStore.getState().selectedIds;
    if (ids.length <= 1) window.parent?.postMessage({ type: 'hp3:selected', code, name }, '*');
    else window.parent?.postMessage({ type: 'hp3:selected', code, name, count: ids.length }, '*');
  }, [select]);

  // 기즈모 변경 → 선택 박스 전체에 이동/회전 델타 적용
  const onPivotChange = () => {
    if (!pivotObj) return;
    const px = pivotObj.position.x, pz = pivotObj.position.z, pry = pivotObj.rotation.y;
    const last = lastPivot.current;
    const dx = px - last.x, dz = pz - last.z, dRy = pry - last.ry;
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
      for (const b of sel) update(b.id, { x: b.x + dx + snap.dx, z: b.z + dz + snap.dz });
    } else if (gizmoMode === 'rotate' && dRy) {
      const cx = last.x, cz = last.z, cos = Math.cos(dRy), sin = Math.sin(dRy);
      for (const b of st.placed) if (selectedSet.has(b.id)) {
        const rx = b.x - cx, rz = b.z - cz;
        update(b.id, { x: cx + rx * cos - rz * sin, z: cz + rx * sin + rz * cos, ry: b.ry + (dRy * 180) / Math.PI });
      }
    }
    lastPivot.current = { x: px, z: pz, ry: pry };
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
        setPending({ name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0, modelUrl: d.modelUrl });
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
        for (const id of targets) st.update(id, patch);
        return;
      }
      if (d && d.type === 'hp3:attach-doors') {
        // 선택된 몸통에 DP 매칭 도어들을 POS(L/R)에 자동 배치 (시뮬레이션: 박스)
        const ad = e.data as { bodyW?: number; bodyD?: number; bodyH?: number; doors?: { code?: string; name?: string; w?: number; d?: number; h?: number; pos?: string; modelUrl?: string; masterW?: number; masterH?: number; masterD?: number; modelCode?: string; itemCode?: string; variants?: DoorVariant[]; mirror?: boolean }[] };
        const st = usePlacedProductStore.getState();
        const bodyId = st.selectedIds[0] ?? (st.placed.length ? st.placed[st.placed.length - 1].id : null);
        const body = st.placed.find((p) => p.id === bodyId);
        if (!body || !ad.doors?.length) return;
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
            name: dr.name ?? '도어', code: dr.code, w: dr.w || 600, d: dr.d || 30, h: dr.h || body.h, lift: body.lift ?? 0, modelUrl: dr.modelUrl,
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
          st.update(st.selectedId, { name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0 });
        } else {
          setPending({ name: d.name ?? '상품', code: d.code, w: d.w || 600, d: d.d || 600, h: d.h || 600, lift: d.lift || 0 });
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
        <PlacedItem key={p.id} p={p} sel={selectedSet.has(p.id)} onDown={onBoxDown} doorsOpen={doorsOpen} doorOpenDeg={doorOpenDeg} />
      ))}

      {/* 선택 중심 피벗 + 기즈모 — 다중 선택 시 전체 이동/회전 (G=이동, R=회전) */}
      <object3D ref={setPivotObj} />
      {selectedIds.length > 0 && pivotObj && (
        <TransformControls
          ref={tcRef}
          key={`gizmo-${selectedIds.join(',')}-${gizmoMode}`}
          object={pivotObj}
          mode={gizmoMode}
          showX={gizmoMode === 'translate'}
          showZ={gizmoMode === 'translate'}
          showY={gizmoMode === 'rotate'}
          onObjectChange={onPivotChange}
        />
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
            onPointerMove={(e) => { e.stopPropagation(); setGhost([e.point.x, e.point.z]); }}
            onPointerDown={(e) => {
              if (e.button === 2) { cancel(); setGhost(null); return; } // 우클릭 취소
              if (e.button !== 0) return;
              e.stopPropagation();
              // 배치 시에도 인접 상품과 충돌 체크 → 모서리 스냅.
              let px = e.point.x, pz = e.point.z;
              const st = usePlacedProductStore.getState();
              if (pending && st.placed.length) {
                const ghostP = { ...pending, id: 'ghost', x: px, z: pz, ry: 0 } as PlacedProduct;
                const f = footprintXZ(ghostP);
                const others = st.placed.filter((b) => !b.parentId);
                const snap = computeSnap(f, others);
                px += snap.dx; pz += snap.dz;
              }
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