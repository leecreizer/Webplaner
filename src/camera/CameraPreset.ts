import { Vector3 } from 'three';

/**
 * 카메라 동작 프리셋 — 입력/이동/회전 활성 여부 + 초기 위치/회전 + 투영 방식.
 *
 * Unity `CameraPreset` 1:1 포팅. 모든 필드는 선택적(undefined면 적용 안 함).
 *
 * 사용처: `CameraController.applyPreset(preset)` (또는 r3f 컴포넌트가 props로 전달받아 적용)
 */
export interface CameraPreset {
  /** 마우스/키보드 입력 자체를 활성화/비활성화. */
  inputEnabled?: boolean;
  /** Pan/Zoom 이동 허용. */
  movementEnabled?: boolean;
  /** 상하(Y축) 이동 허용. TopDown2D에서 false. */
  verticalMoveEnabled?: boolean;
  /** Orbit 회전 허용. */
  rotateEnable?: boolean;
  /** 초기 회전 (오일러, 도 단위). */
  initialRotation?: Vector3;
  /** 초기 위치 (m). */
  initialPosition?: Vector3;
  /** true=Orthographic, false=Perspective, undefined=현재 설정 유지. */
  orthographic?: boolean;
}

/**
 * 자유 시점 3D 프리셋 — 모든 입력 허용, 원근 투영.
 * Unity `CameraPreset.Free`.
 */
export const CameraPresetFree: CameraPreset = {
  inputEnabled: true,
  movementEnabled: true,
  verticalMoveEnabled: true,
  rotateEnable: true,
  orthographic: false,
  initialRotation: new Vector3(45, 0, 0),
  initialPosition: new Vector3(0, 7.2, -7.2),
};

/**
 * 회전만 끈 프리셋 (다른 옵션은 현재 상태 유지).
 * Unity `CameraPreset.NoRotation`.
 */
export const CameraPresetNoRotation: CameraPreset = {
  rotateEnable: false,
};

/**
 * 카메라 잠금 — 입력·이동 모두 차단.
 * Unity `CameraPreset.Locked`.
 */
export const CameraPresetLocked: CameraPreset = {
  inputEnabled: false,
  movementEnabled: false,
};

/**
 * 평면도 모드 — 위에서 내려다보는 Orthographic 뷰. 회전·수직 이동 차단.
 * Unity `CameraPreset.TopDown2D`.
 */
export const CameraPresetTopDown2D: CameraPreset = {
  inputEnabled: true,
  movementEnabled: true,
  verticalMoveEnabled: false,
  rotateEnable: false,
  orthographic: true,
  initialRotation: new Vector3(90, 0, 0),
  initialPosition: new Vector3(0, 10, 0),
};