/**
 * 기즈모(TransformControls) 조작 가드.
 *
 * 기즈모 화살표/평면 핸들은 씬의 다른 메시와 화면상 겹칠 수 있는데, r3f 이벤트는
 * 기즈모와 무관하게 뒤의 메시에도 pointerdown 을 전달한다 → 핸들을 잡으려는 클릭이
 * 뒤 모델을 "선택"해 버려 기즈모가 사라지고 드래그가 끊기는 문제.
 *
 * TransformControls 인스턴스를 등록해 두고, 씬의 선택/드래그 핸들러는
 * `isGizmoBusy()` 가 true(핸들 호버 중이거나 드래그 중)면 선택을 무시한다.
 */
interface GizmoLike {
  /** 현재 호버/활성 축 ('X'|'Y'|'Z'|'XYZ'|...) — 핸들 위에 포인터가 있으면 non-null. */
  axis: string | null;
  dragging: boolean;
}

const active = new Set<GizmoLike>();

/**
 * 카메라 컨트롤(OrbitControls) 참조 — 기즈모 드래그 도중 언마운트 시 재활성 복구용.
 * drei `<TransformControls>` 는 드래그를 시작하면 `dragging-changed:true` 로 OrbitControls.enabled
 * 를 false 로 끄고, 마우스를 놓을 때 `dragging-changed:false` 로 다시 켠다. 그런데 드래그 도중
 * 기즈모가 **언마운트**되면(three-stdlib 가 pointerup 을 받지 못함) `dragging-changed:false` 가
 * 발생하지 않고, drei 의 정리 로직도 enabled 를 되돌리지 않는다 → OrbitControls.enabled 가 false 로
 * 고정되어 카메라 회전이 영구 정지한다. (생성 GLB 모델은 Suspense 로딩 중 서브트리 스왑으로 드래그
 * 도중 기즈모가 리마운트되어 정확히 이 상황을 유발한다.)
 */
type OrbitLike = { enabled: boolean };
// StrictMode(dev) 리마운트·makeDefault 핸드오프로 OrbitControls 인스턴스가 여러 개 생길 수 있어
// 단일 참조로는 "카메라를 실제로 구동하는" 인스턴스를 놓친다 → Set 으로 전부 추적한다.
const orbitSet = new Set<OrbitLike>();

/** OrbitControls 인스턴스 등록(App, ref 콜백). 반환 함수로 해제. */
export function registerOrbitControls(o: OrbitLike | null): () => void {
  if (o) orbitSet.add(o);
  return () => { if (o) orbitSet.delete(o); };
}

/** 등록된 모든 OrbitControls 중 비활성(enabled=false)인 것을 다시 켠다.
 * 기즈모 드래그 도중 언마운트로 dragging-changed:false 가 유실돼 고정된 상태를 복구. */
export function reenableAllOrbit(): void {
  for (const o of orbitSet) { if (o.enabled === false) o.enabled = true; }
}

/**
 * 기즈모 색 튜닝 — 기본(비호버) 축은 차분한 색, 핸들 호버/드래그(active) 시 밝은 색.
 * three 0.185 TransformControls.setColors(x, y, z, active) 공식 API 사용.
 * (기존 기본값은 원색 축 + 노랑 active 인데, 톤매핑 환경에서 active 가 오히려
 *  흐려 보인다는 피드백 → 축을 어둡게 낮추고 active 를 고휘도로.)
 */
function tuneGizmoAppearance(g: GizmoLike): void {
  const tc = g as unknown as {
    setColors?: (x: number, y: number, z: number, active: number) => void;
  };
  try {
    tc.setColors?.(0x8f3a3a, 0x3a8f3a, 0x3a4a8f, 0xffff55);
  } catch { /* 구버전 등 미지원 시 기본 색 유지 */ }
}

/** TransformControls mount 시 등록 — 반환된 함수로 unmount 시 해제. */
export function registerGizmo(g: GizmoLike): () => void {
  active.add(g);
  tuneGizmoAppearance(g);
  return () => active.delete(g);
}

/** 어떤 기즈모든 핸들 호버/드래그 중 — 이때 씬 클릭 선택은 무시해야 한다. */
export function isGizmoBusy(): boolean {
  for (const g of active) {
    if (g.axis !== null || g.dragging) return true;
  }
  return false;
}
