import { Vector2 } from 'three';

/**
 * 2D 폴리곤을 삼각형으로 분할하는 Ear Clipping 트라이앵귤레이터.
 *
 * Unity `Utils.Triangulator` 1:1 포팅. Floor/Ceiling/공간 영역 메시 생성에 사용된다.
 *
 * @example
 * ```ts
 * const tri = new Triangulator(polygon);
 * const indices = tri.triangulate(); // [a0, b0, c0, a1, b1, c1, ...]
 * ```
 */
export class Triangulator {
  private readonly _points: Vector2[];

  /**
   * @param points 폴리곤을 구성하는 2D 점 배열. 마지막 점이 첫 점과 닫혀있어야 할 필요는 없다.
   */
  constructor(points: Vector2[]) {
    this._points = points.slice();
  }

  /**
   * 폴리곤을 삼각형으로 분할하여 정점 인덱스 배열을 반환한다.
   * 인덱스는 입력 `points` 배열을 참조한다.
   *
   * @returns `[a0, b0, c0, a1, b1, c1, ...]` 형태의 인덱스 배열. 폴리곤이 유효하지 않으면 빈 배열.
   */
  triangulate(): number[] {
    const indices: number[] = [];
    const n = this._points.length;
    if (n < 3) return indices;

    const V: number[] = new Array(n);
    if (this._signedArea() > 0) {
      for (let v = 0; v < n; v++) V[v] = v;
    } else {
      for (let v = 0; v < n; v++) V[v] = n - 1 - v;
    }

    let nv = n;
    let count = 2 * nv;
    let v = nv - 1;

    while (nv > 2) {
      if (count-- <= 0) return indices; // bail out — 무한 루프 보호

      let u = v;
      if (nv <= u) u = 0;
      v = u + 1;
      if (nv <= v) v = 0;
      let w = v + 1;
      if (nv <= w) w = 0;

      if (this._snip(u, v, w, nv, V)) {
        const a = V[u];
        const b = V[v];
        const c = V[w];
        indices.push(a, b, c);

        for (let s = v, t = v + 1; t < nv; s++, t++) {
          V[s] = V[t];
        }
        nv--;
        count = 2 * nv;
      }
    }

    indices.reverse();
    return indices;
  }

  /** 부호 있는 면적. 양수이면 CCW, 음수이면 CW. */
  private _signedArea(): number {
    const n = this._points.length;
    let A = 0;
    for (let p = n - 1, q = 0; q < n; p = q++) {
      const pv = this._points[p];
      const qv = this._points[q];
      A += pv.x * qv.y - qv.x * pv.y;
    }
    return A * 0.5;
  }

  /**
   * `u, v, w` 인덱스로 구성된 삼각형이 유효한 Ear인지 검사한다.
   * 삼각형 내부에 다른 정점이 포함되지 않아야 한다.
   */
  private _snip(u: number, v: number, w: number, n: number, V: number[]): boolean {
    const A = this._points[V[u]];
    const B = this._points[V[v]];
    const C = this._points[V[w]];

    // CCW 검사 — 매우 좁은 삼각형(noise)을 제거
    if (Number.EPSILON > (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)) {
      return false;
    }
    for (let p = 0; p < n; p++) {
      if (p === u || p === v || p === w) continue;
      const P = this._points[V[p]];
      if (Triangulator._insideTriangle(A, B, C, P)) return false;
    }
    return true;
  }

  /** 점 `P`가 삼각형 `ABC` 내부인지(또는 변 위) 외적 부호로 판정. */
  private static _insideTriangle(A: Vector2, B: Vector2, C: Vector2, P: Vector2): boolean {
    const ax = C.x - B.x;
    const ay = C.y - B.y;
    const bx = A.x - C.x;
    const by = A.y - C.y;
    const cx = B.x - A.x;
    const cy = B.y - A.y;
    const apx = P.x - A.x;
    const apy = P.y - A.y;
    const bpx = P.x - B.x;
    const bpy = P.y - B.y;
    const cpx = P.x - C.x;
    const cpy = P.y - C.y;

    const aCrossBp = ax * bpy - ay * bpx;
    const cCrossAp = cx * apy - cy * apx;
    const bCrossCp = bx * cpy - by * cpx;

    return aCrossBp >= 0 && bCrossCp >= 0 && cCrossAp >= 0;
  }
}