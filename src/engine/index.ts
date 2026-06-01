/**
 * Engine 레이어 공공 API — Three.js / React Three Fiber 기반 렌더링/라이팅/포스트프로세싱.
 *
 * 도메인(Node/Wall/Space)을 미참조한다. 어떤 R3F 씬에도 단독으로 마운트 가능.
 */

// Lighting
export { SceneLightProbe } from './lighting/SceneLightProbe';
export { SpaceLightmap } from './lighting/SpaceLightmap';
export { CustomLights } from './lighting/CustomLights';

// Post-FX
export { PostFX } from './postfx/PostFX';

// Path tracer
export { PathtracerRenderer } from './pathtracer/PathtracerRenderer';

// Mesh utils
export * from './mesh/MeshGenerator';

// Stores (Zustand)
export { useLightingStore, sphericalToCartesian, shadowMapSizeFor } from './stores/lightingStore';
export type { LightingState, EnvironmentPreset, ShadowQuality, ToneMappingMode } from './stores/lightingStore';
export { useViewStore } from './stores/viewStore';
export { useCustomLightStore } from './stores/customLightStore';