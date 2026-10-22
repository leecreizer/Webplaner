/**
 * 교차 선택 해제 — 한 종류를 선택하면 나머지 종류의 선택을 모두 지운다.
 * (벽을 선택한 채 모델을 선택해도 벽 하이라이트가 남던 문제의 공용 해법.)
 *
 * 각 선택 저장소는 selectionExclusivity 가 「지우기」를 등록하고, 선택이 생기면 여기로 나머지를 지운다.
 * 예전엔 저장소를 동적 import 로 비동기로 지워 순서가 꼬일 수 있었고, 이 함수를 부르는 입구(캔버스 클릭 일부)만
 * 서로 지웠다 — 씬 트리·천장 클릭·Homvue·조명 선택은 다른 선택이 그대로 남았다(사용자 지적 2026-10-22).
 */
export type SelectionKind = 'wall' | 'mesh' | 'model' | 'product' | 'module' | 'homvue' | 'light' | 'builtin';

const clearers = new Map<SelectionKind, () => void>();

export function registerSelectionKind(kind: SelectionKind, clear: () => void): void {
  clearers.set(kind, clear);
}

let clearing = false;
export function clearOtherSelections(keep: SelectionKind | SelectionKind[]): void {
  // 지우는 동안 일어나는 선택 변경(지우기 자체)은 다시 지우기를 부르지 않는다
  if (clearing) return;
  const keeps = Array.isArray(keep) ? keep : [keep];
  clearing = true;
  try {
    for (const [kind, clear] of clearers) if (!keeps.includes(kind)) clear();
  } finally {
    clearing = false;
  }
}
