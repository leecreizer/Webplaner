import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  CubeCamera,
  HalfFloatType,
  LightProbe,
  LinearMipMapLinearFilter,
  Vector3,
  WebGLCubeRenderTarget,
} from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { useLayoutStore } from '@/domain/state/layoutStore';

/**
 * Irradiance Probe Grid 기반 간소 GI.
 *
 * 참고: https://handmade.network/p/75/monter/blog/p/7288 (Monter engine probe grid).
 *
 * ### 원리
 * 1. 공간(`spaces`) 마다 중심에 `CubeCamera` 로 360° irradiance 캡처
 * 2. `LightProbeGenerator.fromCubeRenderTarget` 으로 9개 SH(spherical harmonics) 계수 추출
 * 3. 각 SH 를 `LightProbe` 로 scene 에 추가
 *
 * three.js native 는 LightProbe 들을 *전역으로 합산* 한다 (위치 가중 보간 X). 그래도 *여러*
 * 공간의 indirect bounce color 가 더해져 single probe 보다 풍부한 ambient.
 *
 * ### 정식 trilinear probe blending 한계
 * 실제 Monter 같은 엔진은 mesh 픽셀이 가까운 8개 probe 를 trilinear blend 해야 한다.
 * 이를 위해선 *custom shader* 가 필요한데 three.js MeshStandardMaterial 의 envmap/indirect
 * pipeline 을 모두 우회해야 한다. 본 구현은 *간소 multi-probe sum* 만 제공 — 공간별
 * indirect tint 차이는 약하지만 single probe 대비 훨씬 자연스러운 GI 효과.
 *
 * ### 활성
 * `lightingStore.giMode === 'probe-grid'` 일 때만 mount. spaces / walls / 광원 방향 변경 시
 * 재캡처.
 */
export function IrradianceProbeGrid() {
  const giMode = useLightingStore((s) => s.giMode);
  const enabled = giMode === 'probe-grid';
  const intensity = useLightingStore((s) => s.lightProbeIntensity);
  const azimuth = useLightingStore((s) => s.azimuth);
  const elevation = useLightingStore((s) => s.elevation);
  const wallsLen = useLayoutStore((s) => s.walls.length);
  const spaces = useLayoutStore((s) => s.spaces);
  const { gl, scene } = useThree();

  // 공간 중심들 — probe 위치들
  const centers = useMemo(() => {
    if (!enabled) return [];
    return spaces.map((sp) => {
      const c = sp.center;
      return new Vector3(c.x, 1.2, c.z);
    });
  }, [enabled, spaces]);

  // 각 공간마다 LightProbe 생성/파기
  const probesRef = useRef<LightProbe[]>([]);
  useEffect(() => {
    if (!enabled) {
      for (const p of probesRef.current) scene.remove(p);
      probesRef.current = [];
      return;
    }
    // 기존 probe 제거 후 새로 만들기
    for (const p of probesRef.current) scene.remove(p);
    probesRef.current = centers.map(() => {
      const probe = new LightProbe();
      // 합산되므로 1/N 로 정규화해야 single probe 와 비슷한 ambient 강도 유지
      probe.intensity = intensity / Math.max(1, centers.length);
      scene.add(probe);
      return probe;
    });
    return () => {
      for (const p of probesRef.current) scene.remove(p);
      probesRef.current = [];
    };
  }, [enabled, scene, centers, intensity]);

  // intensity 라이브 갱신
  useEffect(() => {
    const n = Math.max(1, probesRef.current.length);
    for (const p of probesRef.current) p.intensity = intensity / n;
  }, [intensity]);

  // cube capture + SH 추출 — 각 probe 별로
  useEffect(() => {
    if (!enabled || probesRef.current.length === 0) return;
    const target = new WebGLCubeRenderTarget(64, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipMapLinearFilter,
    });
    const cubeCam = new CubeCamera(0.1, 1000, target);
    let cancelled = false;
    (async () => {
      try {
        // 모든 probe 를 잠시 비활성 (self-capture 영향 줄임)
        const original = probesRef.current.map((p) => p.intensity);
        for (const p of probesRef.current) p.intensity = 0;
        for (let i = 0; i < centers.length; i++) {
          if (cancelled) return;
          const probe = probesRef.current[i];
          if (!probe) continue;
          cubeCam.position.copy(centers[i]);
          cubeCam.update(gl, scene);
          const newProbe = await LightProbeGenerator.fromCubeRenderTarget(gl, target);
          if (cancelled) return;
          probe.sh.copy(newProbe.sh);
        }
        // intensity 복원
        for (let i = 0; i < probesRef.current.length; i++) {
          probesRef.current[i].intensity = original[i];
        }
        console.log('[ProbeGrid] 재캡처 + SH 추출 완료', { probes: centers.length });
      } catch (e) {
        console.warn('[ProbeGrid] capture 실패', e);
      }
    })();
    return () => {
      cancelled = true;
      target.dispose();
    };
  }, [enabled, gl, scene, centers, wallsLen, azimuth, elevation]);

  return null;
}