import { Canvas, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  Environment,
  PerspectiveCamera,
  OrthographicCamera,
} from '@react-three/drei';
import { PCFShadowMap, ACESFilmicToneMapping, MOUSE } from 'three';
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
import { IrradianceProbeGrid } from '@/engine/lighting/IrradianceProbeGrid';
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
import { HostProvider } from './host/HostContext';
import type { HostEventHandlers } from './host/HostEvents';

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
  return (
    <HostProvider handlers={handlers}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {showToolbar && <Toolbar />}
        {showLightingPanel && <LightingPanel />}
        {showLightingPanel && <LightInspector />}
        {showLightingPanel && <MeshInspector />}
        {showLightingPanel && <SceneOutliner />}
        {showLightingPanel && <BuiltinLightInspector />}
        <Canvas
          shadows={{ type: PCFShadowMap }}
          gl={{
            antialias: true,
            preserveDrawingBuffer: true,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
        >
          <SceneBackground />
          <SceneCamera />
          <SceneLights />
          <SceneEnvironment />
          <RendererSettings />
          <SceneGrid />
          <OrbitControlsConditional />

          <PlanScene showCeiling={showCeiling} showProducts={showProducts} />
          <SpaceLightmap />
          <SceneLightProbe />
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
        </Canvas>
      </div>
    </HostProvider>
  );
}

/** 환경맵을 배경으로 안 쓸 때만 단색 배경 적용. */
function SceneBackground() {
  const envBackground = useLightingStore((s) => s.environmentBackground);
  const bgColor = useViewStore((s) => s.sceneBackgroundColor);
  if (envBackground) return null;
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
  const effectiveAmbient = ambientIntensity * (1 - shadowStrength * 0.7);
  const hemiActive = giMode === 'hemisphere' && hemiVisible;

  return (
    <>
      <ambientLight intensity={ambientVisible ? effectiveAmbient : 0} color={shadowColor} />
      <hemisphereLight
        color={giSkyColor}
        groundColor={giGroundColor}
        intensity={hemiActive ? giIntensity : 0}
      />
      <directionalLight
        // mapSize/cast/softness 중 하나라도 바뀌면 강제 remount — shadow map + radius 즉시 반영.
        // PCFSoftShadowMap은 radius를 무시하므로 Canvas의 shadow type을 PCFShadowMap으로 변경했음.
        key={`dir-${mapSize}-${castShadow ? 1 : 0}-${shadowSoftness}`}
        position={position}
        intensity={sunVisible ? intensity : 0}
        castShadow={sunVisible && castShadow}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-radius={shadowSoftness}
        shadow-blurSamples={Math.max(4, Math.min(25, Math.round(shadowSoftness * 2)))}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={0.5}
        shadow-camera-far={100}
      />
    </>
  );
}

function SceneEnvironment() {
  const preset = useLightingStore((s) => s.environmentPreset);
  const background = useLightingStore((s) => s.environmentBackground);
  const intensity = useLightingStore((s) => s.environmentIntensity);
  return <Environment preset={preset} background={background} environmentIntensity={intensity} />;
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
function PostFXGate() {
  const ptEnabled = useLightingStore((s) => s.pathtracerEnabled);
  if (ptEnabled) return null;
  return <PostFX />;
}

function OrbitControlsConditional() {
  const viewMode = useViewStore((s) => s.viewMode);
  const is2D = viewMode === '2D';
  return (
    <OrbitControls
      // viewMode 변경 시 OrbitControls를 강제 remount해 카메라 자세도 초기화
      key={viewMode}
      makeDefault
      enableDamping
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