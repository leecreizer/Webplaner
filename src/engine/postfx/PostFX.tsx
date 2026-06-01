import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  Vignette,
  DepthOfField,
  ToneMapping,
  SSAO,
} from '@react-three/postprocessing';
import {
  BlendFunction,
  ToneMappingMode as PPToneMappingMode,
  EffectComposer as PPEffectComposer,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { useLightingStore, type ToneMappingMode } from '@/engine/stores/lightingStore';

/**
 * EffectComposer 기반 사실적 렌더링 포스트프로세싱 묶음.
 *
 * AO는 **N8AO (N8python/n8ao)** — horizon-based, gpu friendly, 0beqz/realism-effects의 HBAO와 같은
 * 카테고리. `<EffectComposer>` 자식이 아닌 `composerRef.addPass()` 로 직접 mount해 ordering 제어.
 * AO Pass는 normal/depth가 필요하므로 EffectComposer 내부의 다른 effects보다 앞쪽에 삽입한다.
 */
export function PostFX() {
  const bloomEnabled = useLightingStore((s) => s.bloomEnabled);
  const bloomIntensity = useLightingStore((s) => s.bloomIntensity);
  const ssaoEnabled = useLightingStore((s) => s.ssaoEnabled);
  const ssaoIntensity = useLightingStore((s) => s.ssaoIntensity);
  const aoRadius = useLightingStore((s) => s.aoRadius);
  const aoDistanceFalloff = useLightingStore((s) => s.aoDistanceFalloff);
  const gtaoEnabled = useLightingStore((s) => s.gtaoEnabled);
  const gtaoIntensity = useLightingStore((s) => s.gtaoIntensity);
  const gtaoRadius = useLightingStore((s) => s.gtaoRadius);
  const gtaoDistanceFalloff = useLightingStore((s) => s.gtaoDistanceFalloff);
  const gtaoThickness = useLightingStore((s) => s.gtaoThickness);
  const gtaoScale = useLightingStore((s) => s.gtaoScale);
  const vignetteEnabled = useLightingStore((s) => s.vignetteEnabled);
  const vignetteIntensity = useLightingStore((s) => s.vignetteIntensity);
  const dofEnabled = useLightingStore((s) => s.dofEnabled);
  const dofFocusDistance = useLightingStore((s) => s.dofFocusDistance);
  const dofBokehScale = useLightingStore((s) => s.dofBokehScale);
  const toneMapping = useLightingStore((s) => s.toneMapping);

  const anyEnabled =
    bloomEnabled || ssaoEnabled || gtaoEnabled || vignetteEnabled || dofEnabled || toneMapping !== 'none';

  const composerRef = useRef<PPEffectComposer | null>(null);

  if (!anyEnabled) return null;

  return (
    <EffectComposer ref={composerRef} multisampling={0} stencilBuffer={false} enableNormalPass>
      {/* GTAO 토글 자리 — pmndrs/postprocessing native SSAO Effect. props 최소화로 silent
          skip 방지. radius/intensity 만 store 에 매핑, 나머지는 라이브러리 디폴트. */}
      {gtaoEnabled ? (
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={31}
          rings={4}
          radius={Math.max(0.05, gtaoRadius * 30)}
          intensity={Math.max(1, gtaoIntensity * 30)}
          luminanceInfluence={0.7}
          distanceScaling={true}
          bias={0.025}
          // pmndrs SSAOEffect required props — 모두 적절히 채워야 silent skip 없음
          worldDistanceThreshold={gtaoDistanceFalloff * 30}
          worldDistanceFalloff={gtaoDistanceFalloff * 30}
          worldProximityThreshold={gtaoThickness * 5}
          worldProximityFalloff={gtaoThickness * 5}
        />
      ) : (
        <></>
      )}
      {/* N8AO는 composer ref로 직접 addPass — children에 넣으면 Effect로 오인됨 */}
      <N8AOMount
        composerRef={composerRef}
        enabled={ssaoEnabled}
        intensity={ssaoIntensity}
        radius={aoRadius}
        distanceFalloff={aoDistanceFalloff}
      />

      {bloomEnabled ? (
        <Bloom
          intensity={bloomIntensity}
          luminanceThreshold={0.85}
          luminanceSmoothing={0.2}
          mipmapBlur
          radius={0.8}
        />
      ) : (
        <></>
      )}

      {dofEnabled ? (
        <DepthOfField
          focusDistance={dofFocusDistance / 100}
          focalLength={0.05}
          bokehScale={dofBokehScale}
        />
      ) : (
        <></>
      )}

      {vignetteEnabled ? (
        <Vignette
          eskil={false}
          offset={0.3}
          darkness={vignetteIntensity}
          blendFunction={BlendFunction.NORMAL}
        />
      ) : (
        <></>
      )}

      {toneMapping !== 'none' ? <ToneMapping mode={mapToneMappingMode(toneMapping)} /> : <></>}
    </EffectComposer>
  );
}

/**
 * N8AOPostPass를 composer에 mount/unmount하는 헤드리스 컴포넌트. 렌더 출력 없음 — useEffect로만 동작.
 *
 * - composer가 ready되면 `addPass(n8aoPass, idx)` 로 normalPass 다음에 삽입
 * - props (radius/intensity 등)는 `configuration` Proxy에 쓰면 즉시 반영
 * - 캔버스 리사이즈는 `setSize` 호출
 * - unmount/disable 시 `removePass` + `dispose`
 */
// GTAOMount 제거 — three.js native GTAOPass 는 pmndrs EffectComposer 호환 불가.
// 같은 store flag (gtaoEnabled) 는 위 PostFX 의 <SSAO> Effect 로 사용된다.

function N8AOMount({
  composerRef,
  enabled,
  intensity,
  radius,
  distanceFalloff,
}: {
  composerRef: React.MutableRefObject<PPEffectComposer | null>;
  enabled: boolean;
  intensity: number;
  radius: number;
  distanceFalloff: number;
}) {
  const { scene, camera, size } = useThree();
  const passRef = useRef<N8AOPostPass | null>(null);

  // Pass 인스턴스 생성 — scene/camera 변경 시 재생성 (보통 1회)
  const pass = useMemo(() => {
    const p = new N8AOPostPass(scene, camera, size.width, size.height);
    // postprocessing.Pass의 needsDepthTexture=true면 composer가 별도 read-only depth texture를
    // 만들어 Pass에 attach. 같은 depth-stencil RT가 read/write로 공유되며 발생하던
    // glBlitFramebuffer 에러를 차단해 깜빡임을 제거한다.
    (p as unknown as { needsDepthTexture: boolean }).needsDepthTexture = true;
    p.configuration.aoRadius = radius;
    p.configuration.distanceFalloff = distanceFalloff;
    p.configuration.intensity = intensity;
    p.configuration.aoSamples = 16;
    p.configuration.denoiseSamples = 8;
    p.configuration.denoiseRadius = 12;
    p.configuration.halfRes = false;
    p.configuration.screenSpaceRadius = false;
    p.configuration.gammaCorrection = true;
    // colorMultiply=true이면 흰색 배경에서 AO가 곱셈 모드로 깜빡임처럼 강한 대비를 만듦.
    // 어둡게만 칠하는 모드(false)로 두면 밝은 배경에서도 깔끔.
    p.configuration.colorMultiply = false;
    // accumulate는 카메라 정지 시 샘플을 누적해 노이즈를 줄이지만, 첫 프레임/리사이즈에서 검은
    // 결과가 한 프레임 보이며 깜빡일 수 있음. 안정성을 위해 비활성.
    p.configuration.accumulate = false;
    return p;
    // size는 setSize로 별도 동기화 — 의존성에서 제외해 Pass 재생성을 막음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera]);

  passRef.current = pass;

  // 리사이즈 동기화
  useEffect(() => {
    pass.setSize(size.width, size.height);
  }, [pass, size.width, size.height]);

  // 옵션 라이브 갱신 — Proxy setter가 내부 reconfigure 알아서 수행
  useEffect(() => {
    pass.configuration.intensity = intensity;
    pass.configuration.aoRadius = radius;
    pass.configuration.distanceFalloff = distanceFalloff;
  }, [pass, intensity, radius, distanceFalloff]);

  // composer 등록 / 해제
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer || !enabled) return;
    // normalPass 직후에 끼우려고 index 1 사용 (0=RenderPass)
    composer.addPass(pass, 1);
    return () => {
      composer.removePass(pass);
    };
  }, [composerRef, enabled, pass]);

  // 컴포넌트 unmount 시 dispose
  useEffect(() => {
    return () => {
      pass.dispose?.();
    };
  }, [pass]);

  return null;
}

function mapToneMappingMode(mode: ToneMappingMode): PPToneMappingMode {
  switch (mode) {
    case 'linear': return PPToneMappingMode.LINEAR;
    case 'reinhard': return PPToneMappingMode.REINHARD2;
    case 'cineon': return PPToneMappingMode.CINEON;
    case 'aces': return PPToneMappingMode.ACES_FILMIC;
    case 'agx': return PPToneMappingMode.AGX;
    default: return PPToneMappingMode.ACES_FILMIC;
  }
}