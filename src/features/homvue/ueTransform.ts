import { Matrix4 } from 'three';

/**
 * 언리얼 좌표 → 홈플래너3(three.js) 좌표.
 *
 * 실측(외벽 블루프린트 경계 상자, 언리얼 cm ↔ 변환 GLB m): 웹 (x, y, z) = 언리얼 (X, Z, Y) ÷ 100.
 * Y·Z 맞바꿈은 거울 대응이라(왼손 → 오른손 좌표계) 회전은 같은 맞바꿈 행렬 P 로 양쪽을 감싸 옮긴다:
 * M_web = P · M_언리얼 · P (P = Y·Z 맞바꿈, 이동량만 ÷100 — GLB 정점은 이미 m).
 */
const P = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

const DEG = Math.PI / 180;

/**
 * 언리얼 액터 변환 → three.js 행렬.
 * @param locationCm 언리얼 위치 [X, Y, Z] (cm)
 * @param rotationDeg 언리얼 회전 [Roll, Pitch, Yaw] (도)
 * @param scale 언리얼 크기 [X, Y, Z]
 */
export function ueTransformToMatrix(
  locationCm: [number, number, number],
  rotationDeg: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
): Matrix4 {
  const [roll, pitch, yaw] = rotationDeg.map((d) => d * DEG);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  // 언리얼 FRotationMatrix 의 행(= 회전 후 X·Y·Z 축) → 열 벡터 행렬의 열
  const ax = [cp * cy, cp * sy, sp];
  const ay = [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp];
  const az = [-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp];
  const [x, y, z] = locationCm.map((v) => v / 100);
  const [kx, ky, kz] = scale;
  const ue = new Matrix4().set(
    ax[0] * kx, ay[0] * ky, az[0] * kz, x,
    ax[1] * kx, ay[1] * ky, az[1] * kz, y,
    ax[2] * kx, ay[2] * ky, az[2] * kz, z,
    0, 0, 0, 1,
  );
  return new Matrix4().multiplyMatrices(P, ue).multiply(P);
}

/**
 * three.js 행렬 → 언리얼 액터 변환 (ueTransformToMatrix 의 역). 기즈모로 옮긴 상품을 언리얼 좌표로 저장할 때.
 * @param signs 원래 언리얼 크기의 부호(거울 상품 -1 등) — 행렬만으로는 어느 축이 뒤집혔는지 알 수 없다
 */
export function matrixToUeTransform(
  m: Matrix4,
  signs: [number, number, number] = [1, 1, 1],
): { location_cm: [number, number, number]; rotation_deg: [number, number, number]; scale: [number, number, number] } {
  const ue = new Matrix4().multiplyMatrices(P, m).multiply(P);
  const e = ue.elements; // 열 우선
  const col = (i: number) => [e[i * 4], e[i * 4 + 1], e[i * 4 + 2]];
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const [cx, cy, cz] = [col(0), col(1), col(2)];
  const kx = len(cx) * Math.sign(signs[0] || 1);
  const ky = len(cy) * Math.sign(signs[1] || 1);
  const kz = len(cz) * Math.sign(signs[2] || 1);
  const ax = cx.map((v) => v / kx);
  const ay = cy.map((v) => v / ky);
  const az = cz.map((v) => v / kz);
  // ax = [cp·cy, cp·sy, sp] · ay.z = -sr·cp · az.z = cr·cp  (ueTransformToMatrix 참고)
  const pitch = Math.asin(Math.max(-1, Math.min(1, ax[2])));
  const yaw = Math.atan2(ax[1], ax[0]);
  const roll = Math.atan2(-ay[2], az[2]);
  const r = (v: number) => Math.round((v / DEG) * 1000) / 1000;
  return {
    location_cm: [e[12] * 100, e[13] * 100, e[14] * 100],
    rotation_deg: [r(roll), r(pitch), r(yaw)],
    scale: [kx, ky, kz],
  };
}
