declare module 'n8ao' {
  import { Camera, Color, Scene } from 'three';
  import { Pass } from 'postprocessing';

  /**
   * N8AO Pass configuration — Proxy 객체로 값 변경 시 자동 reconfigure.
   * 참고: node_modules/n8ao/dist/N8AO.js 의 N8AOPostPass.configuration 초기값.
   */
  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: 0 | 1 | 2 | 3 | 4;
    biasOffset: number;
    biasMultiplier: number;
    color: Color;
    gammaCorrection: boolean;
    depthBufferType: number;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  /** postprocessing v6 호환 N8AO Pass. */
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setSize(width: number, height: number): void;
    dispose(): void;
  }

  /** vanilla three EffectComposer용 N8AO Pass. (현재 미사용 — N8AOPostPass 사용) */
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setSize(width: number, height: number): void;
    dispose(): void;
  }

  export const DepthType: {
    Default: number;
    HalfFloat: number;
    Float: number;
  };
}