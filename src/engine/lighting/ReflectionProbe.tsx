import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CubeCamera,
  HalfFloatType,
  LinearMipMapLinearFilter,
  Vector3,
  WebGLCubeRenderTarget,
  type Texture,
} from 'three';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { useLayoutStore } from '@/domain/state/layoutStore';

/**
 * **CubeCamera 반사 프로브** — 래스터 모드에서 모델↔모델·환경 실시간 반사.
 *
 * SceneLightProbe는 큐브 캡처로 SH(확산 IBL)만 뽑고 큐브맵을 버리지만, 여기서는 그 큐브맵을
 * `scene.environment`로 지정한다 → 모든 PBR 재질이 이 큐브맵을 반사하므로, 캡처에 담긴 다른
 * 모델·바닥·HDRI 배경이 표면에 비친다(= 모델끼리 서로 반사).
 *
 * - `ssrEnabled` 로 토글. 끄면 원래 HDRI 환경(scene.environment)으로 복원.
 * - 단일 프로브(공간 중앙 기준)라 시차(parallax) 근사 — 가구 프리뷰 용도로 충분.
 * - 매 프레임 6면 캡처는 비싸므로 N프레임마다 throttle. 해상도는 ssrResolutionScale로 조절.
 */
export function ReflectionProbe() {
  const enabled = useLightingStore((s) => s.ssrEnabled);
  const resolutionScale = useLightingStore((s) => s.ssrResolutionScale);
  const nodes = useLayoutStore((s) => s.nodes);
  const { gl, scene } = useThree();

  // 큐브맵 해상도 — scale 0.25~1 → 128~512
  const cubeSize = useMemo(() => {
    const s = Math.round(128 + (512 - 128) * Math.min(1, Math.max(0.25, resolutionScale)));
    return Math.max(128, Math.min(512, s));
  }, [resolutionScale]);

  // 프로브 위치 = 공간(노드) 중앙, 없으면 원점. 눈높이 근처(y≈1.2m).
  const center = useMemo(() => {
    if (nodes.length === 0) return new Vector3(0, 1.2, 0);
    let sx = 0, sz = 0;
    for (const n of nodes) { sx += n.position.x; sz += n.position.z; }
    return new Vector3(sx / nodes.length, 1.2, sz / nodes.length);
  }, [nodes]);

  const rtRef = useRef<WebGLCubeRenderTarget | null>(null);
  const camRef = useRef<CubeCamera | null>(null);
  const prevEnv = useRef<Texture | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const rt = new WebGLCubeRenderTarget(cubeSize, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipMapLinearFilter,
    });
    const cam = new CubeCamera(0.1, 1000, rt);
    cam.position.copy(center);
    rtRef.current = rt;
    camRef.current = cam;
    prevEnv.current = scene.environment; // 원래 HDRI 환경 백업
    frame.current = 0;
    return () => {
      scene.environment = prevEnv.current; // 끄면 HDRI 복원
      rt.dispose();
      rtRef.current = null;
      camRef.current = null;
    };
  }, [enabled, scene, center, cubeSize]);

  // N프레임마다 재캡처 → scene.environment 갱신 (반사가 움직임을 따라감).
  useFrame(() => {
    const cam = camRef.current;
    const rt = rtRef.current;
    if (!enabled || !cam || !rt) return;
    frame.current += 1;
    if (frame.current % 12 !== 0) return; // ~5fps 갱신 (6면 캡처 비용 절감)
    cam.position.copy(center);
    cam.update(gl, scene);
    scene.environment = rt.texture;
  });

  return null;
}
