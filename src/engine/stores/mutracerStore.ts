import { create } from 'zustand';

/**
 * 경로 추적(MuTracer · WebGPU 우선) 설정 — 조명·렌더 패널 「경로 추적 (WebGPU)」.
 * 엔진을 다시 만들지 않고 실행 중에 바로 반영된다(MutracerRenderer 가 구독). 예외: `hybrid` 는 렌더 루프를 다시 만든다.
 * 반사 횟수(pathtracerBounces)·렌더 해상도 배율(mutracerRenderScale)·노출·톤매핑은 lightingStore 에 있다.
 */
export type MtSamplingPattern = 'sobol' | 'zsobol' | 'random';
export type MtDenoiser = 'oidn' | 'jnlm' | 'none';
export type MtOidnModel = 'small' | 'standard' | 'cleanAuxLarge';
export type MtDenoiseSchedule = 'every-sample' | 'progressive' | 'converged';
export type MtAlphaBlend = 'stochastic' | 'deterministic-source-over';
export type MtBvhBuilder = 'builtin' | 'tinybvh';
export type MtBvhLayout = 'bvh2' | 'bvh4' | 'bvh-gpu' | 'cwbvh';
export type MtChannel = 'final' | 'albedo' | 'normal' | 'shadow';

export interface MtSettings {
  // ===== 샘플링 =====
  /** 멈춰 있을 때 쌓을 최대 샘플 수 — 다 쌓이면 그래픽 카드를 쉰다 */
  maxSamples: number;
  /** 샘플 순서 — sobol(기본, 고르게) · zsobol(화면 영역별 상관 줄임) · random */
  samplingPattern: MtSamplingPattern;
  /** 한 지점에서 고르는 조명 후보 수(WebGPU) — 조명이 많은 장면에서 늘리면 잡티 감소, 느려짐 */
  directLightCandidates: number;
  /** 밝기 제한(0 = 끔) — 반짝이는 점(파이어플라이)을 잘라 낸다. 너무 낮으면 하이라이트가 죽는다 */
  clamping: number;
  /** 유리 등 반투명 처리 — stochastic(기본, 정확) · deterministic-source-over(겹침 순서대로, 잡티 적음) */
  alphaBlendStrategy: MtAlphaBlend;
  /** 분산(빛 갈라짐) 파장 수 — 3(정확) · 1(빠름) */
  dispersionWavelengths: 1 | 3;
  /** 재질 모서리 둥글게(쉐이더 베벨) */
  bevel: boolean;
  bevelSamples: number;

  // ===== 성능 =====
  /** 프레임당 그래픽 카드 시간(ms) — 크면 빨리 수렴, 작으면 다시 움직일 때 반응이 빠르다 */
  timeBudgetMs: number;
  /** 한 프레임에 샘플 여러 개 — 켜면 수렴이 빠르지만 움직이기 시작할 때 멈칫할 수 있다 */
  multiSamplesPerFrame: boolean;
  /** 재질 텍스처 예산(MiB) — 넘으면 텍스처를 줄인다(진단의 아틀라스 배율) */
  textureBudgetMiB: number;
  /** 형상 가속 구조 만드는 방식 */
  bvhBuilder: MtBvhBuilder;
  bvhLayout: MtBvhLayout;

  // ===== 디노이즈 =====
  denoiser: MtDenoiser;
  /** OIDN 모델(WebGPU) — small(빠름) · standard · cleanAuxLarge(가장 깨끗, 가중치 내려받기) */
  oidnModel: MtOidnModel;
  /** 언제 정리하나 — 매 샘플 · 1·2·4·8… 샘플마다 · 다 쌓인 뒤 한 번 */
  denoiseSchedule: MtDenoiseSchedule;

  /** 유리 굴절·커스틱(느림) — 켜면 두께 있는 유리 소품이 굴절 유리(창·판유리는 늘 반투명). 기본 끔 */
  glassRefraction: boolean;
  /** 커스틱 — 유리를 지나 모인 빛을 바닥·벽에 더한다(광자 추적, 래스터·경로 추적 공통). 기본 켬 */
  causticShadows: boolean;
  /** 커스틱 광자 총수 — 많을수록 무늬가 또렷하고 계산이 길다 */
  causticPhotons: number;
  /** 커스틱 번짐(칸) — 광자 잡티를 펴는 정도 */
  causticBlur: number;
  /** 커스틱 세기 배율 — 1 이 물리값 */
  causticStrength: number;

  // ===== 화면 표시 (경로 추적 화면에만) =====
  contrast: number;
  saturation: number;
  /** 색온도 -1(차갑게) ~ 1(따뜻하게) */
  temperature: number;
  /** 초록 -1 ~ 자홍 1 */
  tint: number;
  vignette: number;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  /** 확장 범위(HDR) 모니터 출력(WebGPU) */
  hdrOutput: boolean;
  /** 진단 화면 — 최종 · 바탕색(albedo) · 법선 · 그림자 */
  channel: MtChannel;

  // ===== 움직임과 전환 (하이브리드) =====
  /**
   * 켜면 움직이는 동안 래스터(간접광 없음), 멈추면 경로 추적.
   * 끄면 움직이는 동안에도 저해상도 경로 추적 미리보기 — GI 는 유지되지만 1샘플이라 화면이 잡티투성이였다(실측,
   * OIDN 도 매 프레임 카메라가 바뀌어 따라오지 못함). 사용자 결정(2026-10-22): 움직일 때 래스터로 바뀌면 GI 모드가
   * 바뀐 것처럼 보여 경로 추적을 계속 유지한다 — 기본 끔.
   */
  hybrid: boolean;
  /** 카메라가 이만큼(ms) 멈춰 있으면 경로 추적 시작 */
  stillMs: number;
  /** 경로 추적 화면으로 넘어가기 전 쌓을 샘플 수 */
  readySamples: number;
  /** 래스터 → 경로 추적 겹쳐 바꾸는 시간(ms), 0 = 바로 */
  fadeMs: number;
}

export const MT_DEFAULTS: MtSettings = {
  maxSamples: 256,
  samplingPattern: 'sobol',
  directLightCandidates: 4,
  clamping: 0,
  alphaBlendStrategy: 'stochastic',
  dispersionWavelengths: 3,
  bevel: true,
  bevelSamples: 8,

  timeBudgetMs: 33,
  multiSamplesPerFrame: false,
  textureBudgetMiB: 1536,
  // tinybvh — 추적 속도는 같고 가속 구조 만들기가 약 40% 빠르다(Homvue 59C 형상 864개: 4.9~6.0초 → 3.4초, 2026-10-22 실측).
  // 평면 열기·공간 바꾸기·새 형상마다 이 시간만큼 래스터로 기다린다
  bvhBuilder: 'tinybvh',
  bvhLayout: 'bvh2',

  denoiser: 'oidn',
  oidnModel: 'standard',
  denoiseSchedule: 'progressive',
  glassRefraction: false,
  causticShadows: true,
  causticPhotons: 400000,
  causticBlur: 2,
  causticStrength: 1,

  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
  bloomIntensity: 0,
  bloomThreshold: 1,
  bloomRadius: 0.6,
  hdrOutput: false,
  channel: 'final',

  // 기본 끔 — 움직이는 동안에도 경로 추적 미리보기(래스터로 바뀌면 GI 가 꺼진 것처럼 보였다, 사용자 요청 2026-10-22)
  hybrid: false,
  stillMs: 350,
  // 잔상 없이 — 디노이즈까지 된 그림(1·2·4·8… 정리 시점의 4 → 5샘플째)이 나온 다음에 한 번에 바꾼다(실측 3초·이후 변화 6/255).
  // 2샘플 + 0.3초 겹쳐 바꾸기는 겹친 두 그림이 잔상처럼 보이고 뭉갠 그림이 점점 또렷해져 보였다(사용자 보고)
  readySamples: 5,
  fadeMs: 0,
};

interface MutracerState {
  mt: MtSettings;
  setMt: (patch: Partial<MtSettings>) => void;
  resetMt: () => void;
}

export const useMutracerStore = create<MutracerState>((set) => ({
  mt: MT_DEFAULTS,
  setMt: (patch) => set((s) => ({ mt: { ...s.mt, ...patch } })),
  resetMt: () => set({ mt: MT_DEFAULTS }),
}));

// 화면 시험용 — 설정을 바꿔 가며 성능을 잰다
if (typeof window !== 'undefined') (window as unknown as { __mutracerStore?: unknown }).__mutracerStore = useMutracerStore;
