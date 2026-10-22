import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { isGizmoBusy } from '@/features/models/gizmoGuard';

/** 누른 뒤 이만큼(px) 움직이기 전엔 카메라가 반응하지 않는다 — 클릭(선택) 판정과 같은 값 */
const PRESS_SLOP_PX = 4;

/**
 * 누르기만 해도 경로 추적이 처음부터 다시 그려지던 문제 막기(사용자 보고 2026-10-21).
 * 진짜 마우스는 누르고 있는 동안 손 떨림으로 1~2px 씩 움직임 신호를 보내고, 궤도 카메라(OrbitControls)는
 * 문턱 없이 그만큼 카메라를 돌린다 → 경로 추적은 카메라가 조금만 바뀌어도 누적을 버리고 처음부터 그린다.
 * 경로 추적 모드에서만, 누른 뒤 4px 넘게 움직이기 전의 움직임 신호를 캔버스에 닿기 전에(캡처 단계) 막는다.
 * 기즈모 손잡이를 잡았을 때는 막지 않는다(손잡이는 바로 따라와야 한다).
 */
export function PressJitterGuard() {
  const el = useThree((s) => s.gl.domElement);
  useEffect(() => {
    let down: { x: number; y: number; id: number; free: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, free: isGizmoBusy() };
    };
    const onMove = (e: PointerEvent) => {
      if (!down || down.free || e.pointerId !== down.id) return;
      if (useLightingStore.getState().giMode !== 'mutracer') return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > PRESS_SLOP_PX) {
        down.free = true; // 이제부터는 진짜 끌기
        return;
      }
      e.stopPropagation(); // 캔버스(OrbitControls·r3f)에 닿지 않게
    };
    const onUp = (e: PointerEvent) => {
      if (down && e.pointerId === down.id) down = null;
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [el]);
  return null;
}
