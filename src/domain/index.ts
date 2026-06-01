/**
 * Domain 레이어 공공 API — 평면도 도메인 모델 + 상태.
 *
 * 의존: Lib only. Engine/Features/UI 무관 — 서버사이드 계산에도 사용 가능.
 */

// Structures
export { Node } from './structures/Node';
export type { NodeRegistry } from './structures/Node';
export { Wall } from './structures/Wall';
export type { WallRegistry } from './structures/Wall';
export type { Space, SpaceRegistry } from './structures/Space';
export { ObjectBase } from './structures/ObjectBase';

// Layout (도메인 헬퍼)
export * from './layout/Floor';
export * from './layout/Ceiling';
export * from './layout/Level';
export * from './layout/CeilingFloorBase';
export * from './layout/SpaceBuilder';
export * from './layout/SpaceManager';
export * from './layout/LayoutSplitWallsResolver';

// Products
export * from './products/ProductInfo';
export * from './products/ProductTypes';
export * from './products/ProductWallFilled';

// Camera
export * from './camera/CameraTypes';
export * from './camera/CameraPreset';
export * from './camera/CameraFov';
export * from './camera/CaptureResolution';

// State
export { useLayoutStore } from './state/layoutStore';
export type { LayoutState } from './state/layoutStore';