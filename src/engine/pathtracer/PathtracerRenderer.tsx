import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { useLightingStore } from '@/engine/stores/lightingStore';
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

  const { gl, scene, camera } = useThree();
  const ptRef = useRef<WebGLPathTracer | null>(null);
  const [samples, setSamples] = useState(0);

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

  // priority=2 — `@react-three/postprocessing` 의 EffectComposer 도 priority=1 로 동작하므로
  // path tracer 가 그 *다음* 호출되어 캔버스를 덮어쓰도록 한다. (PostFXGate 가 이미 비활성화
  // 하지만 이중 안전).
  useFrame(() => {
    const pt = ptRef.current;
    if (!enabled || !pt) return;
    try {
      pt.renderSample();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (pt as any).samples ?? 0;
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