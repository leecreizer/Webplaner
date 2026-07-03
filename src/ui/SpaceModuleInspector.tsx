import {
  useSpaceModuleStore,
  MODULE_PRESETS,
  type ModuleKind,
  type ModuleSide,
  type ModuleOpening,
} from '@/features/spaceModules/spaceModuleStore';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';

const SIDES: ModuleSide[] = ['N', 'E', 'S', 'W'];
const ROTATIONS: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

/**
 * 공간 모듈 편집 우측 패널 — selectedId 있을 때만 표시.
 *
 * - 종류 / 이름 / 치수(폭·깊이·벽높이) / 회전 편집
 * - 개구부(문/개구부) 목록 편집 — 추가/삭제, 겹침으로 비활성화된 항목 표시
 * - 모듈 삭제
 */
export function SpaceModuleInspector() {
  const modules = useSpaceModuleStore((s) => s.modules);
  const selectedId = useSpaceModuleStore((s) => s.selectedId);
  const update = useSpaceModuleStore((s) => s.update);
  const remove = useSpaceModuleStore((s) => s.remove);
  const select = useSpaceModuleStore((s) => s.select);
  const addOpening = useSpaceModuleStore((s) => s.addOpening);
  const removeOpening = useSpaceModuleStore((s) => s.removeOpening);
  const updateOpening = useSpaceModuleStore((s) => s.updateOpening);

  const m = modules.find((mod) => mod.id === selectedId);
  if (!m) return null;

  return (
    <DraggablePanel
      id="space-module-inspector"
      title="🏠 공간 모듈"
      defaultY={80}
      width={300}
      accent="#a3e635"
      right={
        <>
          <input
            value={m.name}
            onChange={(e) => update(m.id, { name: e.target.value })}
            style={nameInputStyle}
          />
          <button onClick={() => select(null)} title="닫기 (모듈 유지)" style={closeBtnStyle}>
            ✕
          </button>
        </>
      }
    >
      <Section title="종류">
        <select
          value={m.kind}
          onChange={(e) => update(m.id, { kind: e.target.value as ModuleKind })}
          style={{ ...numInputStyle, width: '100%' }}
        >
          {(Object.keys(MODULE_PRESETS) as ModuleKind[]).map((k) => (
            <option key={k} value={k}>
              {MODULE_PRESETS[k].label}
            </option>
          ))}
        </select>
      </Section>

      <Section title="치수 (m)">
        <NumberRow
          label="폭"
          value={m.w}
          min={0.6}
          max={12}
          step={0.1}
          onChange={(v) => update(m.id, { w: v })}
        />
        <NumberRow
          label="깊이"
          value={m.d}
          min={0.6}
          max={12}
          step={0.1}
          onChange={(v) => update(m.id, { d: v })}
        />
        <NumberRow
          label="벽높이"
          value={m.wallH}
          min={2.0}
          max={4.0}
          step={0.05}
          onChange={(v) => update(m.id, { wallH: v })}
        />
      </Section>

      <Section title="회전 (°)">
        <div style={{ display: 'flex', gap: 4 }}>
          {ROTATIONS.map((r) => (
            <button
              key={r}
              onClick={() => update(m.id, { ry: r })}
              style={{
                flex: 1,
                padding: '5px 0',
                fontSize: 11,
                borderRadius: 3,
                cursor: 'pointer',
                border: '1px solid #3f3f46',
                background: m.ry === r ? '#a3e635' : '#27272a',
                color: m.ry === r ? '#0a0a0a' : '#e5e5e5',
                fontWeight: m.ry === r ? 700 : 400,
              }}
            >
              {r}°
            </button>
          ))}
        </div>
      </Section>

      <Section title={`개구부 · ${m.openings.length}개`}>
        {m.openings.map((o) => (
          <OpeningRow
            key={o.id}
            opening={o}
            onChange={(patch) => updateOpening(m.id, o.id, patch)}
            onRemove={() => removeOpening(m.id, o.id)}
          />
        ))}
        <button
          onClick={() =>
            addOpening(m.id, { side: 'N', type: 'door', offset: m.w / 2, width: 0.9, height: 2.1 })
          }
          style={{ ...resetBtnStyle, width: '100%', marginTop: 4 }}
        >
          + 개구부 추가
        </button>
      </Section>

      <button
        onClick={() => {
          remove(m.id);
          select(null);
        }}
        style={{ ...resetBtnStyle, width: '100%', marginTop: 6, background: '#7f1d1d', color: '#fff' }}
        title="모듈 삭제"
      >
        🗑 모듈 삭제
      </button>
    </DraggablePanel>
  );
}

function OpeningRow({
  opening,
  onChange,
  onRemove,
}: {
  opening: ModuleOpening;
  onChange: (patch: Partial<ModuleOpening>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        marginBottom: 6,
        padding: '4px 6px',
        background: '#1c1c1f',
        borderRadius: 4,
        border: '1px solid #2e2e33',
      }}
    >
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
        <select
          value={opening.side}
          onChange={(e) => onChange({ side: e.target.value as ModuleSide })}
          style={{ ...numInputStyle, width: 44 }}
        >
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={opening.type}
          onChange={(e) => onChange({ type: e.target.value as ModuleOpening['type'] })}
          style={{ ...numInputStyle, width: 60 }}
        >
          <option value="door">문</option>
          <option value="opening">개구부</option>
          <option value="window">창호</option>
        </select>
        {opening.suppressedBy && (
          <span style={{ fontSize: 10, color: '#f87171' }} title={`suppressedBy: ${opening.suppressedBy}`}>
            🔇 겹침 비활성
          </span>
        )}
        <button onClick={onRemove} style={{ ...closeBtnStyle, marginLeft: 'auto' }} title="삭제">
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <MiniNumField label="위치" value={opening.offset} onChange={(v) => onChange({ offset: v })} />
        <MiniNumField label="폭" value={opening.width} onChange={(v) => onChange({ width: v })} />
        <MiniNumField label="높이" value={opening.height} onChange={(v) => onChange({ height: v })} />
        {opening.type === 'window' && (
          <MiniNumField label="하단" value={opening.sill ?? 0.9} onChange={(v) => onChange({ sill: v })} />
        )}
      </div>
    </div>
  );
}

function MiniNumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ flex: 1, fontSize: 10, opacity: 0.75 }}>
      {label}
      <input
        type="number"
        value={Number(value.toFixed(2))}
        step={0.05}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        style={{ ...numInputStyle, width: '100%' }}
      />
    </label>
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
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
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

const nameInputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: '#a3e635',
  border: '1px solid transparent',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 13,
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
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: '1px dashed #3f3f46',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#a3e635',
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
  color: '#a3e635',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};
