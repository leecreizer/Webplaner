import { Vector2 } from 'three';

/**
 * 두 선분의 정밀 교차 판정.
 *
 * Unity `Utils.LineSegmentIntersection` 1:1 포팅.
 *
 * 본 함수는 다음 케이스를 모두 구분한다:
 * - 일반 교차 (선분 내부에서 한 점 교차)
 * - 끝점 일치 (부동소수점 오차 우회)
 * - 평행
 * - 일치 직선(collinear), 겹침 구간이 있는 경우
 * - 두 선분이 완전히 동일한 경우 (방향 무관)
 *
 * Wall 생성/분할 알고리즘이 의존하므로 정확도가 중요하다.
 */

/** 두 선분 교차 결과. */
export interface IntersectionResult {
  /** 두 선분이 실제로 교차하는지(또는 일치 구간이 있는지). */
  intersects: boolean;
  /** 교차점 좌표 (Overlap일 때는 겹침 구간의 한 끝점). */
  point: Vector2;
  /** 선분 AB에서 A로부터의 비율 (0~1 선분 내부, 범위 밖이면 연장선). */
  t: number;
  /** 선분 CD에서 C로부터의 비율. */
  u: number;
  /** A에서 교차점까지의 거리(m). */
  distanceFromA: number;
  /** C에서 교차점까지의 거리(m). */
  distanceFromC: number;
  /** 두 선분이 평행하거나 일치 직선 위에 있는지. */
  isParallel: boolean;
  /** 두 선분이 같은 직선 위에 있는지 (`isParallel`의 부분 집합). */
  isCollinear: boolean;
  /** Collinear 상태에서 두 선분이 구간으로 겹치는지. */
  isOverlap: boolean;
  /** 겹침 구간의 두 번째 끝점 (isOverlap=true일 때만 유효, `point`가 첫 번째). */
  overlapEnd: Vector2;
  /** 두 선분이 방향 무관 완전 일치하는지. */
  isSameSegment: boolean;
}

function cross(v1: Vector2, v2: Vector2): number {
  return v1.x * v2.y - v1.y * v2.x;
}

function approxEqual(a: Vector2, b: Vector2, epsilon: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy < epsilon * epsilon;
}

function snapToUnit(value: number, epsilon: number): number {
  if (Math.abs(value) < epsilon) return 0;
  if (Math.abs(value - 1) < epsilon) return 1;
  return value;
}

function emptyResult(): IntersectionResult {
  return {
    intersects: false,
    point: new Vector2(),
    t: 0,
    u: 0,
    distanceFromA: 0,
    distanceFromC: 0,
    isParallel: false,
    isCollinear: false,
    isOverlap: false,
    overlapEnd: new Vector2(),
    isSameSegment: false,
  };
}

function endpointResult(
  point: Vector2,
  t: number,
  u: number,
  a: Vector2,
  b: Vector2,
  c: Vector2,
  d: Vector2,
): IntersectionResult {
  return {
    intersects: true,
    point: point.clone(),
    t,
    u,
    distanceFromA: t * b.clone().sub(a).length(),
    distanceFromC: u * d.clone().sub(c).length(),
    isParallel: false,
    isCollinear: false,
    isOverlap: false,
    overlapEnd: new Vector2(),
    isSameSegment: false,
  };
}

/**
 * Collinear 상태에서 각 끝점이 상대 선분 위에 있는지 확인하여 겹침 구간을 반환한다.
 * 끝점 `{A, B, C, D}` 중 상대 선분 위에 있는 점들이 겹침 구간의 끝점.
 */
function resolveCollinearOverlap(
  result: IntersectionResult,
  a: Vector2,
  b: Vector2,
  c: Vector2,
  d: Vector2,
  ab: Vector2,
  cd: Vector2,
  epsilon: number,
): IntersectionResult {
  const abSqLen = ab.lengthSq();
  const cdSqLen = cd.lengthSq();

  let tC = abSqLen > epsilon ? c.clone().sub(a).dot(ab) / abSqLen : 0;
  let tD = abSqLen > epsilon ? d.clone().sub(a).dot(ab) / abSqLen : 0;
  let uA = cdSqLen > epsilon ? a.clone().sub(c).dot(cd) / cdSqLen : 0;
  let uB = cdSqLen > epsilon ? b.clone().sub(c).dot(cd) / cdSqLen : 0;

  tC = snapToUnit(tC, epsilon);
  tD = snapToUnit(tD, epsilon);
  uA = snapToUnit(uA, epsilon);
  uB = snapToUnit(uB, epsilon);

  const pts: Vector2[] = [];
  const ts: number[] = [];
  const us: number[] = [];
  let count = 0;

  const tryAdd = (pt: Vector2, t: number, u: number) => {
    for (let i = 0; i < count; i++) {
      if (Math.abs(ts[i] - t) < epsilon) return; // 중복 제거
    }
    pts.push(pt);
    ts.push(t);
    us.push(u);
    count++;
  };

  if (tC >= 0 && tC <= 1) tryAdd(c, tC, 0); // C가 AB 위 (C는 CD의 u=0)
  if (tD >= 0 && tD <= 1) tryAdd(d, tD, 1); // D가 AB 위 (D는 CD의 u=1)
  if (uA >= 0 && uA <= 1) tryAdd(a, 0, uA); // A가 CD 위 (A는 AB의 t=0)
  if (uB >= 0 && uB <= 1) tryAdd(b, 1, uB); // B가 CD 위 (B는 AB의 t=1)

  if (count === 0) return result;

  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < count; i++) {
    if (ts[i] < ts[minIdx]) minIdx = i;
    if (ts[i] > ts[maxIdx]) maxIdx = i;
  }

  result.intersects = true;
  result.point = pts[minIdx].clone();
  result.t = ts[minIdx];
  result.u = us[minIdx];
  result.distanceFromA = ts[minIdx] * ab.length();
  result.distanceFromC = us[minIdx] * cd.length();

  if (count >= 2) {
    result.isOverlap = true;
    result.overlapEnd = pts[maxIdx].clone();

    // 완전 동일 판정:
    //   AB 전체 겹침: minIdx.t == 0, maxIdx.t == 1
    //   CD 전체 겹침: (minIdx.u == 0, maxIdx.u == 1) 또는 방향 반대
    const coversAB =
      Math.abs(ts[minIdx]) < epsilon && Math.abs(ts[maxIdx] - 1) < epsilon;
    const coversCD =
      (Math.abs(us[minIdx]) < epsilon && Math.abs(us[maxIdx] - 1) < epsilon) ||
      (Math.abs(us[minIdx] - 1) < epsilon && Math.abs(us[maxIdx]) < epsilon);
    result.isSameSegment = coversAB && coversCD;
  }

  return result;
}

/**
 * 두 선분 AB와 CD의 교차점을 정밀하게 구한다.
 *
 * @param a 선분 AB의 시작점
 * @param b 선분 AB의 끝점
 * @param c 선분 CD의 시작점
 * @param d 선분 CD의 끝점
 * @param epsilon 부동소수점 허용 오차 (기본 1e-5)
 */
export function getLineSegmentIntersection(
  a: Vector2,
  b: Vector2,
  c: Vector2,
  d: Vector2,
  epsilon: number = 1e-5,
): IntersectionResult {
  let result = emptyResult();

  const ab = b.clone().sub(a);
  const cd = d.clone().sub(c);
  const ac = c.clone().sub(a);

  const denom = cross(ab, cd);
  const crossAC_CD = cross(ac, cd);
  const crossAC_AB = cross(ac, ab);

  // 1단계: 평행/일치 판정 — 겹침을 끝점 검사보다 먼저 처리해야 AB=CD가 완전 겹치는 케이스가 잡힘
  if (Math.abs(denom) < epsilon) {
    result.isParallel = true;
    result.isCollinear = Math.abs(crossAC_CD) < epsilon;
    result.intersects = false;
    if (result.isCollinear) {
      result = resolveCollinearOverlap(result, a, b, c, d, ab, cd, epsilon);
    }
    return result;
  }

  // 2단계: 끝점 직접 일치 검사 (비평행일 때만 — 부동소수점 오차 완전 우회)
  if (approxEqual(a, c, epsilon)) return endpointResult(a, 0, 0, a, b, c, d);
  if (approxEqual(a, d, epsilon)) return endpointResult(a, 0, 1, a, b, c, d);
  if (approxEqual(b, c, epsilon)) return endpointResult(b, 1, 0, a, b, c, d);
  if (approxEqual(b, d, epsilon)) return endpointResult(b, 1, 1, a, b, c, d);

  let t = crossAC_CD / denom;
  let u = crossAC_AB / denom;

  // 3단계: t, u를 0/1로 스냅
  t = snapToUnit(t, epsilon);
  u = snapToUnit(u, epsilon);

  result.t = t;
  result.u = u;
  result.intersects = t >= 0 && t <= 1 && u >= 0 && u <= 1;
  result.point = a.clone().add(ab.clone().multiplyScalar(t));
  result.distanceFromA = t * ab.length();
  result.distanceFromC = u * cd.length();
  return result;
}