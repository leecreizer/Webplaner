import { Color, Vector3 } from 'three';
import { useHomvueStore } from './homvueStore';
import { fetchEnvironment, type HomvueEnvironment } from './homvueAssets';
import { ueTransformToMatrix } from './ueTransform';
import { kelvinToColor } from './HomvueLights';
import { useLightingStore, type ToneMappingMode } from '@/engine/stores/lightingStore';
import { useMutracerStore } from '@/engine/stores/mutracerStore';

/**
 * Homvue 평면을 열면 그 평면의 언리얼 노출·해·후처리를 조명·렌더 설정에 넣는다(닫으면 원래대로).
 *
 * 웹 조명 단위(three 물리 단위 — 칸델라·lux·nit)는 언리얼과 같다. 그래서 언리얼 화면과 맞추려면 조명은 언리얼 값 그대로,
 * **노출만 언리얼 수동 노출로** 곱하면 된다(화면 값 = 휘도 × 2^보정 / (1.2 × 2^EV100), tools/build_env.py).
 * 예전엔 노출 대신 「실내 조명 배율 ×3」으로 실내 조명만 키워 맞췄다 — 43 의 언리얼 노출이 ×2.7 이라 비슷해 보였지만
 * 해·하늘은 그 배율을 받지 않아 평면마다 밝기 균형이 달랐다(84A 노출은 ×0.89).
 * - 해: 언리얼 DirectionalLight 방향·세기(lux)·색온도
 * - 화면: 톤매핑 ACES(언리얼 필믹과 같은 계열), 비네팅·블룸(언리얼 기본·평면 값을 경로 추적 식에 맞게 줄임)
 * - 옮기지 않는 것: Lumen 간접광 배율(43·59A·59C 는 ×10) — 경로 추적은 간접광을 물리로 계산한다.
 *   74A·84A 의 SkyLight 추가분(하늘빛 2배) — 경로 추적 환경광엔 세기 값이 없다
 */

/** 경로 추적 비네팅은 가장자리를 언리얼보다 세게 누른다(모서리에서 거의 1배) — 언리얼 값의 0.6 */
const VIGNETTE_SCALE = 0.6;
/** 언리얼 블룸은 모든 화소가 번지는 식(문턱 −1) — 경로 추적은 밝은 곳(1 넘는 곳)만 번지게, 세기는 0.2 배 */
const BLOOM_SCALE = 0.2;

type Saved = {
  lighting: { azimuth: number; elevation: number; intensity: number; sunColor: string; toneMapping: ToneMappingMode; toneMappingExposure: number };
  mt: { vignette: number; bloomIntensity: number; bloomThreshold: number; temperature: number };
  lightScale: number;
};
let saved: Saved | null = null;
let applying = 0;

/** 해 방향(빛이 나아가는 쪽 = 언리얼 +X) → 조명 패널의 방위각·고도 */
export function sunAngles(rotationDeg: [number, number, number]): { azimuth: number; elevation: number } {
  const dir = new Vector3(1, 0, 0).transformDirection(ueTransformToMatrix([0, 0, 0], rotationDeg));
  const toSun = dir.negate();
  const elevation = (Math.asin(Math.max(-1, Math.min(1, toSun.y))) * 180) / Math.PI;
  const azimuth = (Math.atan2(toSun.x, toSun.z) * 180) / Math.PI;
  return { azimuth: Math.round(azimuth * 10) / 10, elevation: Math.round(Math.max(2, elevation) * 10) / 10 };
}

export function applyHomvueEnvironment(env: HomvueEnvironment) {
  const l = useLightingStore.getState();
  const m = useMutracerStore.getState();
  const h = useHomvueStore.getState();
  if (!saved) {
    saved = {
      lighting: { azimuth: l.azimuth, elevation: l.elevation, intensity: l.intensity, sunColor: l.sunColor, toneMapping: l.toneMapping, toneMappingExposure: l.toneMappingExposure },
      mt: { vignette: m.mt.vignette, bloomIntensity: m.mt.bloomIntensity, bloomThreshold: m.mt.bloomThreshold, temperature: m.mt.temperature },
      lightScale: h.lightScale,
    };
  }
  l.setToneMapping('aces');
  l.setToneMappingExposure(env.exposure.scale);
  if (env.sun) {
    l.setIntensity(env.sun.lux);
    const c = env.sun.temperature ? kelvinToColor(env.sun.temperature) : null;
    if (env.sun.color && c) c.multiply(new Color(env.sun.color[0] / 255, env.sun.color[1] / 255, env.sun.color[2] / 255));
    l.setSunColor(c ? `#${c.getHexString()}` : '#ffffff');
    if (env.sun.rotation_deg) {
      const a = sunAngles(env.sun.rotation_deg);
      l.setAzimuth(a.azimuth);
      l.setElevation(a.elevation);
    }
  }
  m.setMt({
    vignette: +(env.post.vignette * VIGNETTE_SCALE).toFixed(3),
    bloomIntensity: +(env.post.bloom * BLOOM_SCALE).toFixed(3),
    bloomThreshold: 1,
    temperature: 0, // 언리얼 화이트밸런스 6500K = 보정 없음
  });
  // 실내 조명은 언리얼 값 그대로(×1) — 노출이 밝기를 맞춘다
  h.setLightScale(1);
}

export function restoreEnvironment() {
  if (!saved) return;
  const l = useLightingStore.getState();
  l.setAzimuth(saved.lighting.azimuth);
  l.setElevation(saved.lighting.elevation);
  l.setIntensity(saved.lighting.intensity);
  l.setSunColor(saved.lighting.sunColor);
  l.setToneMapping(saved.lighting.toneMapping);
  l.setToneMappingExposure(saved.lighting.toneMappingExposure);
  useMutracerStore.getState().setMt(saved.mt);
  useHomvueStore.getState().setLightScale(saved.lightScale);
  saved = null;
}

// 평면이 바뀔 때마다 — 열면 그 평면 설정, 닫으면 원래대로
useHomvueStore.subscribe((s, p) => {
  if (s.plan === p.plan) return;
  const run = ++applying;
  if (!s.plan) {
    restoreEnvironment();
    return;
  }
  void fetchEnvironment(s.plan.base.level).then((env) => {
    if (run !== applying || !env) return; // 그새 다른 평면을 열었거나 설정 파일이 없음
    applyHomvueEnvironment(env);
  });
});
