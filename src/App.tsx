import { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  Environment,
  PerspectiveCamera,
  OrthographicCamera,
  SoftShadows,
} from '@react-three/drei';
import { PCFShadowMap, ACESFilmicToneMapping, MOUSE, type PointLight } from 'three';
import { ShadowDemand } from '@/engine/lighting/ShadowDemand';
import { PlanScene } from '@/features/scene/PlanScene';
import { WallDrawingTool } from '@/features/drawing/WallDrawingTool';
import {
  useLightingStore,
  sphericalToCartesian,
  shadowMapSizeFor,
} from '@/engine/stores/lightingStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { PostFX } from '@/engine/postfx/PostFX';
import { NodeMarkers } from '@/features/drawing/NodeMarkers';
import { SunGizmo } from '@/features/scene/SunGizmo';
import { SpaceLightmap } from '@/engine/lighting/SpaceLightmap';
import { SceneLightProbe } from '@/engine/lighting/SceneLightProbe';
import { ReflectionProbe } from '@/engine/lighting/ReflectionProbe';
import { IrradianceProbeGrid } from '@/engine/lighting/IrradianceProbeGrid';
import { ImportedModels } from '@/features/models/ImportedModels';
import { DynamicSky } from '@/engine/lighting/DynamicSky';
import { PathtracerRenderer } from '@/engine/pathtracer/PathtracerRenderer';
import { CustomLights } from '@/engine/lighting/CustomLights';
import { EditTool } from '@/features/editing/EditTool';
import { EditOverlay } from '@/features/editing/EditOverlay';
import { Toolbar } from './ui/Toolbar';
import { LightingPanel } from './ui/LightingPanel';
import { LightInspector } from './ui/LightInspector';
import { MeshInspector } from './ui/MeshInspector';
import { SceneOutliner } from './ui/SceneOutliner';
import { BuiltinLightInspector } from './ui/BuiltinLightInspector';
import { ModelInspector } from './ui/ModelInspector';
import { SpaceModuleInspector } from './ui/SpaceModuleInspector';
import { HostProvider } from './host/HostContext';
import type { HostEventHandlers } from './host/HostEvents';
import { useImportedModelStore } from '@/features/models/importedModelStore';
import { useMeshSelectionStore } from '@/features/selection/meshSelectionStore';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { ProductPlacement } from '@/features/placement/ProductPlacement';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';
import { ModulePlacement } from '@/features/spaceModules/ModulePlacement';
import { startModuleWallSync } from '@/features/spaceModules/syncModuleWalls';
import { ModulePalette } from './ui/ModulePalette';
import { OpeningConflictDialog } from './ui/OpeningConflictDialog';

/**
 * HomePlanner3 루트 컴포넌트.
 *
 * ### 렌더링 품질
 * - **PCFSoftShadowMap** 기본 (soft shadow) + light remount로 shadowMapSize 변경 즉시 반영
 * - **ACES Filmic** tone mapping (실시간 전환 가능) + sRGB color space
 * - **HDR Environment** preset 10종 (apartment/city/dawn/sunset 등)
 * - **PostFX**: Bloom + SSAO + Vignette + ToneMapping (+옵션 DOF)
 *
 * ### 카메라
 * - **3D**: PerspectiveCamera + OrbitControls 자유 회전
 * - **2D**: OrthographicCamera 탑뷰, 회전 비활성 (PAN + ZOOM만)
 */
export interface AppProps {
  handlers?: HostEventHandlers;
  showCeiling?: boolean;
  showProducts?: boolean;
  showToolbar?: boolean;
  showLightingPanel?: boolean;
}

export default function App({
  handlers,
  showCeiling = true,
  showProducts = true,
  showToolbar = true,
  showLightingPanel = true,
}: AppProps = {}) {
  // 기본 셋팅: 크기 10 흰색 평면(plane)을 1회 배치 (벽/공간 생성 없음)
  useEffect(() => {
    const st = useImportedModelStore.getState();
    if (st.models.length === 0) {
      const id = st.addPrimitive('plane');
      st.update(id, { scale: [10, 10, 10], position: [0, 0, 0], isGround: true });
      st.select(null);
    }
  }, []);
  // 공간 모듈 → layoutStore 벽 실시간 동기화 (Task 3)
  useEffect(() => startModuleWallSync(), []);
  return (
    <HostProvider handlers={handlers}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {showToolbar && <Toolbar />}
        <ModulePalette />
        {showLightingPanel && <LightingPanel />}
        {showLightingPanel && <LightInspector />}
        {showLightingPanel && <MeshInspector />}
        {showLightingPanel && <SceneOutliner />}
        {showLightingPanel && <BuiltinLightInspector />}
        {showLightingPanel && <ModelInspector />}
        <SpaceModuleInspector />
        <OpeningConflictDialog />
        <Canvas
          // 빈 곳 클릭(씬 오브젝트 미적중) → 배치 상품 선택 해제. 기즈모 클릭은 이벤트를
          // TransformControls가 가로채므로 여기로 오지 않음.
          onPointerMissed={(e) => {
            if ((e as MouseEvent).button !== 0) return;
            const st = usePlacedProductStore.getState();
            if (st.selectedIds.length > 0) { st.select(null); window.parent?.postMessage({ type: 'hp3:deselected' }, '*'); }
            // 빈 공간 클릭 = 전체 선택 해제 (모델·벽/바닥 메시·공간 모듈)
            useImportedModelStore.getState().select(null);
            useMeshSelectionStore.getState().selectMesh(null);
            useSpaceModuleStore.getState().select(null);
          }}
          shadows={{ type: PCFShadowMap }}
          // 디스플레이 해상도(devicePixelRatio)에 맞춰 렌더 — 고DPI 화면에서 선명. r3f Canvas 는
          // 부모 div(100%×100%) 크기에 ResizeObserver 로 자동 추종.
          dpr={[1, 2]}
          gl={{
            antialias: true,
            preserveDrawingBuffer: true,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
        >
          <SceneBackground />
          <DynamicSky />
          <SceneCamera />
          <SceneLights />
          {/* 섀도맵 demand 렌더링 — 변화 있을 때만 재렌더 (드래그 끊김 해소) */}
          <ShadowDemand />
          <SceneEnvironment />
          <RendererSettings />
          <SceneGrid />
          <OrbitControlsConditional />

          <PlanScene showCeiling={showCeiling} showProducts={showProducts} />
          <ImportedModels />
          <ProductPlacement />
          <ModulePlacement />
          <SpaceLightmap />
          <SceneLightProbe />
          <ReflectionProbe />
          <IrradianceProbeGrid />
          <PathtracerRenderer />
          <CustomLights />
          <EditTool />
          <EditOverlay />
          <WallDrawingTool />
          <NodeMarkers />
          <SunGizmo />

          {/* Path tracer 활성 시 PostFX 비활성 — 둘 다 priority=1 useFrame 으로 캔버스에
              그리려 하면 호출 순서가 비결정적이라 path tracer 결과가 composer 에 덮어
              씌워진다. path tracer 가 이미 GI/AO/bloom-like glow 를 자체 계산하므로
              postfx 가 빠져도 시각 손실은 최소. */}
          <PostFXGate />
          {/* PCSS(contact-hardening) — 접촉부는 선명, 멀수록 부드러운 물리 기반 페넘브라.
              PCF radius 방식과 달리 소프트하게 해도 접촉부 틈(빛샘)이 안 생긴다.
              path tracer 모드에선 자체 소프트 그림자가 있으므로 제외. */}
          <PcssGate />
        </Canvas>
      </div>
    </HostProvider>
  );
}

/** 환경맵을 배경으로 안 쓸 때만 단색 배경 적용. */
function SceneBackground() {
  const envBackground = useLightingStore((s) => s.environmentBackground);
  const skyEnabled = useLightingStore((s) => s.skyEnabled);
  const bgColor = useViewStore((s) => s.sceneBackgroundColor);
  // 동적 하늘(Sky) 또는 HDR 배경이 켜져 있으면 단색 배경을 깔지 않음 (덮어쓰면 안 됨).
  if (envBackground || skyEnabled) return null;
  return <color attach="background" args={[bgColor]} />;
}

/** 2D/3D 카메라 전환. */
function SceneCamera() {
  const viewMode = useViewStore((s) => s.viewMode);
  if (viewMode === '2D') {
    return (
      <OrthographicCamera
        makeDefault
        position={[0, 25, 0]}
        zoom={50}
        near={0.1}
        far={1000}
      />
    );
  }
  return (
    <PerspectiveCamera
      makeDefault
      position={[8, 8, 8]}
      fov={50}
      near={0.1}
      far={1000}
    />
  );
}

/**
 * Directional + Ambient 라이트. shadowMapSize는 React prop으로는 GL 텍스처 재생성을 못 시키므로
 * `key`로 강제 remount해서 새 shadow.map을 만들게 한다.
 */
function SceneLights() {
  const azimuth = useLightingStore((s) => s.azimuth);
  const elevation = useLightingStore((s) => s.elevation);
  const distance = useLightingStore((s) => s.distance);
  const intensity = useLightingStore((s) => s.intensity);
  const ambientIntensity = useLightingStore((s) => s.ambientIntensity);
  const castShadow = useLightingStore((s) => s.castShadow);
  const shadowQuality = useLightingStore((s) => s.shadowQuality);
  const shadowSoftness = useLightingStore((s) => s.shadowSoftness);
  const shadowStrength = useLightingStore((s) => s.shadowStrength);
  const shadowBias = useLightingStore((s) => s.shadowBias);
  const shadowNormalBias = useLightingStore((s) => s.shadowNormalBias);
  const shadowFrustumSize = useLightingStore((s) => s.shadowFrustumSize);
  const shadowCameraNear = useLightingStore((s) => s.shadowCameraNear);
  const shadowCameraFar = useLightingStore((s) => s.shadowCameraFar);
  const shadowColor = useLightingStore((s) => s.shadowColor);
  const giMode = useLightingStore((s) => s.giMode);
  const giIntensity = useLightingStore((s) => s.giIntensity);
  const giSkyColor = useLightingStore((s) => s.giSkyColor);
  const giGroundColor = useLightingStore((s) => s.giGroundColor);
  const sunVisible = useLightingStore((s) => s.sunVisible);
  const ambientVisible = useLightingStore((s) => s.ambientVisible);
  const hemiVisible = useLightingStore((s) => s.hemiVisible);
  const position = sphericalToCartesian(azimuth, elevation, distance);
  const mapSize = shadowMapSizeFor(shadowQuality);
  // shadowStrength = 그림자 진하기. 1.0 에서 간접광 거의 0 → 그림자 영역이 검정에 근접.
  // clamp 로 음수 방지. ambient/hemi 는 거의 완전 차단, env 는 조금 남겨 mesh 가 시각화는
  // 유지 (env=0 이면 PBR mesh 가 완전 검정이 됨 — 햇빛 영역도 detail 잃음).
  const ambientFactor = Math.max(0, 1 - shadowStrength * 0.98);
  const hemiFactor = Math.max(0, 1 - shadowStrength * 0.95);
  const effectiveAmbient = ambientIntensity * ambientFactor;
  const hemiActive = giMode === 'hemisphere' && hemiVisible;
  const ptEnabled = useLightingStore((s) => s.pathtracerEnabled);

  return (
    <>
      <ambientLight intensity={ambientVisible ? effectiveAmbient : 0} color={shadowColor} />
      <hemisphereLight
        color={giSkyColor}
        groundColor={giGroundColor}
        intensity={hemiActive ? giIntensity * hemiFactor : 0}
      />
      {/* 태양 — raster 모드: DirectionalLight(shadow map). path tracer: DirectionalLight 는
          softness 슬롯이 없어 무조건 하드하므로, 대신 거리 먼 PointLight 프록시(decay 0 +
          radius)로 평행광 근사 + 소프트 그림자. 두 광원이 동시에 path-trace 되면 그림자가
          겹치므로 모드별로 *하나만* 렌더. */}
      {!ptEnabled && (
        <directionalLight
          key={`dir-${mapSize}-${castShadow ? 1 : 0}-${shadowSoftness}-${shadowFrustumSize}-${shadowCameraNear}-${shadowCameraFar}`}
          position={position}
          intensity={sunVisible ? intensity : 0}
          castShadow={sunVisible && castShadow}
          shadow-mapSize={[mapSize, mapSize]}
          shadow-radius={shadowSoftness}
          shadow-blurSamples={Math.max(8, Math.min(32, Math.round(shadowSoftness * 3)))}
          shadow-bias={shadowBias}
          shadow-normalBias={shadowNormalBias}
          shadow-camera-left={-shadowFrustumSize}
          shadow-camera-right={shadowFrustumSize}
          shadow-camera-top={shadowFrustumSize}
          shadow-camera-bottom={-shadowFrustumSize}
          shadow-camera-near={shadowCameraNear}
          shadow-camera-far={shadowCameraFar}
        />
      )}
      {ptEnabled && sunVisible && (
        <SunPathtracerProxy
          position={position}
          intensity={intensity}
          softness={shadowSoftness}
        />
      )}
    </>
  );
}

/**
 * Path tracer 전용 태양 프록시 — DirectionalLight 가 PT 에서 softness 불가하므로 거리 먼
 * PointLight 로 대체. decay=0 + distance=0 → 거리 감쇠 없이 평행광처럼 균일 조명. radius 가
 * gkjohnson path tracer 의 penumbra 를 결정 → 소프트니스 슬라이더로 제어.
 */
function SunPathtracerProxy({
  position,
  intensity,
  softness,
}: {
  position: [number, number, number];
  intensity: number;
  softness: number;
}) {
  const ref = useRef<PointLight>(null);
  // sun 방향으로 멀리 배치 (50m) — 평행광 근사
  const dist = 50;
  const len = Math.hypot(position[0], position[1], position[2]) || 1;
  const far: [number, number, number] = [
    (position[0] / len) * dist,
    (position[1] / len) * dist,
    (position[2] / len) * dist,
  ];
  useEffect(() => {
    if (!ref.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = ref.current as any;
    // 50m 거리 기준: radius = softness×0.35 → softness 5≈1.7m(2°,크리스프), 30≈10.5m(12°,매우
    // 소프트). 0.06 은 너무 작아 시각 변화가 없었음.
    l.radius = softness * 0.35;
    l.decay = 0;
    l.distance = 0;
  }, [softness]);
  return (
    <pointLight
      ref={ref}
      position={far}
      // decay=0 PointLight 는 거리 감쇠 없어 directional 과 거의 같은 단위 — ×1
      intensity={intensity}
      castShadow
    />
  );
}

function SceneEnvironment() {
  const preset = useLightingStore((s) => s.environmentPreset);
  const background = useLightingStore((s) => s.environmentBackground);
  const intensity = useLightingStore((s) => s.environmentIntensity);
  const shadowStrength = useLightingStore((s) => s.shadowStrength);
  // shadowStrength 가 env IBL 도 살짝 감쇠 — env 가 indirect 의 큰 부분을 차지하므로
  // 적용 안 하면 shadowStrength 슬라이더 변화가 거의 안 보임. sky 가시성 유지 위해 약하게.
  // env 는 햇빛 영역의 PBR 디테일(반사, fresnel) 보존에 필요해 30% 만 남김.
  const envFactor = Math.max(0, 1 - shadowStrength * 0.85);
  return (
    <Environment preset={preset} background={background} environmentIntensity={intensity * envFactor} />
  );
}

/** 그리드 — store의 컬러/투명도/표시 여부 바인딩.
 *  Path tracer 활성 시는 자동 비활성 — Grid 의 ShaderMaterial 이 path tracer 의 BVH 에
 *  포함되면 radius≈14m 거대 plane 으로 카메라 view 전체를 가려 wall/floor 가 안 보임. */
function SceneGrid() {
  const show = useViewStore((s) => s.showGrid);
  const cellColor = useViewStore((s) => s.gridCellColor);
  const sectionColor = useViewStore((s) => s.gridSectionColor);
  const opacity = useViewStore((s) => s.gridOpacity);
  const ptEnabled = useLightingStore((s) => s.pathtracerEnabled);
  if (!show || ptEnabled) return null;
  return (
    <Grid
      position={[0, -0.01, 0]}
      args={[20, 20]}
      cellSize={0.5}
      cellThickness={0.5 * opacity}
      cellColor={cellColor}
      sectionSize={2.5}
      sectionThickness={1.2 * opacity}
      sectionColor={sectionColor}
      fadeDistance={30}
      infiniteGrid
    />
  );
}

/** WebGLRenderer 라이브 설정 (tone mapping enum + exposure) 동기화. */
function RendererSettings() {
  const exposure = useLightingStore((s) => s.toneMappingExposure);
  const toneMapping = useLightingStore((s) => s.toneMapping);
  return (
    <SyncRenderer key={`${toneMapping}-${exposure}`} exposure={exposure} toneMapping={toneMapping} />
  );
}

function SyncRenderer({ exposure, toneMapping }: { exposure: number; toneMapping: string }) {
  const { gl } = useThree();
  gl.toneMappingExposure = exposure;
  switch (toneMapping) {
    case 'none': gl.toneMapping = 0; break;
    case 'linear': gl.toneMapping = 1; break;
    case 'reinhard': gl.toneMapping = 2; break;
    case 'cineon': gl.toneMapping = 3; break;
    case 'aces': gl.toneMapping = 4; break;
    case 'agx': gl.toneMapping = 5; break;
  }
  gl.shadowMap.needsUpdate = true;
  return null;
}

/**
 * 마우스 버튼 매핑 + 2D 모드 회전 비활성.
 *
 * - **좌클릭**: 그리기 모드면 점 찍기 / 일반 모드면 회전(3D) 또는 PAN(2D)
 * - **가운데 드래그**: PAN
 * - **우클릭 드래그**: 회전(3D) / PAN(2D)
 * - **휠**: ZOOM
 */
/** Path tracer 활성 시 PostFX 자동 비활성 — 두 useFrame priority 충돌 회피. */
/** PCSS 소프트 그림자 게이트 — pcssEnabled && !pathtracer 일 때만 셰이더 패치 mount. */
function PcssGate() {
  const enabled = useLightingStore((s) => s.pcssEnabled);
  const ptEnabled = useLightingStore((s) => s.pathtracerEnabled);
  const size = useLightingStore((s) => s.pcssSize);
  const samples = useLightingStore((s) => s.pcssSamples);
  if (!enabled || ptEnabled) return null;
  return <SoftShadows size={size} samples={samples} focus={0} />;
}

function PostFXGate() {
  const ptEnabled = useLightingStore((s) => s.pathtracerEnabled);
  if (ptEnabled) return null;
  return <PostFX />;
}

function OrbitControlsConditional() {
  const viewMode = useViewStore((s) => s.viewMode);
  const is2D = viewMode === '2D';
  // path tracer 활성 시 damping OFF — 관성으로 마우스 놓은 뒤에도 ~1초 카메라가 계속
  // 움직여 path tracer 가 그동안 계속 reset → "정지 즉시 수렴" 이 안 됨. damping 끄면
  // 놓는 순간 카메라 정지 → 즉시 누적 시작.
  const ptEnabled = useLightingStore((s) => s.pathtracerEnabled);
  return (
    <OrbitControls
      // viewMode / ptEnabled 변경 시 remount
      key={`${viewMode}-${ptEnabled ? 'pt' : 'raster'}`}
      makeDefault
      enableDamping={!ptEnabled}
      dampingFactor={0.08}
      target={[0, 0, 0]}
      enableRotate={!is2D}
      // 좌클릭은 *항상* 그리기/편집에 양보 — 노드/벽 드래그 시 카메라가 같이 회전하는 충돌 방지.
      // 카메라 조작은 우클릭(회전) + 가운데(PAN) + 휠(ZOOM)만 사용.
      mouseButtons={{
        LEFT: undefined,
        MIDDLE: MOUSE.PAN,
        RIGHT: is2D ? MOUSE.PAN : MOUSE.ROTATE,
      }}
    />
  );
}