import { describe, it, expect } from 'vitest';
import { Object3D, Mesh, BoxGeometry } from 'three';
import { baseName, readDpTypes, readHotspots } from './ModelMarkers';

/** 변환기 산출 GLB를 모사: DP>X/HD, hotspot>DL1/DR1 (마커 메시, _N 접미사 포함). */
function buildModel(): Object3D {
  const root = new Object3D();
  root.name = 'HP_IK00003';

  const dp = new Object3D();
  dp.name = 'DP';
  const x = new Mesh(new BoxGeometry(1, 1, 1)); x.name = 'X'; dp.add(x);
  const hd = new Mesh(new BoxGeometry(1, 1, 1)); hd.name = 'HD_1'; dp.add(hd); // _N 접미사
  root.add(dp);

  const hs = new Object3D();
  hs.name = 'hotspot';
  const dl = new Mesh(new BoxGeometry(1, 1, 1)); dl.name = 'DL1'; dl.position.set(-0.4, 1, 0.3); hs.add(dl);
  const dr = new Mesh(new BoxGeometry(1, 1, 1)); dr.name = 'DR1_2'; dr.position.set(0.4, 1, 0.3); hs.add(dr);
  root.add(hs);

  return root;
}

describe('ModelMarkers', () => {
  it('baseName은 GLTF _N 접미사를 제거한다', () => {
    expect(baseName('HD_1')).toBe('HD');
    expect(baseName('DL1')).toBe('DL1');
    expect(baseName('mesh_0_3')).toBe('mesh_0'); // 마지막 _N만 제거
  });

  it('DP 노드의 자식에서 DP 타입을 읽는다 (_N 무시)', () => {
    const root = buildModel();
    expect(readDpTypes(root).sort()).toEqual(['HD', 'X']);
  });

  it('DP 노드가 없으면 빈 배열', () => {
    expect(readDpTypes(new Object3D())).toEqual([]);
  });

  it('hotspot 자식 이름+월드위치를 읽는다 (_N 무시)', () => {
    const root = buildModel();
    const hs = readHotspots(root);
    const names = hs.map((h) => h.name).sort();
    expect(names).toEqual(['DL1', 'DR1']);
    const dl = hs.find((h) => h.name === 'DL1')!;
    expect(dl.position[0]).toBeCloseTo(-0.4, 5);
    expect(dl.position[1]).toBeCloseTo(1, 5);
  });
});
