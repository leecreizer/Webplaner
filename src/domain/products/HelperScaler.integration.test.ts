import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import {
  Object3D,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  Matrix4,
  Box3,
  Vector3,
} from 'three';
import { HelperScaler } from './HelperScaler';

/**
 * 실제 export된 GLB(HP_IK00003_2.glb)를 GLTFLoader 없이 노드 트리로 복원해
 * 진짜 HelperScaler 코드를 돌려 폭 스트레치를 검증한다.
 * (텍스처/머티리얼 없이 POSITION + node matrix 만 사용)
 */
const GLB_PATH =
  'C:/Users/20180341/OneDrive/Documents/3ds Max 2021/export/HP_IK00003_2.glb';

function parseGlb(path: string) {
  const buf = readFileSync(path);
  let off = 12;
  let json: any = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin: bin! };
}

function readPositions(json: any, bin: Buffer, accIdx: number): Float32Array {
  const a = json.accessors[accIdx];
  const bv = json.bufferViews[a.bufferView];
  const stride = bv.byteStride || 12;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    out[i * 3] = bin.readFloatLE(o);
    out[i * 3 + 1] = bin.readFloatLE(o + 4);
    out[i * 3 + 2] = bin.readFloatLE(o + 8);
  }
  return out;
}

/** GLB → three Object3D 트리 (geometry + node.matrix만). */
function buildScene(json: any, bin: Buffer): Object3D {
  const objs: Object3D[] = json.nodes.map((n: any) => {
    let obj: Object3D;
    if (n.mesh != null) {
      const prim = json.meshes[n.mesh].primitives[0];
      const geom = new BufferGeometry();
      geom.setAttribute(
        'position',
        new BufferAttribute(readPositions(json, bin, prim.attributes.POSITION), 3),
      );
      obj = new Mesh(geom);
    } else {
      obj = new Object3D();
    }
    obj.name = n.name || '';
    if (n.matrix) {
      obj.matrixAutoUpdate = false;
      obj.matrix.fromArray(n.matrix);
    }
    return obj;
  });
  json.nodes.forEach((n: any, i: number) => {
    (n.children || []).forEach((c: number) => objs[i].add(objs[c]));
  });
  const root = new Object3D();
  const childSet = new Set<number>();
  json.nodes.forEach((n: any) =>
    (n.children || []).forEach((c: number) => childSet.add(c)),
  );
  json.nodes.forEach((_n: any, i: number) => {
    if (!childSet.has(i)) root.add(objs[i]);
  });
  root.updateMatrixWorld(true);
  return root;
}

function worldBodyBox(root: Object3D): Box3 {
  const body = root.getObjectByName('HP_IK00003') as Mesh;
  return new Box3().setFromObject(body);
}

describe.skipIf(!existsSync(GLB_PATH))(
  'HelperScaler 실 GLB 통합 (HP_IK00003_2.glb)',
  () => {
    it('폭을 늘리면 몸통 월드 폭이 목표치가 되고 중앙은 보존된다', () => {
      const { json, bin } = parseGlb(GLB_PATH);
      const root = buildScene(json, bin);

      const before = worldBodyBox(root);
      const origW = before.max.x - before.min.x;
      const origH = before.max.y - before.min.y;
      const origD = before.max.z - before.min.z;
      expect(origW).toBeGreaterThan(0.5); // 약 0.9m

      // 변형 전 중앙 정점 월드 X 스냅샷 (|x|<0.1)
      const body = root.getObjectByName('HP_IK00003') as Mesh;
      const attr = body.geometry.getAttribute('position') as BufferAttribute;
      const v = new Vector3();
      const centerBefore: number[] = [];
      for (let i = 0; i < attr.count; i++) {
        v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
        body.localToWorld(v);
        if (Math.abs(v.x) < 0.1) centerBefore.push(v.x);
      }

      const targetW = origW + 0.3; // 폭 +300mm
      const scaler = HelperScaler.build(root);
      scaler.applyResize(new Vector3(targetW, origH, origD));
      root.updateMatrixWorld(true);

      const after = worldBodyBox(root);
      const newW = after.max.x - after.min.x;
      expect(newW).toBeCloseTo(targetW, 2); // 폭이 목표치로 확장

      // 높이/깊이는 변동 없음
      expect(after.max.y - after.min.y).toBeCloseTo(origH, 2);
      expect(after.max.z - after.min.z).toBeCloseTo(origD, 2);

      // 중앙 정점 보존 — 이동 없음
      let centerMoved = 0;
      let idx = 0;
      for (let i = 0; i < attr.count; i++) {
        v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
        body.localToWorld(v);
        if (Math.abs(v.x) < 0.1 && idx < centerBefore.length) {
          if (Math.abs(v.x - centerBefore[idx]) > 1e-4) centerMoved++;
          idx++;
        }
      }
      expect(centerMoved).toBe(0);
    });
  },
);