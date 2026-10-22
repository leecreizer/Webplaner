import { describe, expect, it } from 'vitest';
import { sunAngles } from './homvueEnvironment';

describe('sunAngles', () => {
  it('언리얼 해 회전의 피치(아래로 기운 각) = 고도', () => {
    // 43 평면 DirectionalLight [Roll, Pitch, Yaw]
    expect(sunAngles([37.9973, -11.3769, -86.542]).elevation).toBeCloseTo(11.4, 0);
    // 84A
    expect(sunAngles([-6.7587, -31.7477, -93.2307]).elevation).toBeCloseTo(31.7, 0);
  });
  it('해가 지평선 아래면 2° 로 올린다', () => {
    expect(sunAngles([0, 10, 0]).elevation).toBe(2);
  });
});
