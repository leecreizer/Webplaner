import { useEffect, useMemo } from 'react';
import { Sky } from '@react-three/drei';
import { Vector3 } from 'three';
import { useLightingStore, sphericalToCartesian } from '@/engine/stores/lightingStore';

/**
 * 동적 하늘 + 시간 변화 (time-of-day).
 *
 * `skyEnabled` 일 때 drei `<Sky>`(Preetham 대기 산란)를 렌더하고, `timeOfDay`(0~24h)로부터
 * 태양의 고도/방위/강도/색온도를 계산해:
 *  1. `<Sky>` 의 sunPosition (하늘 그라데이션 — 낮/노을/밤)
 *  2. lightingStore 의 azimuth/elevation/intensity/색 (실제 DirectionalLight + PT sun proxy)
 * 둘 다 갱신한다. → 시간 슬라이더 하나로 햇빛 방향과 하늘이 동시에 움직인다.
 *
 * 시간 매핑:
 *  - 6h 일출(고도 0°, 동쪽) → 12h 정오(고도 ~70°, 남중) → 18h 일몰(고도 0°, 서쪽)
 *  - 18~6h 밤: 고도 음수 → 햇빛 강도 0, 하늘 어두움
 *  - 색: 일출/일몰 warm(주황), 정오 white
 */
export function DynamicSky() {
  const enabled = useLightingStore((s) => s.skyEnabled);
  const time = useLightingStore((s) => s.timeOfDay);

  // 시간 → 태양 구면좌표 + 강도/색
  const sun = useMemo(() => {
    // dayProgress: 6h→0, 12h→0.5, 18h→1 (낮 구간). 그 외는 밤.
    const dayT = (time - 6) / 12; // 0..1 during day
    const isDay = time >= 6 && time <= 18;
    // 고도: sin 곡선 (일출 0 → 정오 70 → 일몰 0)
    const elevation = isDay ? Math.sin(dayT * Math.PI) * 70 : -10;
    // 방위: 동(90°) → 남(180°) → 서(270°)
    const azimuth = 90 + dayT * 180;
    // 강도: 낮 sin, 정오 최대. 새벽/황혼 낮음, 밤 0.
    const intensity = isDay ? Math.max(0, Math.sin(dayT * Math.PI)) * 3.0 : 0;
    // 색온도: 고도 낮을수록 warm(주황), 높을수록 white. t=0(지평)~1(천정)
    const highness = Math.max(0, Math.min(1, elevation / 50));
    const r = 1.0;
    const g = 0.6 + 0.4 * highness;
    const b = 0.35 + 0.65 * highness;
    const color = `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
    return { elevation, azimuth, intensity, color };
  }, [time]);

  // sky sunPosition (방향 벡터) — distance 1 정규화
  const sunPosition = useMemo<[number, number, number]>(
    () => sphericalToCartesian(sun.azimuth, sun.elevation, 1),
    [sun.azimuth, sun.elevation],
  );

  // 실제 광원(store)에 반영 — sky 활성 시 시간이 azimuth/elevation/intensity/색을 구동.
  useEffect(() => {
    if (!enabled) return;
    const s = useLightingStore.getState();
    s.setAzimuth(sun.azimuth);
    s.setElevation(Math.max(1, sun.elevation)); // 지평 아래로는 안 내려 그림자 frustum 유지
    s.setIntensity(sun.intensity);
    s.setShadowColor('#000000');
    // 밤이면 태양 끔
    s.setBuiltinVisible('sun', sun.intensity > 0.01);
  }, [enabled, sun]);

  if (!enabled) return null;

  return (
    <Sky
      distance={450000}
      sunPosition={sunPosition}
      // 대기 산란 파라미터 — 일몰 때 더 붉게 (낮은 고도 = 높은 turbidity 느낌)
      turbidity={10}
      rayleigh={sun.elevation < 10 ? 3 : 1}
      mieCoefficient={0.005}
      mieDirectionalG={0.8}
    />
  );
}

// Vector3 import 보존 (sunPosition 계산 외 확장 대비)
void Vector3;