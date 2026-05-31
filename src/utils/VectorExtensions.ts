import { Vector3 } from 'three';

/**
 * Three.js `Vector3`에 대한 도메인 헬퍼.
 *
 * Unity `Utils.Vector3Extensions` 정적 확장 메서드를 일반 함수로 옮겼다.
 * TypeScript는 C# 확장 메서드 같은 문법이 없으므로 호출 형태가 다르다:
 *
 * - Unity: `a.FlatSqrDistance(b)`
 * - TS:    `flatSqrDistance(a, b)`
 */

/**
 * Y축(높이)을 무시한 XZ 평면상의 두 점 사이 거리 제곱.
 *
 * 평면도(2D top-view) 상의 거리 비교에서 `Math.sqrt`를 피해 성능 이득을 얻기 위해 사용한다.
 *
 * @param a 점 1
 * @param b 점 2
 */
export function flatSqrDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * Y축(높이)을 무시한 XZ 평면상의 두 점 사이 거리.
 */
export function flatDistance(a: Vector3, b: Vector3): number {
  return Math.sqrt(flatSqrDistance(a, b));
}

/**
 * 두 Vector3가 EPSILON 이내로 동일한지 판정한다.
 *
 * @param epsilon 허용 오차 (기본값 1e-4)
 */
export function vectorsEqual(a: Vector3, b: Vector3, epsilon = 1e-4): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.z - b.z) < epsilon
  );
}