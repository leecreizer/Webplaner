import { useLightingStore } from '@/engine/stores/lightingStore';

/**
 * 기본 광원 (Sun / Ambient / Hemisphere) 편집 우측 패널.
 *
 * SceneOutliner 의 *기본 광원* 행을 클릭하면 `lightingStore.selectedBuiltin` 이 set 되고
 * 본 inspector 가 활성. 종류에 따라 적절한 슬라이더만 노출.
 *
 * 위치: 우측 (LightInspector 와 같은 자리). 둘 다 동시 표시되지 않게 — 사용자는 보통
 * 하나만 선택하므로 충돌 적음.
 */
export function BuiltinLightInspector() {
  const sel = useLightingStore((s) => s.selectedBuiltin);
  if (!sel) return null;
  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <span style={titleStyle}>
          {sel === 'sun' && '☀ 태양광 (Directional)'}
          {sel === 'ambient' && '○ 환경광 (Ambient)'}
          {sel === 'hemi' && '◐ 헤미스피어'}
        </span>
        <button
          onClick={() => useLightingStore.getState().setSelectedBuiltin(null)}
          style={closeBtnStyle}
          title="선택 해제"
        >
          ✕
        </button>
      </header>

      {sel === 'sun' && <SunInspector />}
      {sel === 'ambient' && <AmbientInspector />}
      {sel === 'hemi' && <HemiInspector />}
    </div>
  );
}

function SunInspector() {
  const s = useLightingStore();
  return (
    <>
      <Section title="태양 방향 / 강도">
        <NumberField label="방위각 (azimuth°)" value={s.azimuth} min={0} max={360} step={1} onChange={s.setAzimuth} />
        <NumberField label="고도 (elevation°)" value={s.elevation} min={0} max={90} step={1} onChange={s.setElevation} />
        <NumberField label="거리 (m)" value={s.distance} min={1} max={50} step={0.5} onChange={s.setDistance} />
        <NumberField label="강도" value={s.intensity} min={0} max={10} step={0.05} onChange={s.setIntensity} />
      </Section>
      <Section title="그림자">
        <CheckboxField label="그림자 캐스팅" checked={s.castShadow} onChange={s.setCastShadow} />
        <NumberField label="소프트니스" value={s.shadowSoftness} min={0} max={30} step={1} onChange={s.setShadowSoftness} />
        <NumberField label="그림자 강도" value={s.shadowStrength} min={0} max={1.2} step={0.05} onChange={s.setShadowStrength} />
        <ColorField label="그림자 색" value={s.shadowColor} onChange={s.setShadowColor} />
      </Section>
      <Section title="그림자 정밀도 (offset / 계단)">
        <NumberField
          label="bias (×0.0001)"
          value={Math.round(s.shadowBias * 10000)}
          min={-50}
          max={10}
          step={1}
          onChange={(v) => s.setShadowBias(v / 10000)}
        />
        <NumberField
          label="normalBias"
          value={s.shadowNormalBias}
          min={0}
          max={0.2}
          step={0.005}
          onChange={s.setShadowNormalBias}
        />
        <NumberField
          label="frustum 반경(m)"
          value={s.shadowFrustumSize}
          min={3}
          max={50}
          step={1}
          onChange={s.setShadowFrustumSize}
        />
        <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4, lineHeight: 1.4 }}>
          • bias 가 음수로 클수록 그림자가 객체에서 *떨어져 시작* (peter-panning).
          0 에 가까우면 acne (얼룩).
          <br />• normalBias 는 법선 방향 offset — peter-panning 보완.
          <br />• frustum 작을수록 정밀도 ↑ (계단 ↓), 단 그림자 범위 ↓.
        </div>
      </Section>
    </>
  );
}

function AmbientInspector() {
  const s = useLightingStore();
  return (
    <Section title="환경광">
      <NumberField label="강도" value={s.ambientIntensity} min={0} max={2} step={0.05} onChange={s.setAmbientIntensity} />
      <ColorField label="색 (=그림자 색과 공유)" value={s.shadowColor} onChange={s.setShadowColor} />
    </Section>
  );
}

function HemiInspector() {
  const s = useLightingStore();
  return (
    <Section title="헤미스피어 (Sky/Ground)">
      <NumberField label="강도" value={s.giIntensity} min={0} max={2} step={0.05} onChange={s.setGiIntensity} />
      <ColorField label="Sky 색 (위)" value={s.giSkyColor} onChange={s.setGiSkyColor} />
      <ColorField label="Ground 색 (아래)" value={s.giGroundColor} onChange={s.setGiGroundColor} />
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

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={rowStyle}>
      <span style={lblStyle}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={step}
        style={numInputStyle}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={rowStyle}>
      <span style={lblStyle}>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 38, height: 22, padding: 0, border: 'none', background: 'none' }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...numInputStyle, width: 80 }}
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ ...rowStyle, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginRight: 6 }}
      />
      <span style={{ ...lblStyle, flex: 1 }}>{label}</span>
    </label>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  right: 340,
  width: 280,
  maxHeight: 'calc(100vh - 120px)',
  overflowY: 'auto',
  background: 'rgba(20, 20, 22, 0.95)',
  color: '#e5e5e5',
  border: '1px solid #3f3f46',
  borderRadius: 6,
  padding: 10,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  zIndex: 91,
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingBottom: 8,
  marginBottom: 8,
  borderBottom: '1px solid #3f3f46',
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  fontWeight: 600,
  color: '#fbbf24',
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
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: '1px dashed #3f3f46',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#fbbf24',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};

const lblStyle: React.CSSProperties = {
  width: 110,
  fontSize: 11,
  opacity: 0.85,
};

const numInputStyle: React.CSSProperties = {
  width: 56,
  background: '#27272a',
  color: '#e5e5e5',
  border: '1px solid #3f3f46',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
};