/**
 * HomePlanner3 도메인 수학 상수 + 단위 변환 + 기본 유틸리티.
 *
 * Unity `Utils.Math` 클래스 (2939 LOC)의 일부 — 본 파일에는 **상수·단위 변환·스칼라 헬퍼**만 둔다.
 * 2D/3D 기하 함수(Cross, IsCCW, FindAngle 등)는 {@link ./Geometry} 모듈로 분리.
 */

// ============================================================
// 상수
// ============================================================

/**
 * 위치 동일성 판정에 사용하는 부동소수점 허용 오차.
 * Unity `Utils.Math.EPSILON = 0.00001f` 와 동일 (1e-5).
 *
 * `Node.create`에서 같은 좌표의 노드를 중복 생성하지 않게 막는 등 도메인 전반의 위치 비교에 쓰인다.
 */
export const EPSILON = 1e-5;

/**
 * 도메인에서 사용하는 "사실상 무한" 큰 수. 무한선 교차 계산 등에서 선분 끝점 후보로 사용.
 * Unity `Utils.Math.INFINITY = 100000f`.
 */
export const INFINITY = 100000;

/**
 * 일반 거리 계산에서 사용하는 작은 마진(m). Unity `Utils.Math.margin = 0.001f`.
 */
export const MARGIN = 0.001;

/**
 * 두 벡터가 거의 평행한지(또는 같은 방향인지) 판단할 때 쓰는 코사인 임계값.
 * Unity `Utils.Math.angleLimit = Mathf.Cos(2.0f * Mathf.Deg2Rad)`.
 */
export const ANGLE_LIMIT = Math.cos((2 * Math.PI) / 180);

/**
 * 두 벡터가 거의 직각인지 판단할 때 쓰는 코사인 임계값.
 * Unity `Utils.Math.rightAngleLimit = Mathf.Cos(89.0f * Mathf.Deg2Rad)`.
 */
export const RIGHT_ANGLE_LIMIT = Math.cos((89 * Math.PI) / 180);

/**
 * Unity `Mathf.Epsilon` 대응 — `float.Epsilon`(1.4e-45) 의미를 가지지만 JS에는
 * 동일한 값이 없으므로 `Number.EPSILON`(≈2.22e-16)을 사용한다. 둘 다 "기계적으로
 * 표현 가능한 가장 작은 의미 있는 차이"라는 역할은 같다.
 */
export const MATHF_EPSILON = Number.EPSILON;

// ============================================================
// 단위 변환 — Unity Utils.Math.MMToM 등
// ============================================================

/** 밀리미터 → 미터. */
export function mmToM(mm: number): number {
  return mm * 0.001;
}

/** 미터 → 밀리미터 (정수 반올림, Unity의 +0.1f 자리수 보정 포함). */
export function mToMM(m: number): number {
  return Math.floor(m * 1000 + 0.1);
}

/** 센티미터 → 미터. */
export function cmToM(cm: number): number {
  return cm * 0.01;
}

/** 미터 → 센티미터 (정수 반올림). */
export function mToCM(m: number): number {
  return Math.floor(m * 100 + 0.1);
}

/** 밀리미터 → 센티미터. */
export function mmToCM(mm: number): number {
  return mm * 0.01;
}

/** 센티미터 → 밀리미터 (정수 반올림). */
export function cmToMM(cm: number): number {
  return Math.floor(cm * 10 + 0.1);
}

// ============================================================
// 기본 스칼라 헬퍼
// ============================================================

/**
 * 두 부동소수점 수가 거의 같은지 판정한다.
 *
 * @param a 비교 값 1
 * @param b 비교 값 2
 * @param epsilon 허용 오차 (기본값 {@link EPSILON})
 */
export function approximately(a: number, b: number, epsilon: number = EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}

/**
 * 값을 `[min, max]` 범위로 잘라낸다. Unity `Mathf.Clamp` 대응.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 두 값 사이의 선형 보간. Unity `Mathf.Lerp` 대응.
 *
 * @param t 0~1 사이의 보간 파라미터 (범위 외 값도 허용)
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 도 단위 각도를 라디안으로 변환한다. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 라디안 단위 각도를 도로 변환한다. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * 부동소수점 값을 지정 자릿수 배율로 반올림한다.
 * Unity `Utils.Math.Truncate(value, digit)` 대응 — `Mathf.Round(value * digit) / digit`.
 *
 * @example
 * truncate(3.14159, 100) // => 3.14   (소수 둘째자리까지)
 * truncate(123.456, 10)  // => 123.5  (소수 첫째자리까지)
 */
export function truncate(value: number, digit: number): number {
  return Math.round(value * digit) / digit;
}

/**
 * Unity `Mathf.Sign` 대응. 입력이 0 이상이면 +1, 음수면 -1. (0의 경우 +1 반환)
 */
export function mathfSign(value: number): number {
  return value >= 0 ? 1 : -1;
}

/**
 * 2D OBB(방향 경계 상자) 또는 폴리곤의 한 축 투영 구간이 다른 구간과 겹치는지 판정.
 * Unity `Utils.Math.ProjectionAxisOverlapped`. SAT(분리축 정리) 충돌 판정의 1단계.
 *
 * @returns 두 구간 `[min1,max1]`, `[min2,max2]`가 겹치면 true
 */
export function projectionAxisOverlapped(
  min1: number,
  max1: number,
  min2: number,
  max2: number,
): boolean {
  if (max1 < min2) return false;
  if (max2 < min1) return false;
  return true;
}