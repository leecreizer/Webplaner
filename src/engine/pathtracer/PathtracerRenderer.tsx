import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { useCustomLightStore } from '@/engine/stores/customLightStore';
import { useLayoutStore } from '@/domain/state/layoutStore';

/**
 * GPU Path Tracer 통합 — `three-gpu-pathtracer` 기반.
 *
 * 카메라 정지 시 매 프레임 path sample을 누적해 점점 정교한 GI/반사/소프트섀도우를 표시.
 * 카메라가 움직이면 reset.
 *
 * **확인 방법** — DevTools 콘솔에 `[Pathtracer]` 로그가 찍힘:
 *  - `init OK` — 인스턴스 생성 + scene 등록 성공
 *  - `samples=N` — N번째 sample 누적 (카메라 정지 시 증가)
 *  - `error` — BVH 빌드 또는 렌더 실패
 *
 * 또 화면 우상단에 `PT: samples=N` 텍스트 상태 표시 (활성 시).
 *
 * ### 제약
 * - default false — 사용자가 명시적으로 토글
 * - MeshStandardMaterial만 path traced — 우리 floor/wall은 standard라 OK
 * - 그리기/노드 드래그 중에는 OFF 권장 (매 변경마다 BVH 재빌드 비용)
 */
export function PathtracerRenderer() {
  const enabled = useLightingStore((s) => s.pathtracerEnabled);
  const bounces = useLightingStore((s) => s.pathtracerBounces);
  const wallsLen = useLayoutStore((s) => s.walls.length);
  const spacesLen = useLayoutStore((s) => s.spaces.length);

  // ── PT 가 setScene 이후 다시 읽지 않는 광원/환경 파라미터들 ──
  // 이 값이 바뀌면 updateLights/updateEnvironment + reset 으로 재반영해야 함 (안 그러면
  // 슬라이더(소프트니스/강도/방향/env)를 바꿔도 화면이 옛 상태에 멈춰 있음).
  const sunIntensity = useLightingStore((s) => s.intensity);
  const shadowSoftness = useLightingStore((s) => s.shadowSoftness);
  const sunVisible = useLightingStore((s) => s.sunVisible);
  const azimuth = useLightingStore((s) => s.azimuth);
  const elevation = useLightingStore((s) => s.elevation);
  const envIntensity = useLightingStore((s) => s.environmentIntensity);
  const customLights = useCustomLightStore((s) => s.lights);

  const { gl, scene, camera } = useThree();
  const ptRef = useRef<WebGLPathTracer | null>(null);
  const lightDirty = useRef(false);
  const [samples, setSamples] = useState(0);

  // 광원/환경 파라미터 변경 → 다음 frame 에 재읽기 표시 (effect 순서상 light 객체가 먼저
  // 갱신된 뒤 useFrame 에서 처리되도록 dirty flag 만 set).
  useEffect(() => {
    lightDirty.current = true;
  }, [sunIntensity, shadowSoftness, sunVisible, azimuth, elevation, envIntensity, customLights]);

  // 인스턴스 생성/파기
  useEffect(() => {
    if (!enabled) {
      ptRef.current = null;
      setSamples(0);
      return;
    }
    try {
      const pt = new WebGLPathTracer(gl);
      // bounces 설정 — 라이브러리 버전에 따라 위치 다름. 두 경로 시도.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ptAny = pt as any;
      if (typeof ptAny.bounces !== 'undefined') ptAny.bounces = bounces;
      if (ptAny.tiles && typeof ptAny.tiles.set === 'function') ptAny.tiles.set(2, 2);
      // ── 노이즈 감소 (자글거림 + 수렴 속도 핵심) ──
      // MIS(Multiple Importance Sampling): 조명+환경 동시 샘플링으로 같은 sample 수에서
      // 노이즈 대폭 감소. 인테리어 같은 env-lit 씬에서 효과 가장 큼.
      if (typeof ptAny.multipleImportanceSampling !== 'undefined') {
        ptAny.multipleImportanceSampling = true;
      }
      // filterGlossyFactor: roughness 낮은 표면의 firefly(흰 반짝이 점) 억제. 0=off, 0.5~1 권장.
      if (typeof ptAny.filterGlossyFactor !== 'undefined') ptAny.filterGlossyFactor = 1.0;
      // 렌더 타겟을 renderer drawingBuffer 크기에 자동 동기화 — 창 리사이즈/DPI 시 PT 출력이
      // 캔버스에 꽉 차고 선명하게. false 면 init 시점 크기에 고정돼 작게/흐리게 보임.
      if (typeof ptAny.synchronizeRenderSize !== 'undefined') ptAny.synchronizeRenderSize = true;
      // 카메라 이동/회전 중 저해상도 path trace 로 즉시 반응 — 정지 시 full res 누적.
      ptAny.dynamicLowRes = true;
      if (typeof ptAny.lowResScale !== 'undefined') ptAny.lowResScale = 0.25;
      if (typeof ptAny.renderDelay !== 'undefined') ptAny.renderDelay = 50;
      ptAny.rasterizeScene = true;
      ptRef.current = pt;
      console.log('[Pathtracer] init OK', { bounces });
      // 글로벌 노출 — DevTools 검증
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__pathTracer = pt;
    } catch (e) {
      console.warn('[Pathtracer] init 실패', e);
    }
    return () => {
      ptRef.current = null;
      setSamples(0);
    };
  }, [enabled, gl, bounces]);

  // scene/camera/mesh 변경 시 setScene + reset.
  //
  // *핵심*: r3f 가 mesh 를 mount 하기 *전* 에 setScene 이 호출되면 빈 scene 으로 BVH 가
  // 빌드되어 path tracer 결과가 영원히 검정(empty target)이 된다. requestAnimationFrame 으로
  // *한 frame 지연* + scene mesh count 검증으로 mount 완료 보장.
  useEffect(() => {
    const pt = ptRef.current;
    if (!enabled || !pt) return;
    let cancelled = false;
    let raf: number | null = null;
    const runSetScene = async () => {
      try {
        // mesh 가 아직 없으면 다음 frame 까지 대기 — 최대 30 frame
        let attempts = 0;
        while (!cancelled && attempts < 30) {
          let meshCount = 0;
          scene.traverse((o) => {
            if ((o as { isMesh?: boolean }).isMesh) meshCount++;
          });
          if (meshCount > 0) break;
          await new Promise<void>((r) => {
            raf = requestAnimationFrame(() => r());
          });
          attempts++;
        }
        if (cancelled) return;
        let meshCountFinal = 0;
        scene.traverse((o) => {
          if ((o as { isMesh?: boolean }).isMesh) meshCountFinal++;
        });
        // setSceneAsync 는 setBVHWorker 가 사전 설정되어야 동작 — 우리는 worker 안 쓰고
        // 동기 setScene 으로 메인 스레드 BVH 빌드 (씬이 수십 mesh 정도라 OK).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ptAny = pt as any;
        pt.setScene(scene, camera);
        if (cancelled) return;
        ptAny.reset?.();
        setSamples(0);
        console.log('[Pathtracer] setScene OK', {
          walls: wallsLen,
          spaces: spacesLen,
          meshes: meshCountFinal,
          attempts,
        });
      } catch (e) {
        console.warn('[Pathtracer] setScene 실패', e);
      }
    };
    runSetScene();
    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [enabled, scene, camera, wallsLen, spacesLen]);

  // 카메라 이동 감지용 — 직전 frame 의 matrixWorld 해시
  const prevCamKey = useRef<string>('');

  // priority=2 — EffectComposer(priority=1) *다음* 호출되어 캔버스를 덮어쓰도록.
  useFrame(() => {
    const pt = ptRef.current;
    if (!enabled || !pt) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ptAny = pt as any;
      // ── 핵심: 카메라가 움직이면 updateCamera() 호출 ──
      // WebGLPathTracer 는 renderSample() 만으로는 카메라 변경을 감지하지 못한다.
      // updateCamera() 가 (1) 누적 sample reset, (2) dynamicLowRes 의 "움직이는 중" 타이머를
      // 트리거한다. 이게 없으면 회전해도 처음 수렴한 frame 에 *멈춰* 있고 저해상도 모드도 안 켜짐.
      camera.updateMatrixWorld();
      const key = camera.matrixWorld.elements.join(',');
      const moved = key !== prevCamKey.current;
      if (moved) {
        prevCamKey.current = key;
        if (typeof ptAny.updateCamera === 'function') ptAny.updateCamera();
      }
      // 광원/환경 변경 반영 — setScene 이후 PT 는 자동으로 다시 안 읽으므로 명시적 갱신.
      // effect 가 dirty 를 set 한 뒤 이 frame 에서 처리 (light 객체는 이미 갱신된 상태).
      if (lightDirty.current) {
        lightDirty.current = false;
        ptAny.updateLights?.();
        ptAny.updateEnvironment?.();
        ptAny.updateCamera?.(); // 누적 reset — 새 광원으로 다시 수렴
        setSamples(0);
      }
      // 정지 상태면 frame 당 여러 sample 누적 → 벽시계 기준 수렴 가속 (60fps 유지보다
      // 빠른 수렴 우선). 움직이는 중엔 1회만 (반응성 우선). 정지 8 pass = 깨끗해지는 속도 ↑.
      const passes = moved ? 1 : 8;
      for (let i = 0; i < passes; i++) pt.renderSample();
      const s = ptAny.samples ?? 0;
      if (Math.floor(s) % 10 === 0 && Math.floor(s) !== Math.floor(samples)) {
        setSamples(s);
        if (Math.floor(s) > 0 && Math.floor(s) % 30 === 0) {
          console.log('[Pathtracer] samples=', Math.floor(s));
        }
      }
    } catch (e) {
      console.warn('[Pathtracer] renderSample 실패', e);
    }
  }, 2);

  // 상태 overlay — 활성 시 우상단에 sample 카운트
  useEffect(() => {
    if (!enabled) return;
    const el = document.createElement('div');
    el.id = 'pathtracer-status';
    el.style.cssText = `
      position: fixed; top: 80px; right: 16px; z-index: 100;
      padding: 6px 10px; background: rgba(0,0,0,0.7); color: #4ade80;
      border: 1px solid #4ade80; border-radius: 4px;
      font: 11px monospace; pointer-events: none;
    `;
    el.textContent = 'PT: 초기화 중…';
    document.body.appendChild(el);
    const interval = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pt = (window as any).__pathTracer;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = pt?.samples ?? 0;
      el.textContent = `PT: samples=${Math.floor(s)}`;
    }, 500);
    return () => {
      clearInterval(interval);
      el.remove();
    };
  }, [enabled]);

  return null;
}