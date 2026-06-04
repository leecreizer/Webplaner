import { useImportedModelStore, type GizmoMode } from '@/features/models/importedModelStore';

/**
 * 불러온 모델 편집 우측 패널 — selectedId 있을 때만 표시.
 *
 * - gizmo 모드 (이동/회전/크기) 토글 → 씬의 TransformControls 모드 전환
 * - position / rotation(deg) / scale 수치 편집
 * - 바닥에 정렬, 리셋, 삭제
 */
export function ModelInspector() {
  const models = useImportedModelStore((s) => s.models);
  const selectedId = useImportedModelStore((s) => s.selectedId);
  const gizmoMode = useImportedModelStore((s) => s.gizmoMode);
  const setGizmoMode = useImportedModelStore((s) => s.setGizmoMode);
  const update = useImportedModelStore((s) => s.update);
  const remove = useImportedModelStore((s) => s.remove);
  const select = useImportedModelStore((s) => s.select);

  const model = models.find((m) => m.id === selectedId);
  if (!model) return null;

  const setPos = (i: 0 | 1 | 2, v: number) => {
    const p: [number, number, number] = [...model.position];
    p[i] = v;
    update(model.id, { position: p });
  };
  const setRot = (i: 0 | 1 | 2, v: number) => {
    const r: [number, number, number] = [...model.rotation];
    r[i] = v;
    update(model.id, { rotation: r });
  };

  const modes: { m: GizmoMode; label: string }[] = [
    { m: 'translate', label: '이동' },
    { m: 'rotate', label: '회전' },
    { m: 'scale', label: '크기' },
  ];

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <span style={{ fontSize: 11, opacity: 0.7 }}>📦 모델</span>
        <input
          value={model.name}
          onChange={(e) => update(model.id, { name: e.target.value })}
          style={nameInputStyle}
        />
        <button onClick={() => { remove(model.id); select(null); }} title="삭제" style={delBtnStyle}>
          ✕
        </button>
      </header>

      <Section title="조작 모드 (gizmo)">
        <div style={{ display: 'flex', gap: 4 }}>
          {modes.map(({ m, label }) => (
            <button
              key={m}
              onClick={() => setGizmoMode(m)}
              style={{
                flex: 1,
                padding: '5px 0',
                fontSize: 11,
                borderRadius: 3,
                cursor: 'pointer',
                border: '1px solid #3f3f46',
                background: gizmoMode === m ? '#22d3ee' : '#27272a',
                color: gizmoMode === m ? '#0a0a0a' : '#e5e5e5',
                fontWeight: gizmoMode === m ? 700 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
          씬의 화살표/링/박스 핸들을 드래그해 직접 조작 가능
        </div>
      </Section>

      <Section title="위치 (m)">
        <Vec3 value={model.position} onChange={setPos} step={0.1} />
      </Section>

      <Section title="회전 (°)">
        <Vec3 value={model.rotation} onChange={setRot} step={5} />
      </Section>

      <Section title="크기">
        <NumberRow
          label="scale"
          value={model.scale}
          min={0.01}
          max={20}
          step={0.05}
          onChange={(v) => update(model.id, { scale: v })}
        />
      </Section>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => update(model.id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}
          style={resetBtnStyle}
        >
          ↺ 리셋
        </button>
        <button
          onClick={() => update(model.id, { position: [model.position[0], 0, model.position[2]] })}
          style={resetBtnStyle}
          title="Y=0 바닥에 맞춤"
        >
          ⊥ 바닥 정렬
        </button>
      </div>
    </div>
  );
}

function Vec3({
  value,
  onChange,
  step,
}: {
  value: readonly [number, number, number];
  onChange: (i: 0 | 1 | 2, v: number) => void;
  step: number;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label key={axis} style={{ flex: 1, fontSize: 10, opacity: 0.7 }}>
          {axis}
          <input
            type="number"
            value={Number(value[i].toFixed(2))}
            step={step}
            onChange={(e) => onChange(i as 0 | 1 | 2, parseFloat(e.target.value) || 0)}
            style={{ ...numInputStyle, width: '100%' }}
          />
        </label>
      ))}
    </div>
  );
}

function NumberRow({
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
        value={Number(value.toFixed(2))}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={numInputStyle}
      />
    </label>
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
  zIndex: 92,
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
  color: '#22d3ee',
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
  color: '#22d3ee',
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
  width: 50,
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

const resetBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  background: '#3f3f46',
  color: '#22d3ee',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};