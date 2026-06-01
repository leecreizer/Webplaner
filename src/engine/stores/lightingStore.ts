import { create } from 'zustand';

/**
 * drei의 `<Environment preset>` 값. HDR 환경맵으로 IBL(image-based lighting)을 제공.
 */
export type EnvironmentPreset =
  | 'apartment'
  | 'city'
  | 'dawn'
  | 'forest'
  | 'lobby'
  | 'night'
  | 'park'
  | 'studio'
  | 'sunset'
  | 'warehouse';

/** 그림자 품질 — shadowMap 종류 + 해상도 + soft radius를 묶음. */
export type ShadowQuality = 'low' | 'medium' | 'high' | 'ultra';

/** 톤매핑 알고리즘. ACES Filmic이 사실적 렌더링의 표준. */
export type ToneMappingMode = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces' | 'agx';

/**
 * GI(Global Illumination) 처리 방식.
 * - `hemisphere`: HemisphereLight + ambient — 가장 가볍지만 위치 무관 균일.
 * - `single-probe`: SceneLightProbe — 씬 전체 1개 cube capture → SH IBL.
 * - `probe-grid`: IrradianceProbeGrid — 공간마다 cube capture → N개 SH 합산 (Monter
 *   엔진의 irradiance probe grid 개념 — three.js native multi-probe sum 으로 간소화).
 * - `path-tracer`: GPU Path Tracer — 실시간 ray traced GI, 가장 사실적 / 비쌈.
 */
export type GIMode = 'hemisphere' | 'single-probe' | 'probe-grid' | 'path-tracer';

/** SceneOutliner 에서 선택 가능한 기본 광원 종류. Inspector 가 이걸 보고 적절한 컨트롤 노출. */
export type BuiltinLightKind = 'sun' | 'ambient' | 'hemi';

/**
 * 방향 조명(태양광) + 환경광 + 그림자 + 포스트프로세싱 상태.
 *
 * 방향 조명의 위치는 (azimuth, elevation, distance) 구면 좌표로 표현된다.
 *
 * 참고: realism-effects / threejs-realistic-render 등의 패턴을 종합 — Soft shadow (PCFSoft),
 * ACES Filmic tone mapping, sRGB color space, HDR environment, EffectComposer 기반 Bloom/SSAO/
 * Vignette/DOF를 조합한다.
 */
export interface LightingState {
  // ===== 광원 =================================================
  azimuth: number;
  elevation: number;
  distance: number;
  intensity: number;
  ambientIntensity: number;

  // ===== 그림자 ===============================================
  castShadow: boolean;
  shadowQuality: ShadowQuality;
  /** 그림자 가장자리 부드러움 (PCFSoft `radius` — 큰 값 = 더 부드러움). */
  shadowSoftness: number;
  /** shadow-bias — 음수 offset. 너무 크면 그림자가 객체에서 떨어져 시작, 너무 작으면 acne. */
  shadowBias: number;
  /** shadow-normalBias — 법선 방향 offset. peter-panning 보정. */
  shadowNormalBias: number;
  /** shadow camera frustum 반경(m). 인테리어 ~10m, 야외 ~30m. 클수록 정밀도 ↓. */
  shadowFrustumSize: number;
  /** 그림자 강도 (0=거의 없음, 1=완전 검정). ambientLight 강도를 역으로 줄여 darkening. */
  shadowStrength: number;
  /** 그림자(=음영) 색. ambientLight의 color로 적용 — 그림자 진 영역의 색조. */
  shadowColor: string;

  // ===== GI 모드 선택 =========================================
  /** Global Illumination 처리 방식. 라이팅 패널에서 단일 선택. */
  giMode: GIMode;

  // ===== Fake GI (poor-man's Global Illumination) ===========
  /** GI 강도 (HemisphereLight intensity + AccumulativeShadows 누적 강화). 0이면 비활성. */
  giIntensity: number;
  /** sky 방향에서 내려오는 ambient bounce 색 (천장/위쪽 광 시뮬). */
  giSkyColor: string;
  /** ground 방향에서 올라오는 bounce 색 (바닥/벽 반사 시뮬 — 약한 warm tone). */
  giGroundColor: string;

  // ===== 라이트맵 ============================================
  /** SpaceLightmap (AccumulativeShadows 기반 베이크 그림자) 적용 여부. */
  lightmapEnabled: boolean;

  // ===== LightProbe (CubeCamera + SH) ========================
  /** three.js native LightProbe — 씬을 cube camera로 캡처해 SH 계수로 IBL ambient 생성. */
  lightProbeEnabled: boolean;
  /** LightProbe 강도 (0~3). 1.0이 표준 IBL. */
  lightProbeIntensity: number;
  /** GPU Path Tracer 활성 — 유니티/언리얼 수준의 GI/반사 — 카메라 정지 시 progressive sample 누적.
   *  무거운 작업이라 default false. 사용자가 명시적으로 토글. */
  pathtracerEnabled: boolean;
  /** Path tracer bounces (광 반사 횟수). 3~6이 일반적. 높을수록 정교, 비용 증가. */
  pathtracerBounces: number;

  // ===== 환경맵 (IBL) =========================================
  environmentPreset: EnvironmentPreset;
  /** HDR을 배경으로도 보일지 (true면 sky/주변 풍경 표시, false면 단색 배경). */
  environmentBackground: boolean;
  /** Environment 강도(0~3). */
  environmentIntensity: number;

  // ===== Tone mapping / exposure ==============================
  toneMapping: ToneMappingMode;
  /** 노출(exposure). 1.0 = 기본. ACES와 함께 조정. */
  toneMappingExposure: number;

  // ===== 포스트프로세싱 =======================================
  /** 밝은 부분이 빛 번지듯 빛나는 효과. */
  bloomEnabled: boolean;
  bloomIntensity: number;

  /** N8AO — 모서리·구석을 자연스럽게 어둡게 (Horizon-Based Ambient Occlusion). */
  ssaoEnabled: boolean;
  ssaoIntensity: number;
  /** AO 반경(m). 인테리어 스케일은 0.3~0.8 권장. */
  aoRadius: number;
  /** AO 거리 페이드. 0.1~1 범위, 작을수록 halo 적음. */
  aoDistanceFalloff: number;

  /** GTAO (Ground Truth AO, three.js native) 활성. N8AO와 별개. */
  gtaoEnabled: boolean;
  /** GTAO blend intensity (0~1). */
  gtaoIntensity: number;
  /** GTAO sampling 반경 (m 환산은 scale에 의존). */
  gtaoRadius: number;
  /** GTAO 거리 페이드 — halo 줄이기. */
  gtaoDistanceFalloff: number;
  /** GTAO 두께 — geometry self-occlusion 방지. */
  gtaoThickness: number;
  /** GTAO scale — radius 곱셈자. */
  gtaoScale: number;

  /** 화면 가장자리 어둡게 비네팅. */
  vignetteEnabled: boolean;
  vignetteIntensity: number;

  /** 피사계 심도(DOF) — 카메라 포커스 거리 외 흐림. 인테리어에서는 보통 OFF. */
  dofEnabled: boolean;
  dofFocusDistance: number;
  dofBokehScale: number;

  // ===== Setters ==============================================
  setAzimuth: (v: number) => void;
  setElevation: (v: number) => void;
  setDistance: (v: number) => void;
  setIntensity: (v: number) => void;
  setAmbientIntensity: (v: number) => void;
  setCastShadow: (v: boolean) => void;
  setShadowQuality: (v: ShadowQuality) => void;
  setShadowSoftness: (v: number) => void;
  setShadowStrength: (v: number) => void;
  setShadowBias: (v: number) => void;
  setShadowNormalBias: (v: number) => void;
  setShadowFrustumSize: (v: number) => void;
  setShadowColor: (v: string) => void;
  setGiMode: (v: GIMode) => void;
  setGiIntensity: (v: number) => void;
  setGiSkyColor: (v: string) => void;
  setGiGroundColor: (v: string) => void;
  setLightmapEnabled: (v: boolean) => void;
  setLightProbeEnabled: (v: boolean) => void;
  setLightProbeIntensity: (v: number) => void;
  setPathtracerEnabled: (v: boolean) => void;
  setPathtracerBounces: (v: number) => void;
  /** Path tracer 활성 + 시네마틱 프리셋 적용 — bounces↑, HDR env↑↑, 라스터 ambient/GI 0
   *  (path tracer 가 진짜 GI 를 자체 계산하므로 fake ambient 가 결과를 평탄화함). */
  applyPathtracerCinematicPreset: () => void;
  setEnvironmentPreset: (v: EnvironmentPreset) => void;
  setEnvironmentBackground: (v: boolean) => void;
  setEnvironmentIntensity: (v: number) => void;
  setToneMapping: (v: ToneMappingMode) => void;
  setToneMappingExposure: (v: number) => void;
  setBloomEnabled: (v: boolean) => void;
  setBloomIntensity: (v: number) => void;
  setSsaoEnabled: (v: boolean) => void;
  setSsaoIntensity: (v: number) => void;
  setAoRadius: (v: number) => void;
  setAoDistanceFalloff: (v: number) => void;
  setGtaoEnabled: (v: boolean) => void;
  setGtaoIntensity: (v: number) => void;
  setGtaoRadius: (v: number) => void;
  setGtaoDistanceFalloff: (v: number) => void;
  setGtaoThickness: (v: number) => void;
  setGtaoScale: (v: number) => void;
  setVignetteEnabled: (v: boolean) => void;
  setVignetteIntensity: (v: number) => void;
  setDofEnabled: (v: boolean) => void;
  setDofFocusDistance: (v: number) => void;
  setDofBokehScale: (v: number) => void;

  /** 빛 위치를 sphere + TransformControls 기즈모로 화면에 표시. */
  showLightGizmo: boolean;
  setShowLightGizmo: (v: boolean) => void;

  /** TransformControls 모드 — 이동 vs 회전. */
  lightGizmoMode: 'translate' | 'rotate';
  setLightGizmoMode: (v: 'translate' | 'rotate') => void;

  /** SceneOutliner 에서 선택된 기본 광원 — null 이면 Inspector 안 보임. */
  selectedBuiltin: BuiltinLightKind | null;
  setSelectedBuiltin: (v: BuiltinLightKind | null) => void;

  /** 동적 하늘(drei Sky) + 시간 변화 활성. 켜면 timeOfDay 가 태양 방향/강도/색을 구동. */
  skyEnabled: boolean;
  setSkyEnabled: (v: boolean) => void;
  /** 하루 시간 0~24 (h). 6=일출, 12=정오, 18=일몰, 0/24=자정. 태양 고도/방위/색온도 결정. */
  timeOfDay: number;
  setTimeOfDay: (v: number) => void;

  /** 기본 광원 visibility — 끄면 intensity 0. */
  sunVisible: boolean;
  ambientVisible: boolean;
  hemiVisible: boolean;
  setBuiltinVisible: (kind: BuiltinLightKind, v: boolean) => void;

  reset: () => void;
}

const DEFAULTS = {
  azimuth: 30,
  elevation: 55,
  distance: 18,
  // 햇빛 강도 — 간접광을 줄였으므로 직사광을 강화해 들어오는 곳은 밝게, 안 들어오는 곳은
  // (폐쇄 공간) 어둡게 대비를 줌.
  intensity: 2.5,
  // 전역 균일 ambient — 그림자와 무관하게 모든 mesh 에 들어가므로 0.15 로 낮춰 폐쇄 공간이
  // 자동으로 어두워지게 한다. 사용자가 너무 어두우면 panel 에서 높이면 됨.
  ambientIntensity: 0.15,

  castShadow: true,
  shadowQuality: 'high' as ShadowQuality,
  // 12 = 약 9cm penumbra (mapSize 4096 기준). 6 은 너무 하드해 면도날 그림자.
  shadowSoftness: 12,
  // 폐쇄 공간 어둠 강화 — effectiveAmbient = ambientIntensity * (1 - 0.85*0.7) ≈ 0.06
  shadowStrength: 0.85,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  shadowFrustumSize: 15,
  shadowColor: '#000000',

  // HemisphereLight 도 ambient 와 동일하게 전역 균일 — 디폴트 0.2 로 낮춤. 천창/실외 효과
  // 필요하면 panel 에서 높임.
  giMode: 'hemisphere' as GIMode,
  giIntensity: 0.2,
  giSkyColor: '#e8f0ff',
  giGroundColor: '#b08560',

  // default off — AccumulativeShadows가 spaces 변경 시 reset되며 검은 plane이 일시 노출(자글거림)
  // 또 공간 그리기 중 누적이 매번 무효화되어 화면이 검게 보이는 문제. 사용자가 명시적으로 켤 때만.
  lightmapEnabled: false,

  // LightProbe default off — 카메라 6면 capture는 비용 큼. 사용자가 명시적으로 토글.
  lightProbeEnabled: false,
  lightProbeIntensity: 1.0,
  pathtracerEnabled: false,
  pathtracerBounces: 4,

  environmentPreset: 'apartment' as EnvironmentPreset,
  environmentBackground: false,
  // HDR Environment IBL — 가장 큰 간접광 원천. mesh 의 envMap 으로 들어가 폐쇄/개방 무관 균일.
  // 디폴트 0.3 으로 낮춤. 야외/스튜디오 룩 원하면 panel 에서 높임.
  environmentIntensity: 0.3,

  toneMapping: 'aces' as ToneMappingMode,
  toneMappingExposure: 1.0,

  bloomEnabled: true,
  bloomIntensity: 0.35,

  // N8AO — 모서리/구석 darken. 디폴트 OFF — 강한 intensity 가 화면 검정 plate 처럼 보일 수
  // 있어 사용자가 명시적으로 켜는 게 안전. ssao panel 에서 토글 + 강도 조절.
  ssaoEnabled: false,
  ssaoIntensity: 1.5,
  aoRadius: 0.8,
  aoDistanceFalloff: 0.3,

  // GTAO default off — 사용자가 명시적으로 토글. N8AO와 별개로 동작.
  gtaoEnabled: false,
  // 인테리어 스케일 m 단위 자연 매핑 (panel slider 와 1:1)
  gtaoIntensity: 1.0,
  gtaoRadius: 0.8,          // 80cm AO 반경
  gtaoDistanceFalloff: 10,  // 카메라 10m 너머 fade
  gtaoThickness: 1.0,       // 1m gap threshold
  gtaoScale: 1.0,

  vignetteEnabled: true,
  vignetteIntensity: 0.35,

  dofEnabled: false,
  dofFocusDistance: 8,
  dofBokehScale: 3,

  showLightGizmo: false,
  lightGizmoMode: 'translate' as 'translate' | 'rotate',

  selectedBuiltin: null as BuiltinLightKind | null,
  sunVisible: true,
  ambientVisible: true,
  hemiVisible: true,

  skyEnabled: false,
  timeOfDay: 12,
};

/** dev 모드 진단용으로 store를 window에 노출. */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__lightingStore = useLightingStore; }, 0);
}

export const useLightingStore = create<LightingState>((set) => ({
  ...DEFAULTS,
  setAzimuth: (v) => set({ azimuth: v }),
  setElevation: (v) => set({ elevation: v }),
  setDistance: (v) => set({ distance: v }),
  setIntensity: (v) => set({ intensity: v }),
  setAmbientIntensity: (v) => set({ ambientIntensity: v }),
  setCastShadow: (v) => set({ castShadow: v }),
  setShadowQuality: (v) => set({ shadowQuality: v }),
  setShadowSoftness: (v) => set({ shadowSoftness: v }),
  setShadowStrength: (v) => set({ shadowStrength: v }),
  setShadowBias: (v) => set({ shadowBias: v }),
  setShadowNormalBias: (v) => set({ shadowNormalBias: v }),
  setShadowFrustumSize: (v) => set({ shadowFrustumSize: v }),
  setShadowColor: (v) => set({ shadowColor: v }),
  setGiMode: (v) => set({ giMode: v }),
  setGiIntensity: (v) => set({ giIntensity: v }),
  setGiSkyColor: (v) => set({ giSkyColor: v }),
  setGiGroundColor: (v) => set({ giGroundColor: v }),
  setLightmapEnabled: (v) => set({ lightmapEnabled: v }),
  setLightProbeEnabled: (v) => set({ lightProbeEnabled: v }),
  setLightProbeIntensity: (v) => set({ lightProbeIntensity: v }),
  setPathtracerEnabled: (v) => set({ pathtracerEnabled: v }),
  setPathtracerBounces: (v) => set({ pathtracerBounces: v }),
  applyPathtracerCinematicPreset: () =>
    set({
      giMode: 'path-tracer',
      pathtracerEnabled: true,
      // 라이트맵/LightProbe 와 동시 활성 시 시각 충돌 → 끔
      lightmapEnabled: false,
      // 인테리어는 5 bounce 면 충분 — 8 대비 빠른 수렴 + 노이즈 적음 (bounce 많을수록 분산 ↑).
      pathtracerBounces: 5,
      // HDR env 가 path tracer 의 1차 광원 (창문 빛 시뮬). background 도 켜서 sky 가
      // 폐쇄 공간 외부에서 들어오게.
      environmentIntensity: 1.5,
      environmentBackground: true,
      // raster fallback 시 (카메라 이동/회전 중 첫 몇 sample) 화면이 완전 검정이 되지
      // 않도록 약한 ambient 유지. path tracer 최종 결과에는 영향이 거의 없는 수준.
      ambientIntensity: 0.05,
      giIntensity: 0.05,
      shadowStrength: 1.0,
      // raster fallback 의 그림자도 유지 — 이동 중 형태감이 살아남
      castShadow: true,
    }),
  setEnvironmentPreset: (v) => set({ environmentPreset: v }),
  setEnvironmentBackground: (v) => set({ environmentBackground: v }),
  setEnvironmentIntensity: (v) => set({ environmentIntensity: v }),
  setToneMapping: (v) => set({ toneMapping: v }),
  setToneMappingExposure: (v) => set({ toneMappingExposure: v }),
  setBloomEnabled: (v) => set({ bloomEnabled: v }),
  setBloomIntensity: (v) => set({ bloomIntensity: v }),
  setSsaoEnabled: (v) => set({ ssaoEnabled: v }),
  setSsaoIntensity: (v) => set({ ssaoIntensity: v }),
  setAoRadius: (v) => set({ aoRadius: v }),
  setAoDistanceFalloff: (v) => set({ aoDistanceFalloff: v }),
  setGtaoEnabled: (v) => set({ gtaoEnabled: v }),
  setGtaoIntensity: (v) => set({ gtaoIntensity: v }),
  setGtaoRadius: (v) => set({ gtaoRadius: v }),
  setGtaoDistanceFalloff: (v) => set({ gtaoDistanceFalloff: v }),
  setGtaoThickness: (v) => set({ gtaoThickness: v }),
  setGtaoScale: (v) => set({ gtaoScale: v }),
  setVignetteEnabled: (v) => set({ vignetteEnabled: v }),
  setVignetteIntensity: (v) => set({ vignetteIntensity: v }),
  setDofEnabled: (v) => set({ dofEnabled: v }),
  setDofFocusDistance: (v) => set({ dofFocusDistance: v }),
  setDofBokehScale: (v) => set({ dofBokehScale: v }),
  setShowLightGizmo: (v) => set({ showLightGizmo: v }),
  setLightGizmoMode: (v) => set({ lightGizmoMode: v }),

  setSelectedBuiltin: (v) => set({ selectedBuiltin: v }),
  setSkyEnabled: (v) => set({ skyEnabled: v }),
  setTimeOfDay: (v) => set({ timeOfDay: v }),
  setBuiltinVisible: (kind, v) =>
    set(
      kind === 'sun'
        ? { sunVisible: v }
        : kind === 'ambient'
          ? { ambientVisible: v }
          : { hemiVisible: v },
    ),
  reset: () => set(DEFAULTS),
}));

/**
 * 구면 좌표(azimuth/elevation/distance) → 카르테시안 (x, y, z) 변환.
 * Three.js 표준 (right-handed, Y up, +Z = "북") 좌표계.
 */
export function sphericalToCartesian(
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const y = distance * Math.sin(el);
  const r = distance * Math.cos(el);
  const x = r * Math.sin(az);
  const z = r * Math.cos(az);
  return [x, y, z];
}

/** 그림자 품질 → shadow-mapSize 매핑. */
export function shadowMapSizeFor(quality: ShadowQuality): number {
  switch (quality) {
    case 'low': return 1024;
    case 'medium': return 2048;
    case 'high': return 4096;
    case 'ultra': return 8192;
  }
}