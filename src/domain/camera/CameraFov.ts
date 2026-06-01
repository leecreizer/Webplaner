import { PerspectiveCamera, OrthographicCamera } from 'three';
import { clamp, lerp } from '@/lib/math/Math';

/**
 * 카메라 화각(FOV / OrthographicSize)을 슬라이더 친화적인 0~1 정규화 값으로 다루는 헬퍼.
 *
 * Unity `CameraFovController` 중 *순수 계산* 부분만 옮긴 것. 마우스 휠/슬라이더 입력 처리는
 * r3f의 `OrbitControls`(zoom) 또는 UI 컴포넌트가 직접 담당한다.
 */

/** FOV / OrthoSize 범위 설정. */
export interface FovRange {
  /** Perspective FOV 최솟값(도). */
  minFov: number;
  /** Perspective FOV 최댓값(도). */
  maxFov: number;
  /** Orthographic 최솟값. */
  minOrthoSize: number;
  /** Orthographic 최댓값. */
  maxOrthoSize: number;
}

/** Unity `CameraFovController`의 인스펙터 기본값과 동일. */
export const DEFAULT_FOV_RANGE: FovRange = {
  minFov: 20,
  maxFov: 100,
  minOrthoSize: 1,
  maxOrthoSize: 20,
};

/**
 * 0~1 정규화 값 → 실제 FOV 또는 OrthoSize.
 * Unity `CameraFovController.NormalizedToValue(t)` 대응.
 */
export function normalizedToValue(
  t: number,
  camera: PerspectiveCamera | OrthographicCamera,
  range: FovRange = DEFAULT_FOV_RANGE,
): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    return lerp(range.minOrthoSize, range.maxOrthoSize, t);
  }
  return lerp(range.minFov, range.maxFov, t);
}

/**
 * 실제 FOV/OrthoSize → 0~1 정규화 값.
 * Unity `CameraFovController.ValueToNormalized(value)` 대응.
 */
export function valueToNormalized(
  value: number,
  camera: PerspectiveCamera | OrthographicCamera,
  range: FovRange = DEFAULT_FOV_RANGE,
): number {
  const min = (camera as OrthographicCamera).isOrthographicCamera ? range.minOrthoSize : range.minFov;
  const max = (camera as OrthographicCamera).isOrthographicCamera ? range.maxOrthoSize : range.maxFov;
  if (max - min === 0) return 0;
  return (value - min) / (max - min);
}

/**
 * 카메라의 현재 FOV 또는 OrthoSize를 반환한다.
 * Unity `CameraFovController.CurrentValue` 대응.
 */
export function getCurrentFovValue(camera: PerspectiveCamera | OrthographicCamera): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera;
    // OrthographicSize 개념(절반 높이)으로 반환 — top - bottom = 2 × size
    return (ortho.top - ortho.bottom) * 0.5;
  }
  return (camera as PerspectiveCamera).fov;
}

/**
 * 카메라에 FOV 또는 OrthoSize를 직접 설정한다.
 * Three.js는 변경 후 `updateProjectionMatrix()` 호출이 필요하다 — 본 함수가 자동으로 호출.
 *
 * Unity `CameraFovController.SetValue(value)` 대응.
 */
export function setFovValue(
  camera: PerspectiveCamera | OrthographicCamera,
  value: number,
  range: FovRange = DEFAULT_FOV_RANGE,
): void {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const clamped = clamp(value, range.minOrthoSize, range.maxOrthoSize);
    const ortho = camera as OrthographicCamera;
    // 종횡비 유지하면서 top/bottom/left/right 갱신
    const aspect =
      (ortho.right - ortho.left) / Math.max(0.0001, ortho.top - ortho.bottom);
    ortho.top = clamped;
    ortho.bottom = -clamped;
    ortho.right = clamped * aspect;
    ortho.left = -clamped * aspect;
    ortho.updateProjectionMatrix();
  } else {
    const persp = camera as PerspectiveCamera;
    persp.fov = clamp(value, range.minFov, range.maxFov);
    persp.updateProjectionMatrix();
  }
}