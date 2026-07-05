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
