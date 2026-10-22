import { useEffect, useState } from 'react';
import {
  useLightingStore,
  type EnvironmentPreset,
  type ShadowQuality,
  type ToneMappingMode,
} from '@/engine/stores/lightingStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { DEFAULT_FOV_RANGE } from '@/domain/camera/CameraFov';
import { useMutracerStore } from '@/engine/stores/mutracerStore';
import { NumberField } from '@/ui/NumberField';
import { lightRotation } from '@/engine/lighting/CustomLights';
import { useCustomLightStore, type LightKind, type CustomLight } from '@/engine/stores/customLightStore';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';

const LIGHT_KINDS: { kind: LightKind; label: string }[] = [
  { kind: 'point', label: '포인트 (옴니)' },
  { kind: 'spot', label: '스팟 (타겟)' },
  { kind: 'rect', label: '렉탱글 (면광원)' },
  { kind: 'hemisphere', label: '헤미스피어 (sky/ground)' },
];

const ENV_PRESETS: EnvironmentPreset[] = [
  'apartment',
  'city',
  'dawn',
  'forest',
  'lobby',
  'night',
  'park',
  'studio',
  'sunset',
  'warehouse',
];
const SHADOW_QUALITIES: ShadowQuality[] = ['low', 'medium', 'high', 'ultra'];
const GI_MODES = ['hemisphere', 'single-probe', 'probe-grid', 'path-tracer', 'mutracer'] as const;
const TONE_MAPPING_OPTIONS: ToneMappingMode[] = ['none', 'linear', 'reinhard', 'cineon', 'aces', 'agx'];

/**
 * 조명·그림자·환경맵·포스트프로세싱 통합 제어 패널.
 *
 * Canvas 우측 상단 토글식. 섹션:
 * - **광원** (방위각·고도·거리·강도·환경광)
 * - **그림자** (toggle / 품질 / 소프트니스)
 * - **Environment(HDR/IBL)** (preset / 배경 표시 / 강도)
 * - **Tone mapping** (모드 / 노출)
 * - **PostFX** (Bloom / SSAO / Vignette / DOF)
 */
export function LightingPanel() {
  const [open, setOpen] = useState(false);
  const s = useLightingStore();
  const v = useViewStore();

  return (
    <>
      <div style={containerStyle}>
        <button onClick={() => setOpen((o) => !o)} style={open ? activeBtnStyle : btnStyle}>
          ☀ 조명·렌더 {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <DraggablePanel
          id="lighting-panel"
          title="☀ 조명·렌더"
          defaultY={80}
          width={300}
          accent="#fbbf24"
          right={
            <button onClick={() => setOpen(false)} style={closeBtnStyle} title="닫기">✕</button>
          }
        >
          <Section title="광원">
            <Slider label="방위각" unit="°" min={-180} max={180} step={1} value={s.azimuth} onChange={s.setAzimuth} />
            <Slider label="고도" unit="°" min={0} max={90} step={1} value={s.elevation} onChange={s.setElevation} />
            <Slider label="거리" unit="m" min={5} max={50} step={0.5} value={s.distance} onChange={s.setDistance} />
            <Slider label="태양 강도" min={0} max={20} step={0.05} value={s.intensity} onChange={s.setIntensity} />
            <ColorRow label="태양 색" value={s.sunColor} onChange={s.setSunColor} />
            <Slider label="환경광" min={0} max={2} step={0.05} value={s.ambientIntensity} onChange={s.setAmbientIntensity} />
            <Checkbox label="기즈모로 빛 위치 조작" checked={s.showLightGizmo} onChange={s.setShowLightGizmo} />
            {s.showLightGizmo && (
              <Select
                label="기즈모 모드"
                value={s.lightGizmoMode}
                options={['translate', 'rotate'] as const}
                onChange={s.setLightGizmoMode}
              />
            )}
          </Section>

          <Section title="씬 배경">
            <ColorRow label="배경 색" value={v.sceneBackgroundColor} onChange={v.setSceneBackgroundColor} />
          </Section>

          <Section title="카메라">
            <Slider label="화각 (도)" min={DEFAULT_FOV_RANGE.minFov} max={DEFAULT_FOV_RANGE.maxFov} step={1} value={v.cameraFov} onChange={v.setCameraFov} />
          </Section>

          <Section title="성능 확인">
            <Checkbox label="프레임 체크 (` 키)" checked={v.showFrameMeter} onChange={v.setShowFrameMeter} />
          </Section>

          <Section title="그리드">
            <Checkbox label="그리드 표시" checked={v.showGrid} onChange={v.setShowGrid} />
            <ColorRow label="셀 컬러" value={v.gridCellColor} onChange={v.setGridCellColor} />
            <ColorRow label="섹션 컬러" value={v.gridSectionColor} onChange={v.setGridSectionColor} />
            <Slider label="투명도" min={0} max={1} step={0.05} value={v.gridOpacity} onChange={v.setGridOpacity} />
          </Section>

          <Section title="그림자">
            {s.giMode === 'mutracer' && <MtNote text="래스터 그림자 설정 — 경로 추적은 그림자를 빛에서 직접 계산해 적용되지 않는다(해·조명 세기·방향은 적용)" />}
            <Checkbox label="그림자 캐스팅" checked={s.castShadow} onChange={s.setCastShadow} />
            <Select label="품질" value={s.shadowQuality} options={SHADOW_QUALITIES} onChange={s.setShadowQuality} />
            <Slider label="소프트니스" min={0} max={30} step={1} value={s.shadowSoftness} onChange={s.setShadowSoftness} />
            <Slider label="그림자 강도" min={0} max={1.2} step={0.05} value={s.shadowStrength} onChange={s.setShadowStrength} />
            <ColorRow label="그림자 색" value={s.shadowColor} onChange={s.setShadowColor} />
            <CausticControls />
          </Section>

          <Section title="GI (Global Illumination)">
            <Select
              label="GI 모드"
              value={s.giMode}
              options={GI_MODES as unknown as string[]}
              onChange={(v) => {
                const mode = v as typeof GI_MODES[number];
                // path-tracer 선택 시 시네마틱 프리셋 전체 적용 (env/bounces/조명 최적 셋업) —
                // 체크박스·select·버튼 어느 입구로 켜도 동일한 화질 보장. 다른 모드면 PT off.
                if (mode === 'path-tracer') {
                  s.applyPathtracerCinematicPreset();
                } else {
                  s.setGiMode(mode);
                  s.setPathtracerEnabled(false);
                }
              }}
            />
            {s.giMode === 'mutracer' && <MtNote text="GI 강도·하늘/땅 색은 래스터용 — 경로 추적은 간접광을 직접 계산한다" />}
            <Slider label="GI 강도" min={0} max={2} step={0.05} value={s.giIntensity} onChange={s.setGiIntensity} />
            <ColorRow label="Sky 색 (위)" value={s.giSkyColor} onChange={s.setGiSkyColor} />
            <ColorRow label="Ground 색 (아래)" value={s.giGroundColor} onChange={s.setGiGroundColor} />
            <Checkbox
              label="라이트맵 (AccumulativeShadows)"
              checked={s.lightmapEnabled}
              onChange={(v) => {
                s.setLightmapEnabled(v);
                // 둘 다 켜면 시각 충돌 → 상호 배타
                if (v && s.pathtracerEnabled) s.setPathtracerEnabled(false);
              }}
            />
            <Checkbox
              label="LightProbe (CubeCamera SH IBL)"
              checked={s.lightProbeEnabled}
              onChange={s.setLightProbeEnabled}
            />
            {s.lightProbeEnabled && (
              <Slider
                label="LightProbe 강도"
                min={0}
                max={3}
                step={0.05}
                value={s.lightProbeIntensity}
                onChange={s.setLightProbeIntensity}
              />
            )}
            <Checkbox
              label="GPU Path Tracer (Unity/Unreal 수준 GI — 무거움)"
              checked={s.pathtracerEnabled}
              onChange={(v) => {
                if (v) {
                  // 켤 때 시네마틱 프리셋 적용 — 버튼과 동일 화질
                  s.applyPathtracerCinematicPreset();
                  s.setLightmapEnabled(false);
                } else {
                  s.setPathtracerEnabled(false);
                }
              }}
            />
            {s.pathtracerEnabled && (
              <Slider
                label="PT bounces"
                min={1}
                max={8}
                step={1}
                value={s.pathtracerBounces}
                onChange={s.setPathtracerBounces}
              />
            )}
            <button
              onClick={s.applyPathtracerCinematicPreset}
              style={{
                marginTop: 8,
                padding: '6px 10px',
                background: '#4ade80',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
              }}
              title="bounces=8, HDR env=1.5, ambient/GI=0, sky 배경 ON — 사실적 GI 한 번에"
            >
              🎬 Path Tracer 시네마틱 프리셋 적용
            </button>
          </Section>

          <Section title="Environment (HDR/IBL)">
            <Select label="Preset" value={s.environmentPreset} options={ENV_PRESETS} onChange={s.setEnvironmentPreset} />
            <Checkbox label="HDR 배경 표시" checked={s.environmentBackground} onChange={s.setEnvironmentBackground} />
            {s.giMode === 'mutracer' && <MtNote text="경로 추적은 환경맵 세기를 읽지 않는다(그림·배경은 적용)" />}
            <Slider label="강도" min={0} max={3} step={0.05} value={s.environmentIntensity} onChange={s.setEnvironmentIntensity} />
          </Section>

          {s.giMode === 'mutracer' && <MutracerSection />}

          <Section title="Tone Mapping">
            <Select label="모드" value={s.toneMapping} options={TONE_MAPPING_OPTIONS} onChange={s.setToneMapping} />
            <Slider label="노출" min={0.1} max={3} step={0.05} value={s.toneMappingExposure} onChange={s.setToneMappingExposure} />
          </Section>

          <CustomLightSection />

          <Section title="PostFX">
            {s.giMode === 'mutracer' && <MtNote text="래스터 후처리 — 경로 추적 화면의 블룸·비네팅·대비는 「경로 추적 (WebGPU)」 표시 항목에서" />}
            <Checkbox label="안티알리아싱 (SMAA)" checked={s.smaaEnabled} onChange={s.setSmaaEnabled} />
            <Checkbox label="SSR — 실시간 반사 (모델↔모델·환경)" checked={s.ssrEnabled} onChange={s.setSsrEnabled} />
            {s.ssrEnabled && (
              <Slider label="SSR 해상도" min={0.25} max={1} step={0.05} value={s.ssrResolutionScale} onChange={s.setSsrResolutionScale} />
            )}
            <Checkbox label="Bloom (밝은 영역 글로우)" checked={s.bloomEnabled} onChange={s.setBloomEnabled} />
            {s.bloomEnabled && (
              <Slider label="Bloom 강도" min={0} max={2} step={0.05} value={s.bloomIntensity} onChange={s.setBloomIntensity} />
            )}

            <Checkbox label="AO — N8AO (모서리 어둡게)" checked={s.ssaoEnabled} onChange={s.setSsaoEnabled} />
            {s.ssaoEnabled && (
              <>
                <Slider label="AO 강도" min={0} max={10} step={0.1} value={s.ssaoIntensity} onChange={s.setSsaoIntensity} />
                <Slider label="AO 반경" unit="m" min={0.1} max={3} step={0.05} value={s.aoRadius} onChange={s.setAoRadius} />
                <Slider label="AO 페이드" min={0.05} max={2} step={0.05} value={s.aoDistanceFalloff} onChange={s.setAoDistanceFalloff} />
              </>
            )}

            <Checkbox label="AO — GTAO (Ground Truth, three.js native)" checked={s.gtaoEnabled} onChange={s.setGtaoEnabled} />
            {s.gtaoEnabled && (
              <>
                <Slider label="강도" min={0} max={3} step={0.05} value={s.gtaoIntensity} onChange={s.setGtaoIntensity} />
                <Slider label="반경 (m)" min={0.3} max={3} step={0.05} value={s.gtaoRadius} onChange={s.setGtaoRadius} />
                <Slider label="거리 페이드 (m)" min={1} max={20} step={0.5} value={s.gtaoDistanceFalloff} onChange={s.setGtaoDistanceFalloff} />
                <Slider label="두께 (m)" min={0.3} max={5} step={0.1} value={s.gtaoThickness} onChange={s.setGtaoThickness} />
              </>
            )}

            <Checkbox label="Vignette" checked={s.vignetteEnabled} onChange={s.setVignetteEnabled} />
            {s.vignetteEnabled && (
              <Slider label="Vignette 강도" min={0} max={1} step={0.02} value={s.vignetteIntensity} onChange={s.setVignetteIntensity} />
            )}

            <Checkbox label="DOF (피사계 심도)" checked={s.dofEnabled} onChange={s.setDofEnabled} />
            {s.dofEnabled && (
              <>
                <Slider label="포커스 거리" unit="cm" min={50} max={3000} step={10} value={s.dofFocusDistance} onChange={s.setDofFocusDistance} />
                <Slider label="보케 크기" min={0} max={10} step={0.1} value={s.dofBokehScale} onChange={s.setDofBokehScale} />
              </>
            )}
          </Section>

          <button onClick={s.reset} style={resetBtnStyle}>
            기본값 복원
          </button>
        </DraggablePanel>
      )}
    </>
  );
}

/**
 * 동적 라이트 추가/편집 섹션 — `customLightStore`에 라이트를 add/remove/update.
 * 종류별 속성 슬라이더가 동적으로 노출되어 사용자가 자유롭게 조명을 배치/조정 가능.
 */
function CustomLightSection() {
  const lights = useCustomLightStore((s) => s.lights);
  const selectedId = useCustomLightStore((s) => s.selectedId);
  const add = useCustomLightStore((s) => s.add);
  const remove = useCustomLightStore((s) => s.remove);
  const update = useCustomLightStore((s) => s.update);
  const select = useCustomLightStore((s) => s.select);
  const selected = lights.find((l) => l.id === selectedId) ?? null;

  return (
    <Section title="라이트 추가">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {LIGHT_KINDS.map((k) => (
          <button key={k.kind} onClick={() => add(k.kind)} style={addLightBtnStyle}>
            + {k.label}
          </button>
        ))}
      </div>

      {lights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
          {lights.map((l) => (
            <div
              key={l.id}
              onClick={() => select(l.id === selectedId ? null : l.id)}
              style={{
                ...lightRowStyle,
                background: l.id === selectedId ? '#1e3a5f' : '#2a2a30',
                borderColor: l.id === selectedId ? '#22d3ee' : '#444',
              }}
            >
              <span style={{ flex: 1 }}>{l.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(l.id);
                }}
                style={removeBtnStyle}
                title="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <CustomLightEditor
          light={selected}
          onChange={(patch) => update(selected.id, patch)}
        />
      )}
    </Section>
  );
}

function CustomLightEditor({
  light: l,
  onChange,
}: {
  light: CustomLight;
  onChange: (patch: Partial<CustomLight>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, paddingTop: 6, borderTop: '1px dashed #444' }}>
      <ColorRow label="색" value={l.color} onChange={(v) => onChange({ color: v })} />
      <Slider
        label="강도"
        min={0}
        max={l.kind === 'spot' ? 100 : l.kind === 'rect' ? 20 : 30}
        step={0.1}
        value={l.intensity}
        onChange={(v) => onChange({ intensity: v })}
      />

      {l.kind !== 'hemisphere' && (
        <>
          <Slider label="X" unit="m" min={-20} max={20} step={0.1} value={l.position[0]} onChange={(v) => onChange({ position: [v, l.position[1], l.position[2]] })} />
          <Slider label="Y(높이)" unit="m" min={0} max={10} step={0.05} value={l.position[1]} onChange={(v) => onChange({ position: [l.position[0], v, l.position[2]] })} />
          <Slider label="Z" unit="m" min={-20} max={20} step={0.1} value={l.position[2]} onChange={(v) => onChange({ position: [l.position[0], l.position[1], v] })} />
        </>
      )}

      {(l.kind === 'point' || l.kind === 'spot') && (
        <>
          <Slider label="도달 거리" unit="m" min={0} max={30} step={0.5} value={l.distance ?? 10} onChange={(v) => onChange({ distance: v })} />
          <Slider label="감쇠" min={0} max={3} step={0.1} value={l.decay ?? 2} onChange={(v) => onChange({ decay: v })} />
        </>
      )}

      {l.kind === 'spot' && (
        <>
          <Slider label="각도" unit="°" min={5} max={90} step={1} value={((l.angle ?? Math.PI / 6) * 180) / Math.PI} onChange={(v) => onChange({ angle: (v * Math.PI) / 180 })} />
          <Slider label="가장자리" min={0} max={1} step={0.05} value={l.penumbra ?? 0.4} onChange={(v) => onChange({ penumbra: v })} />
        </>
      )}

      {l.kind === 'rect' && (
        <>
          <Slider label="너비" unit="m" min={0.1} max={5} step={0.05} value={l.width ?? 2} onChange={(v) => onChange({ width: v })} />
          <Slider label="높이" unit="m" min={0.1} max={5} step={0.05} value={l.height ?? 1} onChange={(v) => onChange({ height: v })} />
        </>
      )}

      {l.kind === 'hemisphere' && (
        <ColorRow label="Ground 색" value={l.groundColor ?? '#404040'} onChange={(v) => onChange({ groundColor: v })} />
      )}

      {/* 회전 — 모든 조명. 빛은 자기 -Z 쪽(사각 기본 아래, 스포트는 처음엔 목표 쪽) */}
      {(['X', 'Y', 'Z'] as const).map((axis, i) => {
        const rot = lightRotation(l);
        return (
          <Slider
            key={axis}
            label={`회전 ${axis}`}
            unit="°"
            min={-180}
            max={180}
            step={1}
            value={Math.round((rot[i] * 180) / Math.PI)}
            onChange={(v) => {
              const next = [...rot] as [number, number, number];
              next[i] = (v * Math.PI) / 180;
              onChange({ rotation: next });
            }}
          />
        );
      })}
      <div style={{ fontSize: 10.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={l.kind === 'point' ? '점 조명은 모든 방향으로 빛을 내 회전해도 빛은 같다(값만 저장)' : '선택 후 R = 회전 손잡이 · G/T = 이동 손잡이'}>
        {l.kind === 'point' ? '점 조명: 회전해도 빛은 같다(모든 방향)' : '선택 후 R = 회전 · G/T = 이동'}
      </div>

      {/* 그림자 — 조명마다 */}
      {(l.kind === 'point' || l.kind === 'spot') ? (
        <>
          <Checkbox label="그림자 표시" checked={l.castShadow ?? false} onChange={(v) => onChange({ castShadow: v })} />
          {(l.castShadow ?? false) && (
            <>
              <Slider label="그림자 강도" min={0} max={1} step={0.05} value={l.shadowIntensity ?? 1} onChange={(v) => onChange({ shadowIntensity: v })} />
              <Slider label="그림자 부드럽기" min={0} max={30} step={0.5} value={l.shadowRadius ?? 4} onChange={(v) => onChange({ shadowRadius: v })} />
            </>
          )}
        </>
      ) : (
        <div style={{ fontSize: 10.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title="three.js 래스터는 사각·반구 조명의 그림자를 만들지 못한다. 경로 추적 모드에선 모든 조명이 그림자를 만든다">
          그림자: 래스터 미지원(경로 추적은 자동)
        </div>
      )}
    </div>
  );
}

/** 경로 추적 모드에서 적용되지 않는 래스터 설정 안내 한 줄 */
function MtNote({ text }: { text: string }) {
  return (
    <div
      title={`경로 추적 모드: ${text}`}
      style={{ fontSize: 10.5, color: '#fbbf24', margin: '2px 0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      ⚠ 경로 추적에선 적용 안 됨 — {text}
    </div>
  );
}

/**
 * 경로 추적(MuTracer · WebGPU) 설정 — mutracerStore. 실행 중 바로 반영(MutracerRenderer).
 * 반사 횟수·렌더 해상도는 lightingStore 값을 같이 쓴다. 맨 아래는 실시간 진단(백엔드·아틀라스·추적 시간).
 */
function MutracerSection() {
  const mt = useMutracerStore((x) => x.mt);
  const setMt = useMutracerStore((x) => x.setMt);
  const resetMt = useMutracerStore((x) => x.resetMt);
  const l = useLightingStore();
  const [diag, setDiag] = useState('');
  useEffect(() => {
    const id = window.setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (window as any).__mutracer;
      if (!m) return setDiag('경로 추적 엔진 없음');
      const g = m.engine.getDiagnostics?.() ?? {};
      const at = g.textureAtlas;
      const tr = g.gpuTraceTiming;
      setDiag(
        [
          `백엔드 ${m.engine.backend ?? '…'} · ${g.adapterName ?? ''} · ${m.loop.status} · 샘플 ${m.loop.samples}/${mt.maxSamples}`,
          `해상도 ${m.loop.final.width}×${m.loop.final.height}` + (tr ? ` · 한 샘플 추적 ${Math.round(tr.estimatedFullFrameTimeMs)}ms` : ''),
          at ? `텍스처 ${at.textureCount}장 · 줄임 ${(at.scale * 100).toFixed(0)}% · ${(at.estimatedBytes / 1048576).toFixed(0)}MiB` : '',
          g.lightSampling ? `발광 삼각형 ${g.lightSampling.emissiveTriangles.toLocaleString()}개` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [mt.maxSamples]);
  const sub = (t: string) => <div style={{ fontSize: 11, color: '#93c5fd', margin: '8px 0 2px', fontWeight: 600 }}>{t}</div>;
  return (
    <Section title="경로 추적 (WebGPU · MuTracer)">
      {sub('샘플링')}
      <Slider label="최대 샘플 수" min={16} max={4096} step={16} value={mt.maxSamples} onChange={(v) => setMt({ maxSamples: v })} />
      <Slider label="반사 횟수" min={1} max={12} step={1} value={l.pathtracerBounces} onChange={l.setPathtracerBounces} />
      <Select label="샘플 순서" value={mt.samplingPattern} options={['sobol', 'zsobol', 'random']} onChange={(v) => setMt({ samplingPattern: v as typeof mt.samplingPattern })} />
      <Slider label="조명 후보 수(WebGPU)" min={1} max={16} step={1} value={mt.directLightCandidates} onChange={(v) => setMt({ directLightCandidates: v })} />
      <Slider label="밝기 제한(0=끔)" min={0} max={50} step={0.5} value={mt.clamping} onChange={(v) => setMt({ clamping: v })} />
      <Select label="반투명 처리" value={mt.alphaBlendStrategy} options={['stochastic', 'deterministic-source-over']} onChange={(v) => setMt({ alphaBlendStrategy: v as typeof mt.alphaBlendStrategy })} />
      <Select label="분산 파장 수" value={String(mt.dispersionWavelengths)} options={['3', '1']} onChange={(v) => setMt({ dispersionWavelengths: Number(v) as 1 | 3 })} />
      <Checkbox label="모서리 둥글게(베벨)" checked={mt.bevel} onChange={(v) => setMt({ bevel: v })} />
      {mt.bevel && <Slider label="베벨 샘플" min={1} max={32} step={1} value={mt.bevelSamples} onChange={(v) => setMt({ bevelSamples: v })} />}

      {sub('해상도·성능')}
      <Slider label="렌더 해상도 (화면 ×)" min={1} max={2} step={0.05} value={l.mutracerRenderScale} onChange={l.setMutracerRenderScale} />
      <Slider label="프레임당 GPU 시간" unit="ms" min={4} max={100} step={1} value={mt.timeBudgetMs} onChange={(v) => setMt({ timeBudgetMs: v })} />
      <Select
        label="최종 해상도"
        value={FINAL_RES_LABEL[mt.finalResolution] ?? '100%'}
        options={FINAL_RES_OPTIONS}
        onChange={(v) => setMt({ finalResolution: FINAL_RES_VALUE[v] })}
      />
      <Checkbox label="멈춘 직후 1/2 해상도로 먼저 (빨리 깨끗하게)" checked={mt.progressiveResolution} onChange={(v) => setMt({ progressiveResolution: v })} />
      <Checkbox label="프레임당 샘플 여러 개" checked={mt.multiSamplesPerFrame} onChange={(v) => setMt({ multiSamplesPerFrame: v })} />
      <Slider label="텍스처 예산" unit="MiB" min={256} max={4096} step={128} value={mt.textureBudgetMiB} onChange={(v) => setMt({ textureBudgetMiB: v })} />
      <Select label="가속 구조 만들기" value={mt.bvhBuilder} options={['builtin', 'tinybvh']} onChange={(v) => setMt({ bvhBuilder: v as typeof mt.bvhBuilder })} />
      <Select label="가속 구조 형식" value={mt.bvhLayout} options={['bvh2', 'bvh4', 'bvh-gpu', 'cwbvh']} onChange={(v) => setMt({ bvhLayout: v as typeof mt.bvhLayout })} />

      <Checkbox label="유리 굴절·커스틱 (느림)" checked={mt.glassRefraction} onChange={(v) => setMt({ glassRefraction: v })} />

      {sub('디노이즈')}
      <Select label="디노이저" value={mt.denoiser} options={['oidn', 'jnlm', 'none']} onChange={(v) => setMt({ denoiser: v as typeof mt.denoiser })} />
      {mt.denoiser === 'oidn' && (
        <Select label="OIDN 모델(WebGPU)" value={mt.oidnModel} options={['small', 'standard', 'cleanAuxLarge']} onChange={(v) => setMt({ oidnModel: v as typeof mt.oidnModel })} />
      )}
      {mt.denoiser !== 'none' && (
        <Select label="정리 시점" value={mt.denoiseSchedule} options={['progressive', 'every-sample', 'converged']} onChange={(v) => setMt({ denoiseSchedule: v as typeof mt.denoiseSchedule })} />
      )}

      {sub('화면 표시 (경로 추적 화면)')}
      <Slider label="대비" min={0.5} max={1.5} step={0.01} value={mt.contrast} onChange={(v) => setMt({ contrast: v })} />
      <Slider label="채도" min={0} max={2} step={0.01} value={mt.saturation} onChange={(v) => setMt({ saturation: v })} />
      <Slider label="색온도(차갑게 ↔ 따뜻하게)" min={-1} max={1} step={0.01} value={mt.temperature} onChange={(v) => setMt({ temperature: v })} />
      <Slider label="틴트(초록 ↔ 자홍)" min={-1} max={1} step={0.01} value={mt.tint} onChange={(v) => setMt({ tint: v })} />
      <Slider label="비네팅" min={0} max={1} step={0.01} value={mt.vignette} onChange={(v) => setMt({ vignette: v })} />
      <Slider label="블룸 강도" min={0} max={2} step={0.01} value={mt.bloomIntensity} onChange={(v) => setMt({ bloomIntensity: v })} />
      {mt.bloomIntensity > 0 && (
        <>
          <Slider label="블룸 문턱" min={0} max={10} step={0.1} value={mt.bloomThreshold} onChange={(v) => setMt({ bloomThreshold: v })} />
          <Slider label="블룸 반경" min={0} max={1} step={0.01} value={mt.bloomRadius} onChange={(v) => setMt({ bloomRadius: v })} />
        </>
      )}
      <Checkbox label="HDR 모니터 출력(WebGPU)" checked={mt.hdrOutput} onChange={(v) => setMt({ hdrOutput: v })} />
      <Select label="진단 화면" value={mt.channel} options={['final', 'albedo', 'normal', 'shadow']} onChange={(v) => setMt({ channel: v as typeof mt.channel })} />

      {sub('움직임·전환')}
      <Checkbox label="움직일 때 래스터(끄면 경로 추적 미리보기)" checked={mt.hybrid} onChange={(v) => setMt({ hybrid: v })} />
      {mt.hybrid && (
        <>
          <Slider label="멈춤 판정" unit="ms" min={50} max={1500} step={10} value={mt.stillMs} onChange={(v) => setMt({ stillMs: v })} />
          <Slider label="넘어가기 전 샘플" min={1} max={16} step={1} value={mt.readySamples} onChange={(v) => setMt({ readySamples: v })} />
          <Slider label="겹쳐 바꾸기" unit="ms" min={0} max={1500} step={10} value={mt.fadeMs} onChange={(v) => setMt({ fadeMs: v })} />
        </>
      )}

      {sub('진단')}
      <pre style={{ margin: 0, fontSize: 10.5, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{diag}</pre>
      <button onClick={resetMt} style={{ marginTop: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', width: '100%' }}>
        경로 추적 설정 기본값으로
      </button>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function Slider({
  label,
  unit = '',
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  // 한 줄 — 이름 | 조절바 | 입력칸 단위. 긴 이름은 말줄임(마우스를 올리면 전체)
  return (
    <div style={sliderRowStyle}>
      <span style={oneLineLabelStyle} title={label}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={rangeStyle}
      />
      <span style={{ ...sliderValueStyle, display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
        <NumberField value={value} onChange={onChange} min={min} max={max} step={step} width={54} />
        <span style={{ width: 22, color: '#999', fontSize: 11 }}>{unit}</span>
      </span>
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={checkboxRowStyle} title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </label>
  );
}

/** 컬러 픽커 한 줄 — 라벨 + native `<input type="color">` + hex 표시. */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={colorRowStyle}>
      <span style={colorLabelStyle}>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={colorInputStyle}
      />
      <span style={colorHexStyle}>{value.toUpperCase()}</span>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={selectRowStyle}>
      <span style={selectLabelStyle} title={label}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={selectStyle}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

// ===== Inline styles ============================================

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  zIndex: 10,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
  color: '#e0e0e0',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'rgba(20, 20, 24, 0.72)',
  color: '#e0e0e0',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#ff9800',
  color: '#000',
  borderColor: '#ff9800',
  fontWeight: 600,
};

const closeBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  padding: 0,
  background: 'transparent',
  color: '#a1a1aa',
  border: '1px solid #3f3f46',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 12,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingBottom: 10,
  borderBottom: '1px solid #2a2a30',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#ff9800',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};

/** 한 줄 이름 — 넘치면 말줄임 */
const oneLineLabelStyle: React.CSSProperties = {
  flex: '0 0 38%',
  minWidth: 0,
  color: '#bbb',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const sliderValueStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: '#fff',
};

const rangeStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 40,
  accentColor: '#ff9800',
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#ddd',
  cursor: 'pointer',
};

const selectRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
};

const selectLabelStyle: React.CSSProperties = {
  color: '#bbb',
  minWidth: 0,
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginRight: 6,
};

const selectStyle: React.CSSProperties = {
  background: '#2a2a30',
  color: '#fff',
  border: '1px solid #444',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 12,
};

const colorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};

const colorLabelStyle: React.CSSProperties = {
  color: '#bbb',
  flex: 1,
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const colorInputStyle: React.CSSProperties = {
  width: 32,
  height: 22,
  border: '1px solid #444',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
};

const colorHexStyle: React.CSSProperties = {
  color: '#fff',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'monospace',
  fontSize: 11,
  minWidth: 60,
  textAlign: 'right',
};

const resetBtnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '6px 8px',
  background: '#2a2a30',
  color: '#aaa',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};

const addLightBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: '#2a2a30',
  color: '#ddd',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

const lightRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  color: '#ddd',
};

const removeBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  background: '#3a1f1f',
  color: '#fbb',
  border: '1px solid #5a2a2a',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
};
/** 커스틱 — 유리를 지나 모인 빛(래스터·경로 추적 공통, Caustics) */
/** 경로 추적 최종 해상도 — 75% 는 화소 56% 라 약 1.8배 빨리 깨끗해지고 조금 부드럽다 */
const FINAL_RES_OPTIONS = ['100%', '75% (빠름)', '50% (가장 빠름)'] as const;
const FINAL_RES_VALUE: Record<(typeof FINAL_RES_OPTIONS)[number], number> = { '100%': 1, '75% (빠름)': 0.75, '50% (가장 빠름)': 0.5 };
const FINAL_RES_LABEL: Record<number, (typeof FINAL_RES_OPTIONS)[number]> = { 1: '100%', 0.75: '75% (빠름)', 0.5: '50% (가장 빠름)' };

/** 커스틱을 만드는 조명 — 모든 조명은 실내 조명(스팟·점·면광)까지, 느리면 태양광만 */
const CAUSTIC_LIGHTS = ['모든 조명', '태양광만 (빠름)'] as const;

function CausticControls() {
  const mt = useMutracerStore((s) => s.mt);
  const setMt = useMutracerStore((s) => s.setMt);
  return (
    <>
      <Checkbox label="커스틱 (유리 그림자 속 빛)" checked={mt.causticShadows} onChange={(v) => setMt({ causticShadows: v })} />
      {mt.causticShadows && (
        <>
          <Select
            label="커스틱 조명"
            value={mt.causticSunOnly ? '태양광만 (빠름)' : '모든 조명'}
            options={CAUSTIC_LIGHTS}
            onChange={(v) => setMt({ causticSunOnly: v !== '모든 조명' })}
          />
          <Slider label="커스틱 광자 수" min={20000} max={2000000} step={10000} value={mt.causticPhotons} onChange={(v) => setMt({ causticPhotons: v })} />
          <Slider label="커스틱 번짐" min={0} max={4} step={0.1} value={mt.causticBlur} onChange={(v) => setMt({ causticBlur: v })} />
          <Slider label="커스틱 세기" min={0} max={4} step={0.05} value={mt.causticStrength} onChange={(v) => setMt({ causticStrength: v })} />
        </>
      )}
    </>
  );
}
