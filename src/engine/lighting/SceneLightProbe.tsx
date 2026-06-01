import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  CubeCamera,
  LightProbe,
  Vector3,
  WebGLCubeRenderTarget,
  HalfFloatType,
  LinearMipMapLinearFilter,
} from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { useLayoutStore } from '@/domain/state/layoutStore';

/**
 * three.js **LightProbe + CubeCamera** 통합 — `webgl_lightprobe_cubecamera` 예제 패턴.
 *
 * 동작:
 * 1. spaces 중앙(또는 씬 원점)에 `CubeCamera`를 두고 6면 capture → `WebGLCubeRenderTarget`
 * 2. `LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget)` 로 SH(spherical harmonics)
 *    계수를 가진 `LightProbe` 생성
 * 3. LightProbe를 scene에 add → 모든 MeshStandardMaterial이 *IBL ambient*를 받음 (간접광 시뮬)
 *
 * - 매 카메라 변경 시는 무거우니 spaces/walls 변경 시 + 광원 방향 변경 시만 재캡처
 * - default off (lightProbeEnabled). 사용자가 명시적으로 토글
 * - 작은 cube target (128px) — 비용 절감
 */
export function SceneLightProbe() {
  const enabled = useLightingStore((s) => s.lightProbeEnabled);
  const intensity = useLightingStore((s) => s.lightProbeIntensity);
  const azimuth = useLightingStore((s) => s.azimuth);
  const elevation = useLightingStore((s) => s.elevation);
  const wallsLen = useLayoutStore((s) => s.walls.length);
  const spacesLen = useLayoutStore((s) => s.spaces.length);
  const nodes = useLayoutStore((s) => s.nodes);
  const { gl, scene } = useThree();

  const probeRef = useRef<LightProbe | null>(null);

  // spaces 중앙 — cube camera 위치 anchor
  const center = useMemo(() => {
    if (nodes.length === 0) return new Vector3(0, 1.2, 0);
    let sx = 0, sz = 0;
    for (const n of nodes) {
      sx += n.position.x;
      sz += n.position.z;
    }
    return new Vector3(sx / nodes.length, 1.2, sz / nodes.length);
  }, [nodes]);

  // LightProbe 인스턴스 — scene에 한 번 add, intensity만 갱신
  useEffect(() => {
    if (!enabled) {
      if (probeRef.current) {
        scene.remove(probeRef.current);
        probeRef.current = null;
      }
      return;
    }
    const probe = new LightProbe();
    probe.intensity = intensity;
    scene.add(probe);
    probeRef.current = probe;
    return () => {
      scene.remove(probe);
      probeRef.current = null;
    };
  }, [enabled, scene, intensity]);

  // intensity 라이브 갱신
  useEffect(() => {
    if (probeRef.current) probeRef.current.intensity = intensity;
  }, [intensity]);

  // cube capture + SH 추출 — spaces/walls/광원 방향 변경 시 + enabled toggle 시 재실행
  useEffect(() => {
    if (!enabled || !probeRef.current) return;
    const target = new WebGLCubeRenderTarget(128, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipMapLinearFilter,
    });
    const cubeCam = new CubeCamera(0.1, 1000, target);
    cubeCam.position.copy(center);
    let cancelled = false;
    (async () => {
      try {
        const probe = probeRef.current;
        if (!probe) return;
        // probe를 잠시 disable해 self-capture 영향 줄이기
        const originalIntensity = probe.intensity;
        probe.intensity = 0;
        cubeCam.update(gl, scene);
        probe.intensity = originalIntensity;
        // LightProbeGenerator.fromCubeRenderTarget — Promise 반환 (WebGL 비동기 readback)
        const newProbe = await LightProbeGenerator.fromCubeRenderTarget(gl, target);
        if (cancelled || !probeRef.current) return;
        probeRef.current.sh.copy(newProbe.sh);
        console.log('[LightProbe] 재캡처 + SH 추출 완료');
      } catch (e) {
        console.warn('[LightProbe] capture 실패', e);
      }
    })();
    return () => {
      cancelled = true;
      target.dispose();
    };
  }, [enabled, gl, scene, center, wallsLen, spacesLen, azimuth, elevation]);

  return null;
}