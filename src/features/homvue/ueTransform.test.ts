import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { matrixToUeTransform, ueTransformToMatrix } from './ueTransform';

const close = (v: Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 5);
  expect(v.y).toBeCloseTo(y, 5);
  expect(v.z).toBeCloseTo(z, 5);
};

describe('ueTransformToMatrix', () => {
  it('원점·무회전·크기 1 = 단위 행렬', () => {
    expect(ueTransformToMatrix([0, 0, 0], [0, 0, 0]).equals(new Matrix4())).toBe(true);
  });

  it('위치: 언리얼 (X, Y, Z) cm → 웹 (X, Z, Y) m', () => {
    const p = new Vector3().setFromMatrixPosition(ueTransformToMatrix([100, 200, 300], [0, 0, 0]));
    close(p, 1, 3, 2);
  });

  it('실측: 외벽 블루프린트 언리얼 경계 모서리 → GLB 경계 모서리', () => {
    // 언리얼 cm min (-325.1, -507.2, -12) ↔ GLB m min (-3.251, -0.12, -5.072)
    const p = new Vector3().setFromMatrixPosition(ueTransformToMatrix([-325.1, -507.2, -12], [0, 0, 0]));
    close(p, -3.251, -0.12, -5.072);
  });

  it('Yaw 90°: 언리얼 X축이 Y축으로 → 웹 x축이 z축으로', () => {
    const m = ueTransformToMatrix([0, 0, 0], [0, 0, 90]);
    close(new Vector3(1, 0, 0).applyMatrix4(m), 0, 0, 1);
    close(new Vector3(0, 1, 0).applyMatrix4(m), 0, 1, 0); // 위쪽(웹 y = 언리얼 Z)은 그대로
  });

  it('위치 + 회전 + 크기 합성: 언리얼 점을 먼저 변환한 뒤 맞바꾼 것과 같다', () => {
    const m = ueTransformToMatrix([50, -20, 10], [10, 20, 30], [2, 1, 0.5]);
    // 언리얼 국소 점 (10, 0, 0) cm → 언리얼 세계 점을 따로 계산해 웹으로 옮긴 값과 비교
    const r = (d: number) => (d * Math.PI) / 180;
    const [sp, cp, sy, cy] = [Math.sin(r(20)), Math.cos(r(20)), Math.sin(r(30)), Math.cos(r(30))];
    const ueX = [cp * cy, cp * sy, sp]; // 언리얼 회전 후 X축
    const world = [50 + 10 * 2 * ueX[0], -20 + 10 * 2 * ueX[1], 10 + 10 * 2 * ueX[2]]; // cm
    const v = new Vector3(0.1, 0, 0).applyMatrix4(m); // 국소 (10cm, 0, 0) 를 웹 국소 좌표로 = (0.1, 0, 0)
    close(v, world[0] / 100, world[2] / 100, world[1] / 100);
  });
});

describe('matrixToUeTransform — 기즈모로 옮긴 상품을 언리얼 좌표로 되돌림', () => {
  const cases: [[number, number, number], [number, number, number], [number, number, number]][] = [
    [[0, 0, 0], [0, 0, 0], [1, 1, 1]],
    [[120.5, -340, 71.8], [0, 0, 135], [1, 1, 1]],
    [[-10, 20, 30], [10, -20, 75], [0.9, 0.9, 1]],
    [[5, 6, 7], [0, 0, -90], [-1.497, -1.497, -1]],
  ];
  for (const [loc, rot, scl] of cases) {
    it(`왕복 ${JSON.stringify([loc, rot, scl])}`, () => {
      const m = ueTransformToMatrix(loc, rot, scl);
      const back = matrixToUeTransform(m, scl.map(Math.sign) as [number, number, number]);
      const m2 = ueTransformToMatrix(back.location_cm, back.rotation_deg, back.scale);
      for (let i = 0; i < 16; i++) expect(m2.elements[i]).toBeCloseTo(m.elements[i], 4);
    });
  }
});
