/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * 광선 가속 구조(MeshBVH) 만들기 — 큰 메시(합친 레벨 메시 수십만 삼각형)는 주 스레드에서 수 초 걸려 화면이 멈춘다(실측 2.5초).
 * 위치·index 사본을 받아 여기서 만들고 직렬화해 돌려준다. 원래 형상은 건드리지 않는다(indirect).
 */
self.onmessage = (e: MessageEvent<{ id: number; position: Float32Array; index: Uint32Array | null }>) => {
  const { id, position, index } = e.data;
  try {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    if (index) g.setIndex(new BufferAttribute(index, 1));
    const bvh = new MeshBVH(g, { indirect: true });
    const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false });
    (self as unknown as Worker).postMessage({ id, serialized });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
