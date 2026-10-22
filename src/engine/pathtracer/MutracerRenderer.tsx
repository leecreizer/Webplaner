import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { HalfFloatType, Matrix4, Quaternion, Vector2, Vector3, WebGLRenderTarget } from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Engine, RectLight, RenderLoop, THREESync } from '@meimu/mutracer';
import { renderCausticsOverlay } from '@/engine/lighting/caustics/Caustics';
import { useLightingStore } from '@/engine/stores/lightingStore';
import { useMutracerStore } from '@/engine/stores/mutracerStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { isGizmoDragging } from '@/features/models/gizmoGuard';

/**
 * MuTracer 경로 추적 — `@meimu/mutracer` (WebGPU 우선, WebGL 2 대체).
 *
 * r3f 캔버스(WebGL)와 GPU 컨텍스트를 공유할 수 없어 **별도 캔버스를 r3f 캔버스 아래에 깐다**.
 * r3f 캔버스는 투명하게 비우고 편집 보조물(기즈모·선택 표시·마커)만 그려 그 위에 얹는다
 * ({@link OverlayPass}) — 사진 같은 장면 위에서 그대로 클릭·기즈모 편집이 된다.
 * 장면·카메라는 THREESync 가 r3f 의 three 장면을 그대로 읽어 변경분만 반영한다
 * (메시 이동·재질 수정은 자동, 카메라 이동 중엔 저해상도 미리보기 → 멈추면 누적).
 *
 * **확인 방법** — DevTools 콘솔 `[MuTracer]` 로그, 화면 우상단 `MT: …` 상태,
 * `window.__mutracer = { engine, sync, loop }`.
 *
 * ### 제외 대상 (= r3f 가 위에 그리는 편집 보조물, {@link isOverlay})
 * - MeshBasicMaterial 메시 — 기즈모(TransformControls)·노드 마커·고스트 등.
 *   MuTracer 는 이것을 발광(unlit) 재질로 바꿔 장면에 빛을 더하므로 빼야 한다.
 * - Line·LineSegments·Points·Sprite — MuTracer 가 메시만 변환하므로 원래 빠진다.
 * - ShaderMaterial(drei Sky·Grid) — MuTracer 가 경고와 함께 자동으로 건너뜀.
 *   하늘은 scene.environment(HDR) 가 대신한다.
 *
 * ### 제약
 * - scene.environmentIntensity 는 MuTracer 가 읽지 않는다 → 환경광 세기 슬라이더 미반영.
 * - HemisphereLight 는 변환 표에 없음 → 미반영.
 */
/** 편집 보조물을 그릴 three 레이어 — MuTracer 는 레이어를 보지 않으므로 서로 간섭 없음. */
const OVERLAY_LAYER = 31;
const _withDepth: THREE.Object3D[] = [];

/** MuTracer 가 렌더하지 않고 r3f 가 위에 그릴 객체 — 위 「제외 대상」과 같은 판정. */
function isOverlay(o: THREE.Object3D): boolean {
  const any = o as THREE.Object3D & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean; isMesh?: boolean; material?: THREE.Material | THREE.Material[] };
  if (any.isLine || any.isPoints || any.isSprite) return true;
  if (!any.isMesh || !any.material) return false;
  const mats = Array.isArray(any.material) ? any.material : [any.material];
  // drei <Line>(두꺼운 선 LineSegments2 + LineMaterial)은 메시라 위 선 판정에 안 걸렸고, 경로 추적은 셰이더 재질을
  // 건너뛰어 어디에도 그려지지 않았다 — 벽 그리기 미리보기·가이드·치수선이 안 보였다(실측)
  return mats.every((m) => (m as THREE.MeshBasicMaterial).isMeshBasicMaterial || (m as { isLineMaterial?: boolean }).isLineMaterial);
}

/**
 * 경로 추적이 지금 화면을 그리는가 — 2D 도면에선 끈다(사용자 요청 2026-10-22). 그리드·PostFX·부드러운 그림자·카메라 관성처럼
 * 「경로 추적이면 끄는」 래스터 기능의 기준. 2D 에서도 경로 추적 엔진은 없애지 않고 멈춰만 둔다(MutracerRenderer)
 */
export function usePathTracingActive(): boolean {
  const pt = useLightingStore((s) => s.pathtracerEnabled);
  const mutracer = useLightingStore((s) => s.giMode === 'mutracer');
  const is2D = useViewStore((s) => s.viewMode === '2D');
  return pt || (mutracer && !is2D);
}

export function MutracerRenderer() {
  const enabled = useLightingStore((s) => s.giMode === 'mutracer');
  // 하이브리드 켜고 끄기만 렌더 루프를 다시 만든다(미리보기 렌더는 만들 때만 정할 수 있다). 나머지 설정은 실행 중 반영
  const hybridMode = useMutracerStore((s) => s.mt.hybrid);
  const { gl, scene, camera: current } = useThree();
  // 엔진은 원근 카메라에 묶는다 — 2D 에선 직교 카메라가 기본이 되는데, 그걸 따라가면 2D↔3D 마다 엔진을 새로 만들었다
  // (59C 준비 약 20초). 원근 카메라는 2D 에서도 남아 있다(App SceneCamera)
  const perspective = useRef(current);
  if ((current as THREE.PerspectiveCamera).isPerspectiveCamera) perspective.current = current;
  const camera = perspective.current;

  useEffect(() => {
    if (!enabled) return;
    const host = gl.domElement.parentElement;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'mutracer-canvas';
    canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:0;';
    host.insertBefore(canvas, gl.domElement);
    // r3f 캔버스(투명, 편집 보조물만)를 MuTracer 캔버스 위로
    const r3fStyle = { position: gl.domElement.style.position, zIndex: gl.domElement.style.zIndex };
    const raise = () => {
      if (gl.domElement.style.position !== 'relative') gl.domElement.style.position = 'relative';
      if (gl.domElement.style.zIndex !== '1') gl.domElement.style.zIndex = '1';
    };
    raise();
    // drei <Html>(공간 이름표·투어 점 등)이 붙을 때마다 r3f 캔버스의 z-index·position 을 지운다(occlude 아닐 때 null 대입).
    // 그러면 MuTracer 캔버스(absolute·z 0)가 r3f 캔버스를 덮어 기즈모·선택 상자가 안 보였다 — 지워지면 바로 되돌린다
    const styleWatch = new MutationObserver(raise);
    styleWatch.observe(gl.domElement, { attributes: true, attributeFilter: ['style'] });

    const status = document.createElement('div');
    status.id = 'mutracer-status';
    status.style.cssText = `
      position: fixed; top: 80px; right: 16px; z-index: 100;
      padding: 6px 10px; background: rgba(0,0,0,0.7); color: #60a5fa;
      border: 1px solid #60a5fa; border-radius: 4px;
      font: 11px monospace; pointer-events: none;
    `;
    status.textContent = 'MT: 초기화 중…';
    document.body.appendChild(status);

    const engine = new Engine({ canvas });
    // 재질 텍스처 예산 — 기본 384MiB 는 Homvue 평면(텍스처 609장, 6.5억 화소)을 36% 로 줄여 4K 화면에서 흐렸다
    // (getDiagnostics().textureAtlas.scale 실측). 1.5GiB 면 약 76%.
    engine.textureAtlasBudgetBytes = useMutracerStore.getState().mt.textureBudgetMiB * 1024 * 1024;
    // 첫 가속 구조부터 설정한 방식으로 — 나중에 바꾸면 한 번 더 만든다
    engine.bvhBuilder = useMutracerStore.getState().mt.bvhBuilder;
    engine.bvhLayout = useMutracerStore.getState().mt.bvhLayout;

    const sync = new THREESync(engine, {
      scene,
      camera: camera as THREE.PerspectiveCamera,
      // isOverlay 와 같은 기준 — 여기서 빠진 것을 OverlayPass 가 위에 그린다
      // 커스틱 조각은 경로 추적 장면에 넣지 않는다 — 화면 위에 덧그린다(renderCausticsOverlay)
      // 경로 추적이 못 그리는 재질(선 LineMaterial·셰이더·커스틱 조각)과 발광 보조물(MeshBasic)은 조용히 뺀다.
      // undefined 로 두면 THREESync 가 매 프레임 장면을 훑을 때마다 물체째 console.warn 을 찍었다 — 벽 그리기 선이 있으면
      // 프레임마다 수십 건(로그 26만 줄, 실측). 물체를 붙든 로그가 쌓이고 디버그 도구가 붙어 있으면 매번 직렬화한다
      convertMaterial: (m) =>
        m.userData.causticPatch ||
        (m as THREE.MeshBasicMaterial).isMeshBasicMaterial ||
        (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial && m.userData.mutracerShadowCatcher !== true)
          ? null
          : undefined,
      // 굴절·커스틱을 끈 유리(래스터는 반투명) — 경로 추적에선 얇은 투과 판으로 바꾼다.
      // 반투명(투명도)이면 그림자 광선이 투명도만큼 빠져 그림자가 거의 사라지는데, 투과 재질은 그림자 광선을 막아
      // 보통 그림자가 된다. 얇은 판이라 휘지 않고(굴절 없음) 유리 속을 오가지 않아 느려지지 않는다
      // 사각 조명 퍼짐(spread) — three 에 없는 값이라 기본 변환은 늘 1(반구 전체)이다. 퍼짐을 정한 조명만 직접 만든다
      // (CustomLights 가 userData.mutracerSpread 를 넣고 값이 바뀔 때마다 mutracerVersion 을 올린다 — 그때만 다시 부른다)
      convertLight: (src) => {
        const rl = src as THREE.RectAreaLight;
        if (!rl.isRectAreaLight || rl.userData.mutracerSpread == null) return undefined;
        rl.updateWorldMatrix(true, false);
        const e = rl.matrixWorld.elements;
        const q = rl.getWorldQuaternion(new Quaternion()).normalize();
        const p = rl.getWorldPosition(new Vector3());
        const light = new RectLight({
          size: [rl.width * Math.hypot(e[0], e[1], e[2]), rl.height * Math.hypot(e[4], e[5], e[6])],
          color: rl.color.toArray() as [number, number, number],
          intensity: rl.intensity,
          spread: rl.userData.mutracerSpread as number,
        });
        light.transform = new Matrix4().compose(p, q, new Vector3(1, 1, 1)).elements.slice();
        return light;
      },
      onMeshConverted: (mesh, source, group) => {
        const src = Array.isArray(source.material) ? source.material[group.materialIndex ?? 0] : source.material;
        const t = src?.userData.glassTranslucent as number | undefined;
        if (t == null) return;
        for (const mat of mesh.materials) {
          mat.alphaMode = 'opaque';
          mat.geometryOpacity = 1;
          mat.transmissionWeight = t;
          mat.geometryThinWalled = true;
        }
      },
    });
    // 변경이 바로 보이도록 — 샘플이 쌓이기를 기다리지 않고 디노이저가 1·2·4·8… 샘플마다 화면을 정리한다.
    // 디노이저가 있으니 256 spp 면 충분 — 1024 대비 완료가 약 4배 빠르다.
    // 미리보기 없음 — 카메라가 움직이는 동안과 첫 샘플 전에는 래스터를 보여 준다(OverlayPass, 하이브리드).
    // 경로 추적 미리보기는 이 장면에서 저해상도도 매끄럽지 않았고, 켠 직후엔 준비 8.5초 + 셰이더 7초 동안 검은 화면이었다.
    // 하이브리드를 끄면(기본) 움직이는 동안 저해상도 경로 추적 미리보기 — WebGPU 면 OIDN small 이 매 샘플 정리(아래 init).
    const loop = new RenderLoop(engine, {
      sync,
      preview: hybridMode
        ? false
        : {
            // 해상도·시간 예산은 라이브러리 기본(50% → 12.5% 자동, 80ms) — MuTracer 데모와 같다. 예전 12ms·16ms 목표는
            // 미리보기 샘플이 한 프레임 안에 안 끝나 노이즈 제거 전 날것이 자주 보였다
            // 반사 4회 — 2회면 실내 조명 간접광이 덜 들어와 움직이는 동안 눈에 띄게 어두웠다(59C 거실 화면 밝기 73~81 ↔
            // 4회 97~103, 실측)
            bounces: 4,
            denoiser: { type: 'jnlm', schedule: 'every-sample' },
          },
      // 움직이는 동안 매끄럽게(MuTracer 데모 「Live」 설정) — 미리보기 노이즈 제거가 끝날 때까지 다음 카메라를 반영하지
      // 않아 화면에 나오는 모든 미리보기가 정리된 그림이다. 끄면(예전) 노이즈 제거가 끝나기 전에 날것 샘플이 나가 잡티투성이였다
      coalesceSceneUpdates: true,
      // 수렴 속도: 기본(프레임당 1샘플, 21ms 예산)은 GPU 가 샘플 하나에 ~5ms 쓰고 나머지를 논다.
      // 프레임당 여러 샘플 + 50ms 예산 → 실측 2.2배(11.3 → 24.5 spp/s, 같은 장면·시점). 조작 중엔
      // 래스터가 화면을 맡아 반응성은 그대로이고, 화질 손해도 없다.
      // 멈춘 직후 바로 깨끗하게 (Homvue 43 거실, 기준 = 40초 수렴 화면과의 RMSE 실측):
      // 해상도 1.0 + 1·4·8… 샘플마다 디노이즈 → 1초 0~1샘플·오차 62(화면이 확 어두워졌다 밝아짐)
      // 해상도 0.75 + 매 샘플 디노이즈        → 1초 5~7샘플·오차 14~20, 2초 오차 12 (두 번 재서 같은 결과)
      // 픽셀이 56%라 첫 샘플이 훨씬 빨리 나오고, 디노이저가 매 샘플 화면을 갱신한다.
      // 해상도는 1.0 — 0.75 는 멈춘 직후 빨리 깨끗해지지만 4K 목표에선 화면이 흐리다. 대신 WebGPU 는
      // 매 샘플 OIDN 이 1~2 샘플에서도 정리한다(아래 init).
      final: {
        bounces: useLightingStore.getState().pathtracerBounces,
        maxSamples: 256,
        resolutionScale: 1,
        // 그래픽 카드에 일감을 몰아 넘기지 않는다 — 카메라를 다시 움직이는 순간 래스터 화면이 이미 넘겨 둔 경로 추적
        // 일감(샘플 여러 개 + 디노이즈)이 끝나기를 기다려 프레임이 수백 ms 멈췄다. 한 프레임에 샘플 하나·33ms 까지.
        // (16ms 는 멈춘 뒤 첫 경로 추적 화면이 1.6초로 늦었고 33ms 는 1.0초, 움직임 시작 지연은 같았다 — 실측)
        allowMultipleSamplesPerFrame: false,
        timeBudgetMs: 33,
        denoiser: { type: 'jnlm', schedule: 'progressive' },
      },
    });

    // 캔버스 픽셀 크기 = 화면 크기 × max(DPR, 렌더 해상도 배율). 배율 2 면 DPR 1 화면(1920)에서도 4K 로 그려
    // 브라우저가 줄여 보여 준다(슈퍼샘플링) — 예전엔 DPR 1 화면 × 최종 0.75 = 1440 폭이라 1K 급으로 흐렸다.
    // 전체 화소는 3840×2160 까지(그 이상은 수렴만 느려지고 화면에서 구분이 안 된다).
    const MAX_PIXELS = 3840 * 2160;
    const resize = () => {
      const ratio = Math.max(Math.min(window.devicePixelRatio, 2), useLightingStore.getState().mutracerRenderScale);
      let w = Math.max(1, host.clientWidth * ratio);
      let h = Math.max(1, host.clientHeight * ratio);
      const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      w = Math.round(w * k);
      h = Math.round(h * k);
      engine.display.setSize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    // ===== 설정 반영 — 조명·렌더 패널(lightingStore 일부 · mutracerStore) =====
    let denoiserKey = '';
    const applyDenoiser = () => {
      const m = useMutracerStore.getState().mt;
      // OIDN 은 WebGPU 전용 — WebGL 이거나 아직 초기화 전이면 JNLM
      const kind = m.denoiser === 'oidn' && engine.backend !== 'webgpu' ? 'jnlm' : m.denoiser;
      const key = `${kind}|${m.oidnModel}|${m.denoiseSchedule}`;
      if (key === denoiserKey) return;
      denoiserKey = key;
      if (kind === 'none') void loop.final.setDenoiser(null);
      else if (kind === 'jnlm') void loop.final.setDenoiser({ type: 'jnlm', schedule: m.denoiseSchedule });
      else
        loop.final.setDenoiser({ type: 'oidn', model: m.oidnModel, schedule: m.denoiseSchedule }).catch((e) => {
          console.warn('[MuTracer] OIDN 로드 실패 — JNLM 으로', e);
          denoiserKey = 'jnlm-fallback';
          void loop.final.setDenoiser({ type: 'jnlm', schedule: m.denoiseSchedule });
        });
    };
    const apply = () => {
      const m = useMutracerStore.getState().mt;
      const l = useLightingStore.getState();
      const f = loop.final;
      // 샘플링·성능 — 같은 값이면 다시 넣지 않는다(일부는 바꾸면 누적이 처음부터 다시 시작한다)
      const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
        if (f[k] !== v) f[k] = v;
      };
      set('bounces', l.pathtracerBounces);
      set('maxSamples', m.maxSamples);
      set('timeBudgetMs', m.timeBudgetMs);
      set('allowMultipleSamplesPerFrame', m.multiSamplesPerFrame);
      set('samplingPattern', m.samplingPattern);
      set('directLightCandidates', m.directLightCandidates);
      set('clamping', m.clamping);
      set('alphaBlendStrategy', m.alphaBlendStrategy);
      set('dispersionWavelengths', m.dispersionWavelengths);
      set('bevel', m.bevel);
      set('bevelSamples', m.bevelSamples);
      const budget = m.textureBudgetMiB * 1024 * 1024;
      if (engine.textureAtlasBudgetBytes !== budget) engine.textureAtlasBudgetBytes = budget;
      if (engine.bvhBuilder !== m.bvhBuilder) engine.bvhBuilder = m.bvhBuilder;
      if (engine.bvhLayout !== m.bvhLayout) engine.bvhLayout = m.bvhLayout;
      // 화면 표시 — 합성 단계라 누적 샘플을 버리지 않는다. 톤매핑·노출은 래스터와 같은 패널 값
      const d = engine.display;
      d.toneMapping = l.toneMapping === 'none' ? 'linear' : l.toneMapping;
      d.toneMappingExposure = l.toneMappingExposure;
      d.contrast = m.contrast;
      d.saturation = m.saturation;
      d.temperature = m.temperature;
      d.tint = m.tint;
      d.vignette = m.vignette;
      d.bloomIntensity = m.bloomIntensity;
      d.bloomThreshold = m.bloomThreshold;
      d.bloomRadius = m.bloomRadius;
      d.hdrOutputEnabled = m.hdrOutput;
      d.channel = m.channel;
      applyDenoiser();
    };
    apply();
    const offScale = useLightingStore.subscribe((s, p) => {
      if (s.mutracerRenderScale !== p.mutracerRenderScale) resize();
      apply();
    });
    const offMt = useMutracerStore.subscribe(apply);

    const t0 = performance.now();
    let firstSampleMs = 0;
    const update = () => {
      const s = loop.samples;
      if (s > 0 && !firstSampleMs) firstSampleMs = performance.now() - t0;
      status.textContent = `MT(${engine.backend ?? '…'}): ${loop.status} · samples=${s}`;
      // 프레임 체크(왼쪽 아래)가 같은 상태를 보여 주면 숨긴다 — 오른쪽 위에서 조명·렌더 패널을 가렸다
      status.style.display = useViewStore.getState().showFrameMeter ? 'none' : '';
    };
    hybrid.loop = loop;
    hybrid.ready = false;
    hybrid.running = true;
    hybrid.lastSamples = 0;
    const offStatus = loop.on('status', ({ status: st, previous }) => {
      console.log('[MuTracer] status', previous, '→', st, `${Math.round(performance.now() - t0)}ms`);
      if (st === 'preparing' || st === 'compiling') hybrid.ready = false;
      update();
    });
    const offSample = loop.on('sample', () => {
      // 지금 카메라·장면의 경로 추적 샘플이 READY_SAMPLES 개 쌓였다 → 래스터에서 넘어간다.
      // 첫 샘플은 디노이저 결과가 샘플마다 크게 달라 바로 보여 주면 번쩍인다(사용자 보고 「깜빡임」)
      if (loop.samples >= useMutracerStore.getState().mt.readySamples) hybrid.ready = true;

      update();
    });
    const offError = engine.on('error', (e) => console.warn('[MuTracer] error', e));

    // 백엔드가 정해지면 디노이저를 다시 고른다 — OIDN(학습 기반, 1~2 샘플에서도 깨끗)은 WebGPU 에서만.
    // 기본 디노이즈 시점은 1·2·4·8… 샘플마다 — 매 샘플은 그래픽 카드를 계속 붙잡고 화면이 매 샘플 바뀌어 깜빡여 보였다
    engine
      .init()
      .then(() => {
        console.log('[MuTracer] init OK', engine.info);
        denoiserKey = '';
        applyDenoiser();
        // 움직이는 동안 미리보기는 1~2 샘플이라 JNLM 으로는 잡티가 그대로다(화면이 점투성이, 실측) —
        // WebGPU 면 가장 빠른 OIDN small 로 매 샘플 정리(MuTracer 문서가 권하는 「카메라 이동 중 디노이즈」)
        if (engine.backend === 'webgpu' && loop.preview) {
          loop.preview.setDenoiser({ type: 'oidn', model: 'small', schedule: 'every-sample' }).catch((e) => console.warn('[MuTracer] 미리보기 OIDN 실패 — JNLM 유지', e));
        }
      })
      .catch((e) => console.warn('[MuTracer] init 실패', e));

    // 단계식 해상도 — 멈춘 직후엔 1/2 해상도로 먼저 깨끗하게, 그다음 원래 해상도로 다듬는다.
    // 화소가 1/4 이라 샘플이 4.4배 빨리 쌓인다(59C 거실 0.7 → 3.1 샘플/초, 실측). 원래 해상도로 바꾸면
    // 첫 샘플까지 2~4초 흐린 미리보기로 돌아갔으므로, 원래 해상도에 HOLD_SAMPLES 개 쌓일 때까지 화면을 바꾸지 않는다.
    // 움직이거나 장면이 바뀌면(샘플 수가 줄면) 붙잡기를 풀고 다시 1/2 부터
    // 샘플이 적을수록 화면이 어둡다(드문 밝은 간접광 점이 표시에서 잘리고 디노이저가 지운다 — 59C 거실 원래 해상도
    // 1·4·16·32 샘플 밝기 150·175·190·192, 실측). 4 샘플에 넘기면 「밝아졌다 다시 어두워짐」이 보여 1/2 해상도와 같은
    // 샘플 수가 쌓일 때까지 붙잡는다
    const HALF_SAMPLES = 16;
    const HOLD_SAMPLES = 16;
    const HOLD_MAX_MS = 20000;
    const fin = loop.final;
    let stage: 'half' | 'hold' | 'full' = 'full';
    let holdSince = 0;
    let lastFinal = 0;
    let lastSize = '';
    // 배율을 바꾸면 누적이 다음 틱에 처음부터 — 샘플 수가 바꾸기 전보다 줄어든(다시 시작된) 걸 본 뒤부터
    // 「줄었다(= 장면 변경)」를 판단한다
    let settling = false;
    let switchFrom = 0;
    const setScale = (v: number) => {
      if (fin.resolutionScale === v) return;
      fin.resolutionScale = v;
      settling = true;
      switchFrom = fin.samples;
    };
    const toHalf = () => {
      stage = 'half';
      setScale(0.5);
    };
    const progressive = (changing: boolean) => {
      const { progressiveResolution, finalResolution } = useMutracerStore.getState().mt;
      // 최종 해상도가 1/2 이하면 1/2 단계가 의미 없다 — 바로 최종으로
      if (!progressiveResolution || finalResolution <= 0.5) {
        stage = 'full';
        setScale(finalResolution);
        return;
      }
      if (stage !== 'half' && fin.resolutionScale !== finalResolution && fin.resolutionScale !== 0.5) setScale(finalResolution); // 패널에서 바꿈
      const n = fin.samples;
      if (settling) {
        if (n === 0 || n < switchFrom) settling = false;
        lastFinal = 0;
      }
      const dropped = !settling && n < lastFinal; // 장면이 바뀌어 처음부터
      lastFinal = n;
      // 창 크기가 바뀌면 캔버스가 지워진다 — 붙잡을 그림이 없으니 1/2 부터
      const size = `${engine.display.canvas.width}x${engine.display.canvas.height}`;
      const resized = size !== lastSize;
      lastSize = size;
      if (changing || resized || dropped) toHalf();
      else if (stage === 'half' && !settling && n >= HALF_SAMPLES) {
        stage = 'hold';
        holdSince = performance.now();
        setScale(finalResolution);
      } else if (stage === 'hold' && !settling && (n >= HOLD_SAMPLES || performance.now() - holdSince > HOLD_MAX_MS)) stage = 'full';
    };
    const select = loop.select;
    loop.select = (info) => {
      progressive(info.changing);
      return select(info);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const looseLoop = loop as any;
    const present = looseLoop._present.bind(loop) as (r: unknown) => boolean;
    looseLoop._present = (r: unknown) => (stage === 'hold' && !(r === fin && fin.samples >= HOLD_SAMPLES) ? false : present(r));

    loop.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__mutracer = { engine, sync, loop, hybrid, firstSampleMs: () => firstSampleMs, stage: () => stage };

    return () => {
      hybrid.loop = null;
      hybrid.ready = false;
      offStatus();
      offSample();
      offError();
      offScale();
      offMt();
      ro.disconnect();
      loop.dispose();
      sync.dispose();
      engine.dispose();
      canvas.remove();
      status.remove();
      styleWatch.disconnect();
      gl.domElement.style.position = r3fStyle.position;
      gl.domElement.style.zIndex = r3fStyle.zIndex;
      gl.domElement.style.opacity = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__mutracer;
    };
  }, [enabled, gl, scene, camera, hybridMode]);

  return enabled ? <OverlayPass /> : null;
}

/** 래스터 ↔ 경로 추적 전환 상태 — 엔진 효과와 OverlayPass(매 프레임)가 함께 본다 */
const hybrid = {
  loop: null as RenderLoop | null,

  /** 지금 카메라·장면의 경로 추적 화면이 나와 있다 */
  ready: false,
  /** 경로 추적 루프가 돌고 있다(움직이는 동안 멈춤) */
  running: true,
  lastMove: 0,
  lastSamples: 0,
  /** 경로 추적 준비 중 래스터를 한 번 그려 두었다(멈춰 있으면 다시 그리지 않아 GPU 를 경로 추적에 양보) */
  held: false,
  /** 래스터 → 경로 추적 겹쳐 바꾸기 시작 시각(0 = 안 함) */
  fadeFrom: 0,
  /** 준비 중 래스터를 아껴 그릴 때 세는 프레임 */
  heldFrames: 0,
  /** 2D 도면이라 경로 추적을 멈춰 두었다 */
  paused2D: false,
};
// 전환 설정(정지 판정 stillMs · 넘어가기 전 샘플 readySamples · 겹쳐 바꾸기 fadeMs)은 mutracerStore.
// 겹쳐 바꾸기: 래스터와 경로 추적은 밝기·색감이 달라(간접광 유무) 한 번에 바꾸면 멈출 때마다 깜빡여 보였다 —
// 위에 있는 r3f 캔버스(마지막 래스터 그림)를 투명하게 걷어 아래 경로 추적 캔버스를 드러낸다.
const _size = new Vector2();
// 움직이는 동안 마지막 경로 추적 그림을 장면에 입혀 보이는 「화면 재사용(리프로젝션)」을 시험했다가 뺐다(2026-10-22, 사용자 판단).
// 조금 돌릴 땐 깨끗했지만 사진 밖·새로 드러난 곳은 여전히 잡티였고, 장면을 한 번 더 그려 움직이는 동안 46 → 35fps
const _lastCam = new Float64Array(16); // Float32 면 반올림 때문에 매번 다르게 보여 늘 움직이는 것으로 판정된다

/**
 * MuTracer 모드의 r3f 렌더 (이 모드에선 PostFX 가 꺼져 여기가 유일한 렌더).
 *
 * 하이브리드 — 언리얼처럼 움직이는 동안은 실시간, 멈추면 고화질:
 * - 카메라가 움직이는 동안: 경로 추적을 멈추고 래스터로 전체 장면을 그린다(매끄럽게)
 * - 멈춘 뒤 첫 경로 추적 샘플이 나올 때까지(켠 직후·재질·공간 변경 직후 포함): 래스터 화면 유지 — 검은 화면 없음
 * - 경로 추적 화면이 나오면: 배경 없이 투명하게 비우고 편집 보조물만 위에 그린다
 * 장면을 잠시 바꿨다 같은 프레임 안에서 되돌리므로 MuTracer 동기화(별도 타이머)는 볼 수 없다.
 */
function OverlayPass() {
  // 래스터 화면은 후처리(EffectComposer)처럼 중간 버퍼(HalfFloat)에 그린 뒤 톤매핑·sRGB 로 내보낸다.
  // 화면에 바로 그리면 셰이더 열쇠(톤매핑·색공간)가 래스터 모드와 달라 재질 셰이더 50여 개를 그 자리에서
  // 다시 컴파일해 경로 추적을 켠 직후 35초 멈췄다(실측).
  const { rt, output } = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    const pass = new OutputPass();
    pass.renderToScreen = true;
    return { rt: target, output: pass };
  }, []);
  useEffect(
    () => () => {
      rt.dispose();
      output.dispose();
    },
    [rt, output],
  );
  useFrame(({ gl, scene, camera }) => {
    const now = performance.now();
    // 2D 도면 — 경로 추적을 멈추고 화면은 래스터(PostFX)가 그린다. 엔진·쌓은 장면은 그대로 두고 3D 로 오면 이어 그린다
    const is2D = useViewStore.getState().viewMode === '2D';
    const mtCanvas = document.getElementById('mutracer-canvas');
    if (is2D) {
      if (hybrid.loop && !hybrid.paused2D) {
        hybrid.loop.stop();
        hybrid.paused2D = true;
        if (mtCanvas) mtCanvas.style.visibility = 'hidden';
        gl.domElement.style.opacity = '1';
      }
      return;
    }
    if (hybrid.paused2D) {
      hybrid.paused2D = false;
      if (mtCanvas) mtCanvas.style.visibility = '';
      if (hybrid.loop && (useMutracerStore.getState().mt.hybrid ? hybrid.running : true)) hybrid.loop.start();
    }
    // 카메라 행렬은 렌더할 때만 갱신된다 — 래스터 화면을 그대로 두고 그리지 않는 동안(경로 추적 준비 중·첫 샘플 전)엔
    // 궤도 카메라를 돌려도 행렬이 안 바뀌어 움직임을 못 알아채고 화면이 멈춰 있었다(사용자 보고 「바로바로 적용 안 됨」)
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (_lastCam[i] !== e[i]) moved = true;
    if (moved) {
      _lastCam.set(e);
      hybrid.lastMove = now;
    }
    const m = useMutracerStore.getState().mt;
    // 기즈모로 물체를 끄는 동안도 움직이는 중 — 경로 추적은 매 프레임 처음부터 다시 쌓이므로 멈춰 두고,
    // 래스터를 매 프레임 그려 물체가 손을 따라 움직여 보이게 한다
    if (isGizmoDragging()) hybrid.lastMove = now;
    const moving = now - hybrid.lastMove < m.stillMs;

    const loop = hybrid.loop;
    // 하이브리드 끔 — 경로 추적이 움직이는 동안에도 미리보기로 화면을 맡는다(GI 유지). 래스터는 경로 추적
    // 그림이 아직 없을 때(평면을 연 직후·장면 준비·셰이더 컴파일 중)만 — 그 뒤엔 겹쳐 바꾸고 편집 보조물만 그린다
    if (!m.hybrid && loop) {
      const busy = loop.status === 'preparing' || loop.status === 'compiling';
      if (busy) hybrid.ready = false;
      else if (loop.samples > 0 || loop.status === 'previewing') hybrid.ready = true;
    } else if (loop) {
      if (moving && hybrid.running) {
        loop.stop();
        hybrid.running = false;
        hybrid.ready = false;
      } else if (!moving && !hybrid.running) {
        loop.start();
        hybrid.running = true;
      }
      if (loop.samples < hybrid.lastSamples) hybrid.ready = false; // 장면 편집으로 다시 시작
      hybrid.lastSamples = loop.samples;
    }
    if (!hybrid.ready) {
      hybrid.fadeFrom = 0;
      if (gl.domElement.style.opacity !== '1') gl.domElement.style.opacity = '1';
      // 경로 추적 준비 중(멈춘 뒤 첫 화면 전)엔 그래픽 카드를 양보하려고 래스터를 아껴 그리되, 초당 15장은 다시 그린다 —
      // 아예 안 그리면 그동안 클릭한 선택 상자·기즈모가 경로 추적 화면이 나올 때(약 3초)까지 안 보였다(「바로 선택이 안 됨」)
      hybrid.heldFrames++;
      if (moving || !hybrid.held || hybrid.heldFrames % 4 === 0) {
        gl.getDrawingBufferSize(_size);
        if (rt.width !== _size.x || rt.height !== _size.y) rt.setSize(_size.x, _size.y);
        const clearAlpha = gl.getClearAlpha();
        const prevTarget = gl.getRenderTarget();
        gl.setClearAlpha(1);
        gl.setRenderTarget(rt);
        gl.clear(true, true, true);
        // 래스터에서 빼는 조명(userData.rasterSkip)은 이 렌더에서만 숨긴다 — 경로 추적은 전부 쓴다
        const skipped: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (o.userData.rasterSkip && o.visible) {
            o.visible = false;
            skipped.push(o);
          }
        });
        // 셰이더 미리 준비(HomvueApartment)가 이 렌더의 출력 대상을 기준으로 삼도록 표시 — 경로 추적 모드의 유일한 래스터 화면
        scene.userData.mainRasterPass = true;
        gl.render(scene, camera);
        scene.userData.mainRasterPass = false;
        for (const o of skipped) o.visible = true;
        output.render(gl, null as unknown as WebGLRenderTarget, rt, 0, false);
        gl.setRenderTarget(prevTarget);
        gl.setClearAlpha(clearAlpha);
        hybrid.held = true;
      }
      return;
    }
    if (hybrid.held) {
      // 마지막 래스터 그림을 그대로 둔 채 캔버스를 걷어 낸다 — 다 걷히면 편집 보조물만 그리는 평소 상태로
      if (!hybrid.fadeFrom) hybrid.fadeFrom = now;
      const p = m.fadeMs > 0 ? (now - hybrid.fadeFrom) / m.fadeMs : 1;
      if (p < 1) {
        const k = p * p * (3 - 2 * p);
        gl.domElement.style.opacity = String(1 - k);
        return;
      }
      hybrid.held = false;
      hybrid.fadeFrom = 0;
      gl.domElement.style.opacity = '1';
    }
    scene.traverse((o) => {
      if (isOverlay(o)) o.layers.enable(OVERLAY_LAYER);
    });
    const background = scene.background;
    const cameraMask = camera.layers.mask;
    const clearAlpha = gl.getClearAlpha();
    scene.background = null;
    camera.layers.set(OVERLAY_LAYER);
    scene.userData.overlayPass = true; // 셰이더 미리 컴파일이 이 렌더의 출력 대상(화면)을 기준으로 삼지 않게
    // PostFX(EffectComposer) 가 gl.autoClear=false 로 두므로 직접 지운다 — 안 지우면 직전 래스터
    // 프레임이 남고, 기즈모가 프레임마다 겹쳐 그려져 잔상(부채꼴)이 쌓인다.
    gl.setClearAlpha(0);
    gl.clear(true, true, true);
    // 커스틱·이동 지점 — 경로 추적 화면 위에 그리되 장면 깊이에 맞춰 앞 물체에 가려지게(userData.overlayDepth)
    _withDepth.length = 0;
    scene.traverseVisible((o) => {
      if (o.userData.overlayDepth) _withDepth.push(o);
    });
    camera.layers.mask = cameraMask;
    renderCausticsOverlay(gl, scene, camera, _withDepth);
    camera.layers.set(OVERLAY_LAYER);
    // 바로 위에서 직접 지웠다 — 자동 지우기가 켜져 있으면 방금 그린 커스틱을 지운다
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    for (const o of _withDepth) o.visible = false; // 위에서 이미 그렸다 — 나머지 보조물만 늘 위에
    gl.render(scene, camera);
    for (const o of _withDepth) o.visible = true;
    gl.autoClear = autoClear;
    gl.setClearAlpha(clearAlpha);
    scene.userData.overlayPass = false;
    camera.layers.mask = cameraMask;
    scene.background = background;
  }, 1);
  return null;
}
