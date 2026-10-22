import { describe, expect, it } from 'vitest';
import { DirectionalLight, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Scene, SphereGeometry } from 'three';
import { startCausticJob } from './causticTrace';

/** 유리구 렌즈 아래 바닥 — 평행광이 초점 근처에 모여 밝은 점이 생기고, 모인 빛이 들어온 빛보다 많지 않다 */
function lensScene(ior = 1.5) {
  const scene = new Scene();
  const floor = new Mesh(new PlaneGeometry(4, 4), new MeshStandardMaterial({ color: 0xffffff }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // 구 렌즈 초점 거리 f = nR / (2(n − 1)) — 반지름 0.1, n 1.5 → 중심에서 0.15. 초점을 바닥에 맞춘다
  const glass = new Mesh(new SphereGeometry(0.1, 64, 32), new MeshPhysicalMaterial({ transmission: 1, ior, roughness: 0, thickness: 0.2 }));
  glass.position.y = 0.15;
  scene.add(glass);
  const sun = new DirectionalLight(0xffffff, 1);
  sun.position.set(0, 10, 0);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  return scene;
}

describe('causticTrace', () => {
  it('구 렌즈 아래에 초점이 생긴다', async () => {
    const job = startCausticJob(lensScene(), { photons: 40000, blur: 1 }, 1e9);
    const patches = (await job.done)!;
    expect(patches.length).toBeGreaterThan(0);
    const floor = patches.find((p) => p.normal.y > 0.9)!;
    expect(floor).toBeTruthy();
    // 직사광이 비추는 흰 바닥 밝기 = 1/π ≈ 0.32 — 초점은 그 몇 배 이상
    expect(floor.peak).toBeGreaterThan(5 / Math.PI);
    // 바닥에 남은 빛 ≤ 구 단면으로 들어온 빛(π r² × 조도 1)
    const cellArea = (floor.width / floor.cols) * (floor.height / floor.rows);
    let flux = 0;
    for (let k = 0; k < floor.radiance.length; k += 3) flux += floor.radiance[k] * cellArea * Math.PI;
    const incident = Math.PI * 0.1 * 0.1;
    expect(flux).toBeLessThan(incident * 1.02);
    expect(flux).toBeGreaterThan(incident * 0.6);
    // 초점은 구 바로 아래
    const k = floor.radiance.indexOf(floor.peak);
    const cell = Math.floor(k / 3);
    const x = (cell % floor.cols) + 0.5 - floor.cols / 2;
    const y = Math.floor(cell / floor.cols) + 0.5 - floor.rows / 2;
    const off = Math.hypot((x * floor.width) / floor.cols + floor.center.dot(floor.e1), (y * floor.height) / floor.rows + floor.center.dot(floor.e2));
    expect(off).toBeLessThan(0.02);
  });

  it('유리가 없으면 조각이 없다', async () => {
    const scene = lensScene();
    scene.children.filter((o) => (o as Mesh).material instanceof MeshPhysicalMaterial).forEach((o) => scene.remove(o));
    expect(await startCausticJob(scene, { photons: 1000, blur: 1 }, 1e9).done).toEqual([]);
  });
});
