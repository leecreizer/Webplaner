import { Suspense, useMemo } from 'react';
import { Mesh, Object3D, Vector3 } from 'three';
import { useGLTF } from '@react-three/drei';
import type { ProductInfo } from '@/domain/products/ProductInfo';
import { HelperScaler, isHelperRegionName } from '@/domain/products/HelperScaler';
import { mmToM } from '@/lib/math/Math';

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

  // 목표 치수(m) — product.size가 설정돼 있으면 그것, 아니면 카탈로그 규격(mm→m).
  const target =
    product.size.lengthSq() > 0
      ? product.size
      : contentsMasterSizeInM(cm);

  return (
    <Suspense fallback={null}>
      <ProductGLTF
        url={cm.assetURL}
        position={product.position}
        rotationEulerDeg={product.rotationEuler}
        target={target}
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
  target,
}: {
  url: string;
  position: Vector3;
  rotationEulerDeg: Vector3;
  target: Vector3;
}) {
  const { scene } = useGLTF(url);
  const rotRad: [number, number, number] = [
    (rotationEulerDeg.x * Math.PI) / 180,
    (rotationEulerDeg.y * Math.PI) / 180,
    (rotationEulerDeg.z * Math.PI) / 180,
  ];

  // 인스턴스별 씬 클론 + helper 영역 스트레치. useGLTF는 geometry를 캐시·공유하므로
  // 변형 대상 메시의 geometry를 deep clone한 뒤 변형해야 다른 인스턴스에 영향이 없다.
  const instance = useMemo(
    () => prepareProductInstance(scene, target),
    [scene, target.x, target.y, target.z],
  );

  return (
    <primitive
      object={instance}
      position={[position.x, position.y, position.z]}
      rotation={rotRad}
    />
  );
}

/**
 * GLB 씬을 인스턴스용으로 복제하고, helper 영역 기반으로 목표 치수에 맞춰 메시를 변형한다.
 * helper/hotspot/replaceable* 보조 노드는 렌더에서 숨긴다.
 */
function prepareProductInstance(scene: Object3D, target: Vector3): Object3D {
  const clone = scene.clone(true);

  // useGLTF 공유 geometry 보호 — 변형 대상 메시 geometry를 인스턴스 전용으로 복제.
  clone.traverse((obj) => {
    if (obj instanceof Mesh) obj.geometry = obj.geometry.clone();
  });

  const scaler = HelperScaler.build(clone);

  // 진단 계측 — window.__HELPER_DEBUG__ = true 일 때 캡처 결과 로깅 + helper 박스 표시 유지.
  const debug =
    typeof window !== 'undefined' &&
    (window as unknown as { __HELPER_DEBUG__?: boolean }).__HELPER_DEBUG__;
  if (debug) {
    // eslint-disable-next-line no-console
    console.log('[HelperScaler] target=', target.toArray(), scaler.getDiagnostics());
    const meshNames: string[] = [];
    clone.traverse((o) => {
      if (o instanceof Mesh) meshNames.push(o.name || '(unnamed)');
    });
    // eslint-disable-next-line no-console
    console.log('[HelperScaler] meshes=', meshNames);
  }

  scaler.applyResize(target);

  // 보조 노드 렌더 숨김. helper 영역 메시(L/R/T/B/F/K)와 helper/hotspot/replaceable* 그룹 숨김.
  // debug 시에는 helper 영역 메시를 보이게 유지해 어느 범위를 덮는지 눈으로 확인.
  clone.traverse((obj) => {
    const n = obj.name.toLowerCase();
    const isRegion = isHelperRegionName(obj.name);
    const isAux = n === 'helper' || n === 'hotspot' || n.startsWith('replaceable');
    if (isRegion) obj.visible = !!debug;
    else if (isAux) obj.visible = false;
  });

  return clone;
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