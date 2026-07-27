import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { reenableAllOrbit } from './gizmoGuard';

/**
 * 기즈모(TransformControls) 언마운트 시 카메라(OrbitControls) 재활성 보장.
 *
 * drei `<TransformControls>` 는 드래그 도중 언마운트되면 three-stdlib 의 pointerup
 * (`dragging=false`)을 받지 못해 `dragging-changed:false` 이벤트를 쏘지 못하고, 정리
 * 단계에서도 `defaultControls.enabled` 를 복구하지 않는다 → OrbitControls.enabled 가
 * false 로 고정되어 **카메라 우클릭 회전이 영구 정지**한다.
 * (생성 GLB 모델은 Suspense 로딩 중 서브트리 스왑으로 드래그 도중 기즈모가 리마운트되어
 *  이 버그를 그대로 유발한다.)
 *
 * 기즈모와 **같은 조건부 블록**에 함께 렌더하면 기즈모가 사라질 때(deps []) cleanup 이 돌아
 * ① 등록된 모든 OrbitControls, ② 현재 R3F 기본 컨트롤(get().controls) 중 꺼진 것을 되살린다.
 * 정상 종료(마우스 놓은 뒤 해제)에는 이미 enabled=true 라 no-op 이므로 안전하다.
 * microtask 지연 — drei TC 의 makeDefault cleanup(set controls→orbit)이 먼저 끝난 뒤
 * get().controls 가 orbit 으로 복구된 상태에서 켜지도록.
 */
export function GizmoOrbitGuard() {
  const get = useThree((s) => s.get);
  useEffect(() => () => {
    const fix = () => {
      reenableAllOrbit();
      const c = get().controls as { enabled?: boolean } | null;
      if (c && c.enabled === false) c.enabled = true;
    };
    fix();
    Promise.resolve().then(fix); // 리마운트/핸드오프 후 재확인
  }, [get]);
  return null;
}
