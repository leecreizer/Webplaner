import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { matrixToUeTransform, ueTransformToMatrix } from './ueTransform';

/** 조명 손잡이 — 언리얼 +X(빛 방향)·+Z(위) 를 웹 축으로 세운 행렬이 언리얼 회전으로 되돌아오는지 */
describe('조명 손잡이 ↔ 언리얼 회전', () => {
  it('왕복해도 방향·위치가 같다', () => {
    for (const rot of [[0, -90, 0], [12, -35, 70], [-30, 20, -120], [37.9973, -11.3769, -86.542]] as [number, number, number][]) {
      const loc: [number, number, number] = [120, -340, 250];
      const m = ueTransformToMatrix(loc, rot);
      const dir = new Vector3(1, 0, 0).transformDirection(m);
      const up = new Vector3(0, 1, 0).transformDirection(m);
      const pos = new Vector3().setFromMatrixPosition(m);
      const handle = new Matrix4().makeBasis(dir, up, dir.clone().cross(up)).setPosition(pos);
      const ue = matrixToUeTransform(handle);
      const back = ueTransformToMatrix(ue.location_cm, ue.rotation_deg);
      expect(new Vector3(1, 0, 0).transformDirection(back).distanceTo(dir)).toBeLessThan(1e-4);
      expect(new Vector3(0, 1, 0).transformDirection(back).distanceTo(up)).toBeLessThan(1e-4);
      ue.location_cm.forEach((v, i) => expect(v).toBeCloseTo(loc[i], 4));
    }
  });
});
