import { useFrame } from '@react-three/fiber';
import { create } from 'zustand';

/**
 * 카메라가 움직이는 중인지 — 궤도 회전·이동·투어 걷기 모두(카메라 행렬이 바뀌었는지로 판정).
 * 움직이는 동안 숨길 표시(Homvue 이동 지점·상품 정보 점 등)가 구독한다. 상태는 바뀔 때만 갱신해 다시 그리기를 줄인다.
 */
export const useCameraMotionStore = create<{ moving: boolean }>(() => ({ moving: false }));

/** 마지막 움직임 뒤 이만큼(ms) 지나면 멈춘 것으로 본다 */
const STILL_MS = 250;
// Float32 면 반올림 때문에 매번 다르게 보여 늘 움직이는 것으로 판정된다(MutracerRenderer 와 같은 이유)
const last = new Float64Array(16);
let lastMove = -Infinity;

export function CameraMotionWatcher() {
  useFrame(({ camera }) => {
    const now = performance.now();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (last[i] !== e[i]) moved = true;
    if (moved) {
      last.set(e);
      lastMove = now;
    }
    const moving = now - lastMove < STILL_MS;
    if (moving !== useCameraMotionStore.getState().moving) useCameraMotionStore.setState({ moving });
  });
  return null;
}
