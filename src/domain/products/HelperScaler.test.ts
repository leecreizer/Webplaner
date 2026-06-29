import { describe, it, expect } from 'vitest';
import {
  Object3D,
  Mesh,
  BoxGeometry,
  BufferGeometry,
  BufferAttribute,
  Vector3,
} from 'three';
import {
  HelperScaler,
  isHelperRegionName,
  replaceableSizeOf,
  pickReplaceableSize,
} from './HelperScaler';

/**
 * 메인 메시: x = -1, 0, +1 에 정점 3개 (y=z=0).
 * helper > L : x[-1.1,-0.5] 영역 (정점 -1 포함)
 * helper > R : x[ 0.5, 1.1] 영역 (정점 +1 포함)
 */
function buildTestModel(): Object3D {
  const root = new Object3D();

  const geom = new BufferGeometry();
  const positions = new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0]);
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  const body = new Mesh(geom);
  body.name = 'HD';
  root.add(body);

  const helper = new Object3D();
  helper.name = 'helper';
  root.add(helper);

  const left = new Mesh(new BoxGeometry(0.6, 2, 2));
  left.name = 'L';
  left.position.set(-0.8, 0, 0); // AABB x[-1.1,-0.5]
  helper.add(left);

  const right = new Mesh(new BoxGeometry(0.6, 2, 2));
  right.name = 'R';
  right.position.set(0.8, 0, 0); // AABB x[0.5,1.1]
  helper.add(right);

  return root;
}

function bodyPositions(root: Object3D): Float32Array {
  const body = root.getObjectByName('HD') as Mesh;
  return (body.geometry.getAttribute('position') as BufferAttribute)
    .array as Float32Array;
}

/**
 * GLB export 후 `helper` 그룹 노드가 사라지고 L/R 메시가 루트 바로 아래에 오는 경우.
 * (3ds Max glTF export가 그룹/dummy 노드를 평탄화·제거하는 실측 동작 반영)
 */
function buildFlattenedModel(): Object3D {
  const root = new Object3D();

  const geom = new BufferGeometry();
  const positions = new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0]);
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  const body = new Mesh(geom);
  body.name = 'HP_IK00003';
  root.add(body);

  const left = new Mesh(new BoxGeometry(0.6, 2, 2));
  left.name = 'L';
  left.position.set(-0.8, 0, 0);
  root.add(left); // helper 부모 없이 루트 직속

  const right = new Mesh(new BoxGeometry(0.6, 2, 2));
  right.name = 'R';
  right.position.set(0.8, 0, 0);
  root.add(right);

  return root;
}

describe('HelperScaler — helper 부모 노드 없이 메시 이름으로 영역 인식', () => {
  it('L/R 메시가 루트 직속이어도 폭 스트레치가 동작한다', () => {
    const root = buildFlattenedModel();
    const scaler = HelperScaler.build(root);

    scaler.applyResize(new Vector3(4, 0, 0));

    const body = root.getObjectByName('HP_IK00003') as Mesh;
    const p = (body.geometry.getAttribute('position') as BufferAttribute)
      .array as Float32Array;
    expect(p[0]).toBeCloseTo(-2, 5);
    expect(p[3]).toBeCloseTo(0, 5);
    expect(p[6]).toBeCloseTo(2, 5);
  });

  it('순수 숫자 이름 메시(replaceable 구성품 900/1000)는 변형되지 않는다', () => {
    const root = buildFlattenedModel();
    const repl = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    repl.name = '900';
    repl.position.set(-0.9, 0, 0); // L 영역 안에 위치
    root.add(repl);

    const scaler = HelperScaler.build(root);
    scaler.applyResize(new Vector3(4, 0, 0));

    const arr = (repl.geometry.getAttribute('position') as BufferAttribute)
      .array as Float32Array;
    // 원본 BoxGeometry(0.2) 정점은 그대로여야 함 (replaceable 제외)
    expect(Math.min(...arr.filter((_, i) => i % 3 === 0))).toBeCloseTo(-0.1, 5);
  });
});

describe('replaceable 구성품 이름/선택 규칙', () => {
  it('순수 숫자(+GLTF 접미사) 이름에서 사이즈를 추출한다', () => {
    expect(replaceableSizeOf('900')).toBe(900);
    expect(replaceableSizeOf('1000_2')).toBe(1000);
    expect(replaceableSizeOf('L')).toBeNull();
    expect(replaceableSizeOf('HP_IK00003_1')).toBeNull();
  });

  it('helper 영역 이름은 GLTF 접미사가 붙어도 인식한다', () => {
    expect(isHelperRegionName('L')).toBe(true);
    expect(isHelperRegionName('K2')).toBe(true);
    expect(isHelperRegionName('L_1')).toBe(true);
    expect(isHelperRegionName('1000_2')).toBe(false);
  });

  it('입력값 이하 최대 사이즈를 고르고, 없으면 최소를 고른다', () => {
    expect(pickReplaceableSize([900, 1000], 900)).toBe(900);
    expect(pickReplaceableSize([900, 1000], 1000)).toBe(1000);
    expect(pickReplaceableSize([900, 1000], 1200)).toBe(1000); // 구간 최대
    expect(pickReplaceableSize([900, 1000], 800)).toBe(900); // 이하 없으면 최소
    expect(pickReplaceableSize([], 900)).toBeNull();
  });
});

describe('HelperScaler — 부모 transform(스케일) 하에서도 월드공간 기준 변형', () => {
  it('스케일된 부모 아래서 폭 변경이 월드 좌표 기준으로 정확히 적용된다', () => {
    // 실제 GLB처럼 로컬 단위 ≠ 월드 단위 상황. 부모 scale=2 → 로컬1 = 월드2.
    const parent = new Object3D();
    parent.scale.set(2, 2, 2);

    const geom = new BufferGeometry();
    const positions = new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0]); // 월드 x: -2,0,2
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    const body = new Mesh(geom);
    body.name = 'HP_IK00003';
    parent.add(body);

    const left = new Mesh(new BoxGeometry(0.6, 4, 4));
    left.name = 'L';
    left.position.set(-1, 0, 0); // 월드 x -2 부근
    parent.add(left);

    const right = new Mesh(new BoxGeometry(0.6, 4, 4));
    right.name = 'R';
    right.position.set(1, 0, 0); // 월드 x +2 부근
    parent.add(right);

    const scaler = HelperScaler.build(parent);
    // 월드 폭 4 → 8 (delta 4, 좌우 2씩 월드 이동)
    scaler.applyResize(new Vector3(8, 0, 0));

    const p = (body.geometry.getAttribute('position') as BufferAttribute)
      .array as Float32Array;
    // 로컬 좌표 기준: 월드 -4 = 로컬 -2, 월드 +4 = 로컬 +2
    expect(p[0]).toBeCloseTo(-2, 4);
    expect(p[3]).toBeCloseTo(0, 4);
    expect(p[6]).toBeCloseTo(2, 4);
  });
});

describe('HelperScaler — 폭(W) → L/R 영역 스트레치', () => {
  it('폭을 2→4로 늘리면 좌우 정점만 바깥으로 이동하고 중앙은 고정된다', () => {
    const root = buildTestModel();
    const scaler = HelperScaler.build(root);

    // 원본 폭 2 → 목표 폭 4 (delta 2, 좌우 1씩 분배)
    scaler.applyResize(new Vector3(4, 0, 0));

    const p = bodyPositions(root);
    expect(p[0]).toBeCloseTo(-2, 5); // 좌측 정점 -1 → -2
    expect(p[3]).toBeCloseTo(0, 5); // 중앙 정점 0 → 0 (고정)
    expect(p[6]).toBeCloseTo(2, 5); // 우측 정점 +1 → +2
  });

  it('폭을 줄이면 좌우 정점이 안쪽으로 이동한다', () => {
    const root = buildTestModel();
    const scaler = HelperScaler.build(root);

    scaler.applyResize(new Vector3(1, 0, 0)); // delta -1, 좌우 -0.5씩

    const p = bodyPositions(root);
    expect(p[0]).toBeCloseTo(-0.5, 5);
    expect(p[3]).toBeCloseTo(0, 5);
    expect(p[6]).toBeCloseTo(0.5, 5);
  });
});