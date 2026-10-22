import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { Box3, Box3Helper, Color, Matrix4, Object3D, Vector3, type Material } from 'three';
import { registerGizmo } from '@/features/models/gizmoGuard';
import { GizmoOrbitGuard } from '@/features/models/GizmoOrbitGuard';
import { requestShadowUpdate } from '@/engine/lighting/ShadowDemand';
import { useHomvueStore } from './homvueStore';
import { matrixToUeTransform } from './ueTransform';
import type { PlacedItem } from './homvueAssets';

/**
 * Homvue 기즈모 — 상품이든 집 부품(벽·바닥·천장)·방 바닥·레벨 메시든 고르면 이동·회전 손잡이를 띄운다
 * (홈플래너3 배치 상품과 같은 규칙).
 * - R = 회전(3축), G·T = 이동, 크기는 편집 패널(HomvueInspector) 버튼, Esc = 선택 해제
 * - 손잡이 위에 있거나 잡고 있는 동안엔 다른 물체를 고르지 않는다(gizmoGuard isGizmoBusy — Homvue 클릭 처리기도 따른다)
 * - 상품은 놓는 순간 언리얼 좌표(cm·도)로 바꿔 저장 — 견적·저장·상품 교체가 같은 자리를 쓴다
 * - 상품이 아닌 물체(key 가 `part:` 로 시작)는 장면 물체를 그대로 옮긴다 — 저장 대상이 아니라 이번 화면에서만 유지
 */

export interface HomvueGizmoTarget {
  obj: Object3D;
  /** 상품 — 있으면 놓을 때 언리얼 좌표로 저장 */
  item?: PlacedItem;
  /** 선택 상자(obj 자기 좌표). 없으면 obj 의 메시로 잰다 */
  localBox?: Box3;
  /** 처음 잡을 때 한 번 — 합쳐 둔 레벨 메시를 떼어 내는 데 쓴다 */
  onDragStart?: () => void;
  /** 손잡이를 물체 상자 가운데에 — 집 부품은 원점이 언리얼 액터 자리(방 모서리 등)라 손잡이가 화면 밖에 뜬다 */
  centerPivot?: boolean;
  /** 손잡이를 놓을 월드 위치 — 집 전체에 걸친 큰 부품(천장·바닥)은 가운데가 화면 밖이라 누른 자리에 띄운다 */
  pivotAt?: Vector3;
  /** 물체를 옮기는 중마다 — 조명처럼 값을 저장소에 바로 옮겨야 하는 것 */
  onChange?: () => void;
  /** 놓을 때(기본 = 상품이면 언리얼 좌표로 저장) */
  onCommit?: () => void;
  /** 아직 메시가 없는 대상(떼어 내기 전 레벨 메시)의 재질 — 편집 패널 재질 목록용 */
  materials?: Material[];
  /** 편집 패널 제목 */
  label?: string;
}

/** 물체를 놓은 뒤 저장 — 기즈모를 놓을 때와 편집 패널에서 숫자를 고칠 때 같은 길로 */
export function commitTarget(key: string) {
  const entry = homvueProductObjects.get(key);
  if (!entry) return;
  const { obj, item } = entry;
  obj.updateMatrix();
  requestShadowUpdate();
  if (entry.onCommit) entry.onCommit();
  else if (item) {
    const signs = item.scale.map((v) => Math.sign(v) || 1) as [number, number, number];
    const ue = matrixToUeTransform(obj.matrix, signs);
    useHomvueStore.getState().moveItem(key, { ...item, location_cm: ue.location_cm, rotation_deg: ue.rotation_deg, scale: ue.scale });
  }
  useHomvueStore.getState().bumpEdit();
}

/** 원점이 물체 상자(바닥 평면 기준) 밖이면 상자 바닥면 가운데(월드), 안이면 null */
function outsideOriginBase(obj: Object3D): Vector3 | null {
  obj.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const o = new Vector3().setFromMatrixPosition(obj.matrixWorld);
  const m = 0.05;
  const inside = o.x >= box.min.x - m && o.x <= box.max.x + m && o.z >= box.min.z - m && o.z <= box.max.z + m;
  if (inside) return null;
  return new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
}

/** 상자 가운데에 놓는 손잡이 물체 — 움직이면 같은 만큼 대상 물체를 따라 움직인다(대상의 부모·React 소유는 그대로) */
function makePivot(obj: Object3D, at?: Vector3): { pivot: Object3D; follow: () => void; dispose: () => void } | null {
  const parent = obj.parent;
  if (!parent) return null;
  obj.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const pivot = new Object3D();
  pivot.position.copy(parent.worldToLocal((at ?? box.getCenter(new Vector3())).clone()));
  pivot.quaternion.copy(obj.quaternion);
  parent.add(pivot);
  pivot.updateMatrix();
  const offset = new Matrix4().copy(pivot.matrix).invert().multiply(obj.matrix);
  const m = new Matrix4();
  return {
    pivot,
    follow: () => {
      pivot.updateMatrix();
      m.multiplyMatrices(pivot.matrix, offset).decompose(obj.position, obj.quaternion, obj.scale);
      obj.updateMatrix();
    },
    dispose: () => {
      parent.remove(pivot);
    },
  };
}

/** 물체 key → 장면 물체 (HomvueApartment 가 등록) */
/** 바뀌면 알려 주는 Map — 씬 트리가 등록·해제를 따라 다시 그린다(useSyncExternalStore) */
class ObservableMap<K, V> extends Map<K, V> {
  version = 0;
  private listeners = new Set<() => void>();
  private queued = false;
  set(k: K, v: V): this {
    super.set(k, v);
    this.bump();
    return this;
  }
  delete(k: K): boolean {
    const had = super.delete(k);
    if (had) this.bump();
    return had;
  }
  /** 숨김처럼 Map 밖에서 바뀐 것도 알린다 */
  bump() {
    this.version++;
    // 상품 수백 개가 한꺼번에 등록된다 — 알림은 한 번에 모아서
    if (this.queued || !this.listeners) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      for (const l of this.listeners) l();
    });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}
export const homvueProductObjects = new ObservableMap<string, HomvueGizmoTarget>();
/** 기즈모로 끄는 중 — 선택 상자를 숨긴다(놓을 때까지 옛 자리라) */
export const homvueGizmoState = { dragging: false };
// 화면 시험용 — 등록된 물체
if (typeof window !== 'undefined') (window as unknown as { __homvueGizmo?: unknown }).__homvueGizmo = { objects: homvueProductObjects, state: homvueGizmoState };

export function HomvueGizmo() {
  const selected = useHomvueStore((s) => s.selected);
  const overrides = useHomvueStore((s) => s.overrides);
  const mode = useHomvueStore((s) => s.gizmoMode);
  useHomvueStore((s) => s.editTick); // 고른 물체가 새로 만들어지면 다시 읽는다
  const setMode = useHomvueStore((s) => s.setGizmoMode);
  const [, setTick] = useState(0);
  const tc = useRef<{ axis: string | null; dragging: boolean } | null>(null);
  const entry = selected ? homvueProductObjects.get(selected) : undefined;
  const pivotAt = entry?.pivotAt;
  const handle = useMemo(() => {
    if (!entry) return null;
    if (entry.centerPivot) return makePivot(entry.obj, pivotAt);
    // 원점이 물체 밖에 있는 상품 — 언리얼에서 모양을 방 좌표 그대로 넣고 액터를 (0,0,0)에 둔 붙박이장·드레스룸
    // (59C S3 페어 웜코튼 4.5m · 스테이플러스 3.5m 떨어짐). 다른 상품처럼 바닥면 가운데에 손잡이를 둔다
    const base = outsideOriginBase(entry.obj);
    return base ? makePivot(entry.obj, base) : null;
  }, [entry, pivotAt]);
  useEffect(() => () => handle?.dispose(), [handle]);

  // 물체가 늦게 등록될 수 있다(GLB 받는 중·옮긴 뒤 새 물체) — 잠깐 뒤 다시 본다
  useEffect(() => {
    if (!selected) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), entry ? 60 : 300);
    return () => window.clearTimeout(t);
  }, [selected, entry, overrides]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!useHomvueStore.getState().selected) return;
      // 키 위치(code)로 — 한글 입력 상태면 e.key 가 ㄱ·ㅎ·ㅅ 으로 들어와 단축키가 안 먹었다
      if (e.code === 'KeyR') setMode('rotate');
      if (e.code === 'KeyG' || e.code === 'KeyT') setMode('translate');
      // 벽·바닥도 고를 수 있게 돼 「벽을 눌러 선택 풀기」가 없어졌다 — Esc 또는 빈 하늘 클릭으로 푼다
      if (e.code === 'Escape' && !homvueGizmoState.dragging) useHomvueStore.getState().select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  useEffect(() => {
    if (!tc.current) return;
    return registerGizmo(tc.current);
  });

  if (!selected || !entry) return null;
  const { obj, item } = entry;
  // 기즈모는 위치·회전·크기 값을 움직인다 — 행렬을 직접 넣어 둔 물체(prepare)라 값으로 풀어 자동 갱신으로 바꾼다
  if (!obj.matrixAutoUpdate) {
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    obj.matrixAutoUpdate = true;
  }
  const commit = () => {
    homvueGizmoState.dragging = false;
    handle?.follow();
    commitTarget(selected);
  };
  return (
    <>
      <GizmoOrbitGuard />
      <TransformControls
        ref={tc as never}
        key={`homvue-gizmo-${selected}-${mode}`}
        object={handle?.pivot ?? obj}
        mode={mode}
        space="local"
        size={0.8}
        onMouseDown={() => {
          homvueGizmoState.dragging = true;
          entry.onDragStart?.();
        }}
        onMouseUp={commit}
        onObjectChange={() => {
          handle?.follow();
          entry.onChange?.();
          requestShadowUpdate();
          useHomvueStore.getState().bumpEdit();
        }}
      />
      {/* 상품은 PlacedProduct 가 자기 선택 상자를 그린다 */}
      {!item && <SelectionBox target={entry} />}
    </>
  );
}

/** 상품이 아닌 물체의 선택 상자 — 장면 바로 아래(월드 좌표)에 그리고 매 화면 물체를 따라간다 */
function SelectionBox({ target }: { target: HomvueGizmoTarget }) {
  const scene = useThree((s) => s.scene);
  const box = useMemo(() => new Box3(), []);
  const helper = useMemo(() => {
    const h = new Box3Helper(box, new Color(0xfacc15));
    h.raycast = () => {}; // 클릭을 가로채지 않게
    return h;
  }, [box]);
  useFrame(() => {
    const { obj, localBox } = target;
    obj.updateWorldMatrix(true, true);
    if (localBox) box.copy(localBox).applyMatrix4(obj.matrixWorld);
    else box.setFromObject(obj);
  });
  return createPortal(<primitive object={helper} />, scene);
}
