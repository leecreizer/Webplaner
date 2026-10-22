import { useCustomLightStore, type CustomLight } from '@/engine/stores/customLightStore';
import { lightRotation } from '@/engine/lighting/CustomLights';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';

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
  const gizmoMode = useCustomLightStore((s) => s.gizmoMode);
  const setGizmoMode = useCustomLightStore((s) => s.setGizmoMode);

  const light = lights.find((l) => l.id === selectedId);
  if (!light) return null;
  // 회전(도) — 값이 없으면 종류별 기본(사각 아래·스포트 끝점 쪽). 입력하면 그 값으로 고정되고 기즈모 마커도 같이 돈다
  const rotDeg = lightRotation(light).map((r) => Math.round(((r * 180) / Math.PI) * 10) / 10) as [number, number, number];
  const setRot = (i: 0 | 1 | 2, deg: number) => {
    const r = [...lightRotation(light)] as [number, number, number];
    r[i] = (deg * Math.PI) / 180;
    set({ rotation: r });
  };
  const modes: { m: 'translate' | 'rotate' | 'target'; label: string }[] = [
    { m: 'translate', label: '이동' },
    ...(light.kind !== 'point' ? [{ m: 'rotate' as const, label: '회전' }] : []),
    ...(light.kind === 'spot' ? [{ m: 'target' as const, label: '끝점' }] : []),
  ];

  const set = (patch: Partial<CustomLight>) => update(light.id, patch);
  const setPos = (i: 0 | 1 | 2, v: number) => {
    const p: [number, number, number] = [...light.position];
    p[i] = v;
    set({ position: p });
  };
  const setTarget = (i: 0 | 1 | 2, v: number) => {
    const t: [number, number, number] = light.target ? [...light.target] : [0, 0, 0];
    t[i] = v;
    // 끝점을 직접 넣으면 회전은 버린다 — 회전이 있으면 그 방향이 끝점보다 앞선다(spotAim)
    set({ target: t, rotation: undefined });
  };

  return (
    <DraggablePanel
      id="light-inspector"
      title={kindLabel(light.kind)}
      defaultY={80}
      width={280}
      accent="#fbbf24"
      right={
        <>
          <input
            value={light.name}
            onChange={(e) => set({ name: e.target.value })}
            style={nameInputStyle}
          />
          <button onClick={() => select(null)} title="닫기 (라이트 유지)" style={delBtnStyle}>
            ✕
          </button>
        </>
      }
    >
      <Section title="조작 (기즈모)">
        <div style={{ display: 'flex', gap: 4 }}>
          {modes.map(({ m, label }) => (
            <button key={m} onClick={() => setGizmoMode(m)} style={modeBtnStyle(gizmoMode === m || (gizmoMode === 'target' && m === 'translate' && light.kind !== 'spot'))}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
          R = 회전 · G·T = 이동{light.kind === 'spot' ? ' · 분홍 점 = 끝점(비추는 곳)' : ''}
        </div>
      </Section>

      <Section title="공통">
        <ColorField label="색" value={light.color} onChange={(v) => set({ color: v })} />
        <NumberField
          label="강도"
          value={light.intensity}
          min={0}
          max={light.kind === 'spot' || light.kind === 'rect' ? 200 : light.kind === 'point' ? 100 : 20}
          step={0.1}
          onChange={(v) => set({ intensity: v })}
        />
      </Section>

      {(light.kind === 'point' || light.kind === 'spot') && (
        <Section title="감쇠 / 그림자">
          <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 4 }}>
            거리·감쇠는 래스터에만 — 경로 추적은 실제 빛처럼 거리 제곱으로 약해진다{light.kind === 'spot' ? '(범위는 콘 각도로)' : ''}
          </div>
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
          <NumberField
            label="퍼짐 (0 곧게 ~ 1 넓게)"
            value={light.spread ?? 1}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => set({ spread: v })}
          />
          <div style={{ fontSize: 10, opacity: 0.55 }}>퍼짐은 경로 추적에만 — 작을수록 빛이 아래로 모여 좁은 영역만 밝힌다</div>
          <NumberField
            label="도달 거리(m, 표시)"
            value={light.distance ?? 3}
            min={0.2}
            max={20}
            step={0.1}
            onChange={(v) => set({ distance: v })}
          />
          <div style={{ fontSize: 10, opacity: 0.55 }}>노란 영역 = 퍼짐 각도 × 도달 거리. 실제 빛은 거리 제곱으로 약해질 뿐 끊기지 않는다</div>
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

      {light.kind !== 'point' && (
        <Section title="회전 (°)">
          <Vec3Field label={light.kind === 'spot' ? '빛 방향 (입력하면 끝점이 따라감)' : '회전'} value={rotDeg} step={5} onChange={(i, v) => setRot(i, v)} />
        </Section>
      )}

      <button
        onClick={() => { remove(light.id); select(null); }}
        style={{
          width: '100%', padding: '6px 10px', background: '#7f1d1d', color: '#fff',
          border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11, fontWeight: 600,
        }}
        title="라이트 삭제"
      >
        🗑 라이트 삭제
      </button>
    </DraggablePanel>
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
        onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }}
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
  step = 0.1,
}: {
  label: string;
  value: readonly [number, number, number] | [number, number, number];
  onChange: (i: 0 | 1 | 2, v: number) => void;
  step?: number;
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
              step={step}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(i as 0 | 1 | 2, v); }}
              style={{ ...numInputStyle, width: '100%' }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ============ styles ============

const modeBtnStyle = (on: boolean): React.CSSProperties => ({
  flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 3, cursor: 'pointer', border: '1px solid #3f3f46',
  background: on ? '#fbbf24' : '#27272a', color: on ? '#0a0a0a' : '#e5e5e5', fontWeight: on ? 700 : 400,
});

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