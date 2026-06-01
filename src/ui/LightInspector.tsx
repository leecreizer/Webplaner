import { useCustomLightStore, type CustomLight } from '@/engine/stores/customLightStore';

/**
 * 선택된 커스텀 라이트의 모든 속성을 편집하는 floating panel.
 *
 * - `customLightStore.selectedId` 가 null 이 아닐 때만 표시
 * - 라이트 kind 별로 적절한 컨트롤만 노출 (point/spot/rect/hemisphere)
 * - 헤더에 이름 변경 + ✕ 삭제
 *
 * 위치: 우측, LightingPanel 옆 (top:80px / right:340px).
 */
export function LightInspector() {
  const selectedId = useCustomLightStore((s) => s.selectedId);
  const lights = useCustomLightStore((s) => s.lights);
  const update = useCustomLightStore((s) => s.update);
  const remove = useCustomLightStore((s) => s.remove);
  const select = useCustomLightStore((s) => s.select);

  const light = lights.find((l) => l.id === selectedId);
  if (!light) return null;

  const set = (patch: Partial<CustomLight>) => update(light.id, patch);
  const setPos = (i: 0 | 1 | 2, v: number) => {
    const p: [number, number, number] = [...light.position];
    p[i] = v;
    set({ position: p });
  };
  const setTarget = (i: 0 | 1 | 2, v: number) => {
    const t: [number, number, number] = light.target ? [...light.target] : [0, 0, 0];
    t[i] = v;
    set({ target: t });
  };

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{kindLabel(light.kind)}</span>
        <input
          value={light.name}
          onChange={(e) => set({ name: e.target.value })}
          style={nameInputStyle}
        />
        <button
          onClick={() => {
            remove(light.id);
            select(null);
          }}
          title="삭제"
          style={delBtnStyle}
        >
          ✕
        </button>
      </header>

      <Section title="공통">
        <ColorField label="색" value={light.color} onChange={(v) => set({ color: v })} />
        <NumberField
          label="강도"
          value={light.intensity}
          min={0}
          max={light.kind === 'spot' ? 200 : light.kind === 'point' ? 100 : 20}
          step={0.1}
          onChange={(v) => set({ intensity: v })}
        />
      </Section>

      {(light.kind === 'point' || light.kind === 'spot') && (
        <Section title="감쇠 / 그림자">
          <NumberField
            label="거리(m)"
            value={light.distance ?? 10}
            min={0}
            max={30}
            step={0.1}
            onChange={(v) => set({ distance: v })}
          />
          <NumberField
            label="감쇠 지수"
            value={light.decay ?? 2}
            min={0}
            max={4}
            step={0.05}
            onChange={(v) => set({ decay: v })}
          />
          <CheckboxField
            label="그림자 캐스팅"
            checked={light.castShadow ?? false}
            onChange={(v) => set({ castShadow: v })}
          />
          {light.castShadow && (
            <>
              <NumberField
                label="그림자 소프트니스"
                value={light.shadowRadius ?? 4}
                min={0}
                max={20}
                step={0.5}
                onChange={(v) => set({ shadowRadius: v })}
              />
              <CheckboxField
                label="자동 업데이트 (dynamic)"
                checked={light.shadowAutoUpdate ?? true}
                onChange={(v) => set({ shadowAutoUpdate: v })}
              />
            </>
          )}
        </Section>
      )}

      {light.kind === 'spot' && (
        <Section title="스팟 모양">
          <NumberField
            label="콘 각도(°)"
            value={Math.round(((light.angle ?? Math.PI / 6) * 180) / Math.PI)}
            min={1}
            max={89}
            step={1}
            onChange={(v) => set({ angle: (v * Math.PI) / 180 })}
          />
          <NumberField
            label="가장자리 부드러움"
            value={light.penumbra ?? 0.4}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => set({ penumbra: v })}
          />
          <Vec3Field
            label="타겟"
            value={light.target ?? [0, 0, 0]}
            onChange={(i, v) => setTarget(i, v)}
          />
        </Section>
      )}

      {light.kind === 'rect' && (
        <Section title="면 광원">
          <NumberField
            label="너비(m)"
            value={light.width ?? 2}
            min={0.1}
            max={10}
            step={0.05}
            onChange={(v) => set({ width: v })}
          />
          <NumberField
            label="높이(m)"
            value={light.height ?? 1}
            min={0.1}
            max={10}
            step={0.05}
            onChange={(v) => set({ height: v })}
          />
        </Section>
      )}

      {light.kind === 'hemisphere' && (
        <Section title="헤미스피어">
          <ColorField
            label="지면 색"
            value={light.groundColor ?? '#404040'}
            onChange={(v) => set({ groundColor: v })}
          />
        </Section>
      )}

      {light.kind !== 'hemisphere' && (
        <Section title="위치">
          <Vec3Field label="position" value={light.position} onChange={(i, v) => setPos(i, v)} />
        </Section>
      )}
    </div>
  );
}

function kindLabel(kind: CustomLight['kind']): string {
  return (
    { point: '● 포인트', spot: '◑ 스팟', rect: '▭ 렉탱글', hemisphere: '◐ 헤미스피어' } as const
  )[kind];
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

function Vec3Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: readonly [number, number, number] | [number, number, number];
  onChange: (i: 0 | 1 | 2, v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={lblStyle}>{label}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <label key={axis} style={{ flex: 1, fontSize: 10, opacity: 0.7 }}>
            {axis}
            <input
              type="number"
              value={value[i]}
              step={0.1}
              onChange={(e) => onChange(i as 0 | 1 | 2, parseFloat(e.target.value) || 0)}
              style={{ ...numInputStyle, width: '100%' }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ============ styles ============

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
  zIndex: 90,
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

const nameInputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: '#fbbf24',
  border: '1px solid transparent',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 13,
  fontWeight: 600,
};

const delBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  padding: 0,
  background: '#7f1d1d',
  color: '#fff',
  border: 'none',
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
  width: 90,
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