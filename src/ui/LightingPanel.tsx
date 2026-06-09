import { useState } from 'react';
import {
  useLightingStore,
  type EnvironmentPreset,
  type ShadowQuality,
  type ToneMappingMode,
} from '@/engine/stores/lightingStore';
import { useViewStore } from '@/engine/stores/viewStore';
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
const GI_MODES = ['hemisphere', 'single-probe', 'probe-grid', 'path-tracer'] as const;
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
          defaultSide="right"
          defaultTop={80}
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
            <Slider label="태양 강도" min={0} max={5} step={0.05} value={s.intensity} onChange={s.setIntensity} />
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

          <Section title="그리드">
            <Checkbox label="그리드 표시" checked={v.showGrid} onChange={v.setShowGrid} />
            <ColorRow label="셀 컬러" value={v.gridCellColor} onChange={v.setGridCellColor} />
            <ColorRow label="섹션 컬러" value={v.gridSectionColor} onChange={v.setGridSectionColor} />
            <Slider label="투명도" min={0} max={1} step={0.05} value={v.gridOpacity} onChange={v.setGridOpacity} />
          </Section>

          <Section title="그림자">
            <Checkbox label="그림자 캐스팅" checked={s.castShadow} onChange={s.setCastShadow} />
            <Select label="품질" value={s.shadowQuality} options={SHADOW_QUALITIES} onChange={s.setShadowQuality} />
            <Slider label="소프트니스" min={0} max={30} step={1} value={s.shadowSoftness} onChange={s.setShadowSoftness} />
            <Slider label="그림자 강도" min={0} max={1.2} step={0.05} value={s.shadowStrength} onChange={s.setShadowStrength} />
            <ColorRow label="그림자 색" value={s.shadowColor} onChange={s.setShadowColor} />
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
            <Slider label="강도" min={0} max={3} step={0.05} value={s.environmentIntensity} onChange={s.setEnvironmentIntensity} />
          </Section>

          <Section title="Tone Mapping">
            <Select label="모드" value={s.toneMapping} options={TONE_MAPPING_OPTIONS} onChange={s.setToneMapping} />
            <Slider label="노출" min={0.1} max={3} step={0.05} value={s.toneMappingExposure} onChange={s.setToneMappingExposure} />
          </Section>

          <CustomLightSection />

          <Section title="PostFX">
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

      {(l.kind === 'point' || l.kind === 'spot') && (
        <Checkbox label="그림자" checked={l.castShadow ?? false} onChange={(v) => onChange({ castShadow: v })} />
      )}
    </div>
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
  return (
    <div style={sliderRowStyle}>
      <div style={sliderLabelStyle}>
        <span>{label}</span>
        <span style={sliderValueStyle}>
          {value.toFixed(step < 1 ? 2 : 0)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={rangeStyle}
      />
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
    <label style={checkboxRowStyle}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
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
      <span style={selectLabelStyle}>{label}</span>
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
};

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const sliderLabelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  color: '#bbb',
};

const sliderValueStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: '#fff',
};

const rangeStyle: React.CSSProperties = {
  width: '100%',
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