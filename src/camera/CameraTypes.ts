import { Vector3 } from 'three';

/**
 * 카메라 조작 모드.
 * Unity `CameraController.CameraMode` 대응.
 */
export enum CameraMode {
  /** 원근 투영 3D 뷰. */
  Mode3D = 'Mode3D',
  /** Orthographic 2D 도면 뷰. */
  Mode2D = 'Mode2D',
}

/**
 * 카메라 이동 모드. Render 시 zoom이 keyboard 이동으로 전환된다.
 * Unity `CameraController.CameraMoveMode` 대응.
 */
export enum CameraMoveMode {
  Normal = 'Normal',
  Render = 'Render',
}

/**
 * 카메라의 위치·회전·프로젝션 상태 스냅샷.
 * Unity `CameraController.CameraModeState` 1:1 포팅.
 *
 * 모드 전환(3D↔2D) 시 직전 모드의 상태를 보관해 복귀 시 복원하는 용도.
 */
export interface CameraModeState {
  /** 월드 위치. */
  position: Vector3;
  /** 오일러 회전(도). */
  rotation: Vector3;
  /** Orthographic 모드일 때의 `orthographicSize` (= viewport 절반 높이, m). */
  orthoSize: number;
}