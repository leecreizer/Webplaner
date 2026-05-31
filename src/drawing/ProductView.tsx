import { Suspense } from 'react';
import { Vector3 } from 'three';
import { useGLTF } from '@react-three/drei';
import type { ProductInfo } from '../products/ProductInfo';
import { mmToM } from '../utils/Math';

/**
 * 단일 ProductInfo를 그리는 r3f 컴포넌트 — GLB 자산을 `useGLTF`로 로드해 배치한다.
 *
 * Unity의 prefab 인스턴스화(`Resources.Load + Instantiate`) + transform 적용을 r3f의
 * 선언적 GLTF 로드로 대체한다.
 *
 * ### `useGLTF` 캐싱
 * drei의 `useGLTF`는 URL 기준 캐시를 사용하므로 같은 `assetURL`을 가진 여러 인스턴스가
 * 자동으로 메모리를 공유한다. 추가 호출당 비용은 R3F 노드 트리 클론만 발생.
 *
 * ### Suspense
 * 본 컴포넌트는 GLTF 로딩 대기 중에 throw하므로 부모에서 `<Suspense>`로 감싸야 한다 —
 * 본 컴포넌트가 자체 Suspense fallback을 내장하여 편의성을 제공한다.
 */
export function ProductView({ product }: { product: ProductInfo }) {
  const cm = product.contentsMaster;
  if (!cm || !cm.assetURL) return null;

  return (
    <Suspense fallback={null}>
      <ProductGLTF
        url={cm.assetURL}
        position={product.position}
        rotationEulerDeg={product.rotationEuler}
      />
    </Suspense>
  );
}

/**
 * 내부 컴포넌트 — Suspense 경계 내부에서만 호출되어야 한다.
 * `useGLTF`는 비동기 로드 중일 때 throw하므로 본 컴포넌트는 항상 Suspense 자식이어야 한다.
 */
function ProductGLTF({
  url,
  position,
  rotationEulerDeg,
}: {
  url: string;
  position: Vector3;
  rotationEulerDeg: Vector3;
}) {
  const { scene } = useGLTF(url);
  const rotRad: [number, number, number] = [
    (rotationEulerDeg.x * Math.PI) / 180,
    (rotationEulerDeg.y * Math.PI) / 180,
    (rotationEulerDeg.z * Math.PI) / 180,
  ];
  return (
    <primitive
      object={scene.clone()}
      position={[position.x, position.y, position.z]}
      rotation={rotRad}
    />
  );
}

/**
 * 카탈로그 마스터의 mm 치수를 Three.js 단위(m)로 환산한 Vector3를 반환한다.
 * Wall/Floor 차원과 통일하기 위해 외부 사용처에서 활용 가능.
 *
 * @param cm contentsMaster
 */
export function contentsMasterSizeInM(cm: {
  length: number;
  depth: number;
  height: number;
}): Vector3 {
  return new Vector3(mmToM(cm.length), mmToM(cm.height), mmToM(cm.depth));
}