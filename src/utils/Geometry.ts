import { Vector2, Vector3, Vector4, Quaternion } from 'three';
import { EPSILON, INFINITY, degToRad, radToDeg, mathfSign } from './Math';

/**
 * HomePlanner3 도메인 2D/3D 기하 함수 모음.
 *
 * Unity `Utils.Math` 클래스의 기하 함수(2D 폴리곤·교차·각도·평면·박스 등)를 옮겼다.
 * 단위는 모두 미터(m), 각도는 별도 명시 없으면 도(°). Unity와 동일하게 좌수좌표(왼손).
 */

// ============================================================
// 자료구조
// ============================================================

/**
 * 3D 평면 구조체 (위치 + 회전 + XZ 범위).
 * Unity `Math.Plane` 구조체 대응.
 */
export interface Plane3D {
  pos: Vector3;
  rot: Quaternion;
  extents: Vector2;
}

/**
 * 2D 평면 구조체 (위치 + 법선 + 길이).
 * Unity `Math.Plane2D` 구조체 대응.
 */
export interface Plane2D {
  pos: Vector2;
  nor: Vector2;
  len: number;
}

/**
 * 3D OBB(방향 경계 상자) 구조체 (위치 + 회전 + 반크기).
 * Unity `Math.Box` 구조체 대응.
 */
export interface Box {
  position: Vector3;
  rotation: Quaternion;
  extents: Vector3;
}

/**
 * 2D Rect (Unity `UnityEngine.Rect` 대응). x/y는 좌하단 기준.
 *
 * Three.js에 표준 Rect 타입이 없어 직접 정의한다. `QuadTree` 등에서 사용.
 */
export interface Rect {
  /** 좌측 X (xMin). */
  x: number;
  /** 하단 Y (yMin). */
  y: number;
  /** 폭. */
  width: number;
  /** 높이. */
  height: number;
}

/** Rect의 xMin (= x). */
export function rectXMin(r: Rect): number {
  return r.x;
}
/** Rect의 xMax. */
export function rectXMax(r: Rect): number {
  return r.x + r.width;
}
/** Rect의 yMin (= y). */
export function rectYMin(r: Rect): number {
  return r.y;
}
/** Rect의 yMax. */
export function rectYMax(r: Rect): number {
  return r.y + r.height;
}

/** 두 Rect가 겹치는지 판정. Unity `Rect.Overlaps` 대응. */
export function rectOverlaps(a: Rect, b: Rect): boolean {
  return (
    rectXMax(a) > rectXMin(b) &&
    rectXMin(a) < rectXMax(b) &&
    rectYMax(a) > rectYMin(b) &&
    rectYMin(a) < rectYMax(b)
  );
}

/** `inner`가 `outer` 안에 완전히 포함되는지 판정. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    rectXMin(inner) >= rectXMin(outer) &&
    rectXMax(inner) <= rectXMax(outer) &&
    rectYMin(inner) >= rectYMin(outer) &&
    rectYMax(inner) <= rectYMax(outer)
  );
}

// ============================================================
// 2D 기하 — 외적, 각도, 회전
// ============================================================

/** 두 2D 벡터의 외적(스칼라). Unity `Math.Cross(Vector2, Vector2)`. */
export function cross2D(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * 두 2D 벡터가 반시계 방향(CCW)인지 판정. Cross >= 0.
 * Unity `Math.IsCCW(Vector2, Vector2)`.
 */
export function isCCW2(a: Vector2, b: Vector2): boolean {
  return cross2D(a, b) >= 0;
}

/**
 * 2D 폴리곤이 반시계 방향(CCW)인지 판정. 각 꼭짓점에서 외적 부호를 카운트해 다수결.
 * Unity `Math.IsCCW(Vector2[])`.
 *
 * @param points 폴리곤 꼭짓점 배열 (XZ 평면)
 */
export function isPolygonCCW(points: Vector2[]): boolean {
  let cw = 0;
  let ccw = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = new Vector3(points[i].x, 0, points[i].y);
    const p2 = new Vector3(points[(i + 1) % n].x, 0, points[(i + 1) % n].y);
    const p3 = new Vector3(points[(i + 2) % n].x, 0, points[(i + 2) % n].y);
    const dir1 = p2.clone().sub(p1).normalize();
    const dir2 = p3.clone().sub(p2).normalize();
    const c = new Vector3().crossVectors(dir1, dir2);
    if (c.dot(new Vector3(0, 1, 0)) > 0) cw++;
    else ccw++;
  }
  return ccw > cw;
}

/** 2D 폴리곤이 시계 방향(CW)인지. */
export function isPolygonCW(points: Vector2[]): boolean {
  return !isPolygonCCW(points);
}

/**
 * 2D 벡터의 x축 기준 각도(0~360°).
 * Unity `Math.Angle(Vector2 vector)`.
 */
export function angle2DFromX(vector: Vector2): number {
  const to = new Vector2(1, 0);
  const dotValue = Math.max(-1, Math.min(1, vector.clone().normalize().dot(to.normalize())));
  let result = radToDeg(Math.acos(dotValue));
  // Vector3.Cross(vector, to).z = -vector.y (since to.y=0, to.x=1)
  const crossZ = -vector.y;
  if (crossZ > 0) result = 360 - result;
  return result;
}

/**
 * 두 2D 벡터 사이 각도(0~360°). Cross 부호로 반시계 측정.
 * Unity `Math.Angle(Vector2, Vector2)` 및 `Math.Vec2Angle`.
 */
export function angle2DBetween(a: Vector2, b: Vector2): number {
  const dotValue = Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())));
  let angle = radToDeg(Math.acos(dotValue));
  if (cross2D(a, b) < 0) angle = 360 - angle;
  return angle;
}

/**
 * 각도로부터 2D 방향 벡터를 생성한다.
 * Unity `Math.Vector2FromAngle(float a)`.
 *
 * @param angleDeg 각도(도)
 */
export function vector2FromAngle(angleDeg: number): Vector2 {
  const r = degToRad(angleDeg);
  return new Vector2(Math.cos(r), Math.sin(r));
}

/**
 * 2D 점을 지정된 각도(도)만큼 회전한다.
 * Unity `Math.Vec2Rotate(point, degree)`.
 *
 * @param point 회전할 점
 * @param angleDeg 회전 각도(도)
 */
export function vec2Rotate(point: Vector2, angleDeg: number): Vector2 {
  const r = degToRad(angleDeg);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return new Vector2(cos * point.x - sin * point.y, sin * point.x + cos * point.y);
}

// ============================================================
// 3D 각도
// ============================================================

/**
 * 세 점(prev → curr → next)으로 이루어진 각도를 도(°)로 반환한다.
 * `up` 벡터 기준의 부호 있는 각도 — 시계/반시계 구분.
 *
 * Unity `Math.FindAngle(prev, curr, next, up)`.
 */
export function findAngle3D(
  prevPosition: Vector3,
  currPosition: Vector3,
  nextPosition: Vector3,
  up: Vector3 = new Vector3(0, 1, 0),
): number {
  const normPrev = prevPosition.clone().sub(currPosition).normalize();
  const normNext = nextPosition.clone().sub(currPosition).normalize();
  const c = new Vector3().crossVectors(normPrev, normNext);
  const dot = normPrev.dot(normNext);
  let sign = mathfSign(c.dot(up));
  if (sign === 0 && dot < 0) sign = 1;
  // 입력 정밀도 보호 — acos에 ±1을 살짝 벗어난 값이 들어가면 NaN
  const clamped = Math.max(-1, Math.min(1, dot));
  return sign * radToDeg(Math.acos(clamped));
}

// ============================================================
// 2D / 3D 점-선분
// ============================================================

/**
 * 2D 점이 선분 위에 있는지 판정 (거리 합 ≈ 선분 길이).
 * Unity `Math.IsPointOnLine(Vector2, Vector2, Vector2)`.
 */
export function isPointOnLine2D(v1: Vector2, v2: Vector2, point: Vector2): boolean {
  const distAB = v2.clone().sub(v1).length();
  const distAP = point.clone().sub(v1).length();
  const distPB = v2.clone().sub(point).length();
  return distAB >= distAP + distPB - EPSILON;
}

/**
 * 3D 점이 직선(또는 선분) 위에 있는지 판정.
 * 두 끝점 방향 단위벡터의 dot이 -1에 가까우면 점이 두 끝점 사이에 있음.
 *
 * Unity `Math.IsPointOnLine(Vector3, Vector3, Vector3)`.
 */
export function isPointOnLine3D(v1: Vector3, v2: Vector3, pt: Vector3): boolean {
  const dir0 = pt.clone().sub(v1).normalize();
  const dir1 = pt.clone().sub(v2).normalize();
  return dir0.dot(dir1) <= EPSILON - 1;
}

// ============================================================
// 2D 폴리곤
// ============================================================

/**
 * 점이 다각형 내부에 있는지 판별 (Ray Casting 알고리즘).
 *
 * 폴리곤의 첫 변 중심에서 시작해 무한대 방향으로 광선을 쏴 교차 횟수가 홀수면 내부.
 * Unity `Math.IsInPolygon(polygon, pt)`.
 */
export function isInPolygon(polygon: Vector2[], pt: Vector2): boolean {
  if (polygon.length < 2) return false;

  const center = polygon[0].clone().add(polygon[1]).multiplyScalar(0.5);
  const ptFar = center.clone().sub(pt).normalize().multiplyScalar(INFINITY);

  let count = 0;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const r = linesIntersectParams(current, next, pt, ptFar);
    if (r.intersects) count++;
  }
  return (count & 1) === 1;
}

/**
 * 점이 2D 삼각형 내부인지 판정 (외적 부호 검사).
 * Unity `Math.IsInTriangle2D`.
 */
export function isInTriangle2D(A: Vector2, B: Vector2, C: Vector2, P: Vector2): boolean {
  const ab = A.clone().sub(B);
  const bc = B.clone().sub(C);
  const ca = C.clone().sub(A);
  const bp = P.clone().sub(B);
  const cp = P.clone().sub(C);
  const ap = P.clone().sub(A);
  const c0 = ab.x * bp.y - ab.y * bp.x;
  const c1 = bc.x * cp.y - bc.y * cp.x;
  const c2 = ca.x * ap.y - ca.y * ap.x;
  return c0 >= 0 && c1 >= 0 && c2 >= 0;
}

// ============================================================
// 2D 선분 교차
// ============================================================

/** 두 선분의 매개변수 교차 결과. */
export interface LineIntersectParams {
  intersects: boolean;
  /** 선분 A 위 매개변수 (0~1: 선분 내부). */
  s: number;
  /** 선분 B 위 매개변수 (0~1: 선분 내부). */
  t: number;
}

/**
 * 두 선분(또는 직선)의 매개변수 교차를 판정한다.
 *
 * Unity `Math.LinesIntersect(A1, A2, B1, B2, out s, out t)`. 본 함수는 `intersects` 플래그로
 * "직선" 교차 여부를 반환하고, 호출자가 0~1 범위 검사로 "선분" 교차 여부를 판단한다.
 *
 * 평행이면 `intersects = false`. 일치 직선이면 `intersects = true`로 반환되지만 s/t는 무의미.
 */
export function linesIntersectParams(
  A1: Vector2,
  A2: Vector2,
  B1: Vector2,
  B2: Vector2,
): LineIntersectParams {
  if ((A1.x === A2.x && A1.y === A2.y) || (B1.x === B2.x && B1.y === B2.y)) {
    return { intersects: false, s: 0, t: 0 };
  }
  const A2A1x = A2.x - A1.x;
  const A2A1y = A2.y - A1.y;
  const B2B1x = B2.x - B1.x;
  const B2B1y = B2.y - B1.y;
  const A1B1x = A1.x - B1.x;
  const A1B1y = A1.y - B1.y;

  const denom = B2B1y * A2A1x - B2B1x * A2A1y;
  let s = B2B1x * A1B1y - B2B1y * A1B1x;
  let t = A2A1x * A1B1y - A2A1y * A1B1x;

  if (denom === 0) {
    if (s === 0 || t === 0) {
      // collinear
      return { intersects: true, s: 0, t: 0 };
    }
    return { intersects: false, s: 0, t: 0 };
  }
  s = s / denom;
  t = t / denom;
  return { intersects: true, s, t };
}

/**
 * 두 직선의 교차점을 계산한다 (선분 범위 체크 안 함).
 * Unity `Math.LinesIntersectPoint`.
 *
 * @returns 교차점 + 유효 여부
 */
export function linesIntersectPoint(
  A1: Vector2,
  A2: Vector2,
  B1: Vector2,
  B2: Vector2,
): { valid: boolean; point: Vector2 } {
  const r = linesIntersectParams(A1, A2, B1, B2);
  if (!r.intersects) return { valid: false, point: new Vector2() };
  return {
    valid: true,
    point: new Vector2(A1.x + r.s * (A2.x - A1.x), A1.y + r.s * (A2.y - A1.y)),
  };
}

/**
 * 두 선분의 교차점을 계산한다 (선분 범위 내에서만 교차로 인정).
 * Unity `Math.LinesIntersect(... , out bool valid, out bool accuracy)`.
 *
 * `accuracy`는 부동소수 오차로 매개변수가 [0,1]을 살짝 벗어난 경우를 흡수해 true로 본 결과.
 */
export function segmentsIntersectPoint(
  A1: Vector2,
  A2: Vector2,
  B1: Vector2,
  B2: Vector2,
): { valid: boolean; accuracy: boolean; point: Vector2 } {
  const r = linesIntersectParams(A1, A2, B1, B2);
  if (!r.intersects) return { valid: false, accuracy: false, point: new Vector2() };

  const accuracy =
    r.s >= -EPSILON && r.s <= 1 + EPSILON && r.t >= -EPSILON && r.t <= 1 + EPSILON;

  return {
    valid: true,
    accuracy,
    point: new Vector2(A1.x + r.s * (A2.x - A1.x), A1.y + r.s * (A2.y - A1.y)),
  };
}

/**
 * 두 선분 교차 — 선분 범위 내에서만 교차로 보고, 평행/일치 케이스는 별도 처리하지 않는 단순 버전.
 * Unity `Math.GetIntersectPoint`.
 */
export function getIntersectPoint(
  AP1: Vector2,
  AP2: Vector2,
  BP1: Vector2,
  BP2: Vector2,
): { intersect: boolean; point: Vector2 } {
  const under = (BP2.y - BP1.y) * (AP2.x - AP1.x) - (BP2.x - BP1.x) * (AP2.y - AP1.y);
  if (under === 0) return { intersect: false, point: new Vector2() };

  const tNum = (BP2.x - BP1.x) * (AP1.y - BP1.y) - (BP2.y - BP1.y) * (AP1.x - BP1.x);
  const sNum = (AP2.x - AP1.x) * (AP1.y - BP1.y) - (AP2.y - AP1.y) * (AP1.x - BP1.x);
  const t = tNum / under;
  const s = sNum / under;

  if (t < 0 || t > 1 || s < 0 || s > 1) return { intersect: false, point: new Vector2() };
  if (tNum === 0 && sNum === 0) return { intersect: false, point: new Vector2() };

  return {
    intersect: true,
    point: new Vector2(AP1.x + t * (AP2.x - AP1.x), AP1.y + t * (AP2.y - AP1.y)),
  };
}

// ============================================================
// 점-직선 거리, 투영
// ============================================================

/**
 * 점 P에서 직선 AB(무한)까지의 수직 거리.
 * Unity `Math.PointToLineDistance(A, B, P)` (3D 점 P 오버로드 — 본문에서 z를 무시).
 */
export function pointToLineDistance(A: Vector2, B: Vector2, P: Vector2): number {
  const normalLength = Math.sqrt((B.x - A.x) ** 2 + (B.y - A.y) ** 2);
  if (normalLength === 0) return P.distanceTo(A);
  return Math.abs((P.x - A.x) * (B.y - A.y) - (P.y - A.y) * (B.x - A.x)) / normalLength;
}

/**
 * 점 P를 직선 AB(무한)에 투영하고 거리·투영점을 반환한다.
 * Unity `Math.PointToLineDistance(A, B, P, out projectionPoint)`.
 */
export function pointToLineDistanceWithProjection(
  A: Vector2,
  B: Vector2,
  P: Vector2,
): { distance: number; projectionPoint: Vector2 } {
  const dir = B.clone().sub(A);
  const sqrLen = dir.lengthSq();
  if (sqrLen === 0) {
    return { distance: P.distanceTo(A), projectionPoint: A.clone() };
  }
  const t = P.clone().sub(A).dot(dir) / sqrLen;
  const projectionPoint = A.clone().add(dir.clone().multiplyScalar(t));
  const distance =
    Math.abs((P.x - A.x) * (B.y - A.y) - (P.y - A.y) * (B.x - A.x)) / Math.sqrt(sqrLen);
  return { distance, projectionPoint };
}

/**
 * 점 P를 선분 AB에 투영. 투영점이 선분 내부면 `onSegment = true`.
 * Unity `Math.TryProjectPointOnSegment`.
 */
export function tryProjectPointOnSegment(
  A: Vector2,
  B: Vector2,
  P: Vector2,
): { onSegment: boolean; projectionPoint: Vector2; distance: number } {
  const dir = B.clone().sub(A);
  const sqrLen = dir.lengthSq();
  if (sqrLen < Number.EPSILON) {
    return { onSegment: false, projectionPoint: A.clone(), distance: P.distanceTo(A) };
  }
  const t = P.clone().sub(A).dot(dir) / sqrLen;
  const projectionPoint = A.clone().add(dir.clone().multiplyScalar(t));
  const distance =
    Math.abs((P.x - A.x) * (B.y - A.y) - (P.y - A.y) * (B.x - A.x)) / Math.sqrt(sqrLen);
  return { onSegment: t >= 0 && t <= 1, projectionPoint, distance };
}

/**
 * 2D 레이(rayPos + t·rayDir)에서 점까지의 수직 거리(부호 있음).
 * Unity `Math.DistOfPerpendicular(Vector2, Vector2, Vector2)`.
 */
export function distOfPerpendicular2D(
  rayPos: Vector2,
  rayDir: Vector2,
  point: Vector2,
): number {
  const diff = point.clone().sub(rayPos);
  return rayDir.dot(diff);
}

/** 3D 버전. Unity `Math.DistOfPerpendicular(Vector3, Vector3, Vector3)`. */
export function distOfPerpendicular3D(
  rayPos: Vector3,
  rayDir: Vector3,
  point: Vector3,
): number {
  const diff = point.clone().sub(rayPos);
  return rayDir.dot(diff);
}

/**
 * 점에서 3D 레이에 내린 수선의 발.
 * Unity `Math.FootOfPerpendicular`.
 */
export function footOfPerpendicular(
  rayPos: Vector3,
  rayDir: Vector3,
  point: Vector3,
): Vector3 {
  const dist = distOfPerpendicular3D(rayPos, rayDir, point);
  return rayPos.clone().add(rayDir.clone().multiplyScalar(dist));
}

/**
 * 두 3D 직선 사이의 가장 가까운 두 점(각 직선 위에 하나씩).
 * Unity `Math.IntersectLineToLine`.
 */
export function intersectLineToLine(
  linePos1: Vector3,
  linePos2: Vector3,
  linePos3: Vector3,
  linePos4: Vector3,
): { point1: Vector3; point2: Vector3 } {
  const dir1 = linePos2.clone().sub(linePos1);
  const dir1Nor = dir1.clone().normalize();
  const dir2 = linePos4.clone().sub(linePos3);
  const dir2Nor = dir2.clone().normalize();

  const oProj = new Vector3().crossVectors(dir1, dir2);

  const pNor1 = new Vector3().crossVectors(oProj, dir2).normalize();
  const t1 = linePos3.clone().sub(linePos1).dot(pNor1);
  const t2 = t1 / dir1Nor.dot(pNor1);

  let point1 = linePos1.clone().add(dir1Nor.clone().multiplyScalar(t2));

  const pNor2 = new Vector3().crossVectors(oProj, dir1).normalize();
  const t3 = linePos2.clone().sub(linePos3).dot(pNor2);
  const t4 = t3 / dir2Nor.dot(pNor2);

  let point2 = linePos3.clone().add(dir2Nor.clone().multiplyScalar(t4));

  // 두 직선이 평행이면 t2, t4가 NaN — 한 점을 다른 직선에 투영해 대체.
  if (Number.isNaN(t2) && Number.isNaN(t4)) {
    point1 = linePos1.clone();
    point2 = footOfPerpendicular(linePos3, linePos4.clone().sub(linePos3).normalize(), point1);
  }

  return { point1, point2 };
}

// ============================================================
// 삼각형
// ============================================================

/**
 * 2D 삼각형의 면적.
 * Unity `Math.TriangleArea(Vector2 v1, v2, v3)`.
 */
export function triangleArea(v1: Vector2, v2: Vector2, v3: Vector2): number {
  const rectArea = Math.abs(
    v1.x * v2.y + v2.x * v3.y + v3.x * v1.y - (v1.x * v3.y + v3.x * v2.y + v2.x * v1.y),
  );
  return rectArea * 0.5;
}

/**
 * 삼각형 무게중심.
 * Unity `Math.TriangleGravity(a, b, c)` — Unity 원본은 Vector3 c를 받지만 .x/.y만 쓰므로 Vector2로 통일.
 */
export function triangleCentroid(a: Vector2, b: Vector2, c: Vector2): Vector2 {
  return new Vector2((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
}

/**
 * 다각형의 무게중심(면적 가중 중심).
 * Unity `Math.CentroidOfPolygon`.
 */
export function centroidOfPolygon(pts: Vector2[]): Vector2 {
  const n = pts.length;
  if (n === 0) return new Vector2();
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const f = p0.x * p1.y - p1.x * p0.y;
    area += f;
    cx += (p0.x + p1.x) * f;
    cy += (p0.y + p1.y) * f;
  }
  area *= 0.5;
  if (Math.abs(area) < EPSILON) return pts[0].clone();
  return new Vector2(cx / (6 * area), cy / (6 * area));
}

// ============================================================
// 3D 평면 · 박스
// ============================================================

/**
 * 점 + 법선으로부터 평면 방정식 `ax + by + cz + d = 0`을 Vector4로 반환.
 * (x,y,z) = normal, w = d = -dot(normal, point).
 *
 * Unity `Math.CreatePlane`.
 */
export function createPlane(point: Vector3, normal: Vector3): Vector4 {
  const d = -normal.dot(point);
  return new Vector4(normal.x, normal.y, normal.z, d);
}

/**
 * 레이와 평면의 교차 매개변수 `t` (단면, 후방향 무시).
 * Unity `Math.PlaneRayIntersect`.
 *
 * @returns `t` 값. 교차 안 하면 `null`.
 */
export function planeRayIntersect(
  vRayStart: Vector3,
  vRayDir: Vector3,
  vPlaneNormal: Vector3,
  fPlaneDist: number,
): number | null {
  if (!(vPlaneNormal.dot(vRayDir) < -EPSILON)) return null;
  return (-vPlaneNormal.dot(vRayStart) - fPlaneDist) / vPlaneNormal.dot(vRayDir);
}

/**
 * 레이와 평면의 양면 교차 매개변수 `t`.
 * Unity `Math.TwoSidePlaneRayIntersect`.
 */
export function twoSidePlaneRayIntersect(
  vRayStart: Vector3,
  vRayDir: Vector3,
  vPlaneNormal: Vector3,
  fPlaneDist: number,
): number | null {
  if (Math.abs(vPlaneNormal.dot(vRayDir)) < EPSILON) return null;
  return (-vPlaneNormal.dot(vRayStart) - fPlaneDist) / vPlaneNormal.dot(vRayDir);
}

/**
 * 레이와 3D 삼각형의 교차를 판정하고 교차점을 반환한다 (Möller-Trumbore).
 * Unity `Math.IsInTriangle3D`.
 */
export function intersectRayTriangle3D(
  origin: Vector3,
  dir: Vector3,
  vA: Vector3,
  vB: Vector3,
  vC: Vector3,
): { hit: boolean; point: Vector3 } {
  const vecU = vB.clone().sub(vA);
  const vecV = vC.clone().sub(vA);
  const pvec = new Vector3().crossVectors(dir, vecV);
  let det = pvec.dot(vecU);
  let tvec;
  if (det > 0) {
    tvec = origin.clone().sub(vA);
  } else {
    tvec = vA.clone().sub(origin);
    det = -det;
  }
  if (det < 0.0001) return { hit: false, point: new Vector3() };

  const u = tvec.dot(pvec);
  if (u < 0 || u > det) return { hit: false, point: new Vector3() };

  const qvec = new Vector3().crossVectors(tvec, vecU);
  const v = dir.dot(qvec);
  if (v < 0 || u + v > det) return { hit: false, point: new Vector3() };

  let t = vecV.dot(qvec);
  const invDet = 1 / det;
  t *= invDet;

  return { hit: true, point: origin.clone().add(dir.clone().multiplyScalar(t)) };
}

/**
 * 점이 OBB(방향 경계 상자) 내부인지 판정 (로컬 변환 후 AABB 검사).
 * Unity `Math.IsBoxIncluded`.
 */
export function isBoxIncluded(
  pos: Vector3,
  rot: Quaternion,
  extents: Vector3,
  p: Vector3,
): boolean {
  const invRot = rot.clone().invert();
  const negPos = pos.clone().negate().applyQuaternion(invRot);
  const localPos = p.clone().applyQuaternion(invRot).add(negPos);

  if (localPos.x < -extents.x || localPos.x > extents.x) return false;
  if (localPos.y < -extents.y || localPos.y > extents.y) return false;
  if (localPos.z < -extents.z || localPos.z > extents.z) return false;
  return true;
}

/**
 * 레이와 무한 평면 (점 + 법선)의 교차 — 접촉점 반환 (단면).
 * Unity `Math.RayCastPlane(rayPos, rayDir, pos, nor, out contactPos)`.
 */
export function rayCastPlane(
  rayPos: Vector3,
  rayDir: Vector3,
  pos: Vector3,
  nor: Vector3,
): { hit: boolean; contactPos: Vector3 } {
  const proj = rayDir.dot(nor);
  if (!(proj < 0)) return { hit: false, contactPos: new Vector3() };
  const t = -rayPos.clone().sub(pos).dot(nor) / proj;
  return { hit: true, contactPos: rayPos.clone().add(rayDir.clone().multiplyScalar(t)) };
}

/**
 * 레이와 무한 평면의 양면 교차.
 * Unity `Math.RayCastPlaneDoubleSided`.
 */
export function rayCastPlaneDoubleSided(
  rayPos: Vector3,
  rayDir: Vector3,
  pos: Vector3,
  nor: Vector3,
): { hit: boolean; contactPos: Vector3 } {
  const proj = rayDir.dot(nor);
  if (Math.abs(proj) < EPSILON) return { hit: false, contactPos: new Vector3() };
  const t = -rayPos.clone().sub(pos).dot(nor) / proj;
  if (t < 0) return { hit: false, contactPos: new Vector3() };
  return { hit: true, contactPos: rayPos.clone().add(rayDir.clone().multiplyScalar(t)) };
}

// ============================================================
// 벡터 헬퍼
// ============================================================

/** 두 Vector3 성분별 최소. Unity `Math.Min(Vector3, Vector3)`. */
export function vec3Min(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
}

/** 두 Vector3 성분별 최대. Unity `Math.Max(Vector3, Vector3)`. */
export function vec3Max(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
}

/** Vector3 성분별 곱. Unity `Math.MultiplyVec3s`. */
export function vec3Multiply(v1: Vector3, v2: Vector3): Vector3 {
  return new Vector3(v1.x * v2.x, v1.y * v2.y, v1.z * v2.z);
}

/** 점을 피벗 기준으로 회전. Unity `Math.RotateAroundPoint`. */
export function rotateAroundPoint(point: Vector3, pivot: Vector3, angle: Quaternion): Vector3 {
  return point.clone().sub(pivot).applyQuaternion(angle).add(pivot);
}