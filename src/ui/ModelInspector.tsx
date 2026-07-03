import { useState } from 'react';
import {
  useImportedModelStore,
  type GizmoMode,
  type MaterialPreset,
} from '@/features/models/importedModelStore';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';

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
    <DraggablePanel
      id="model-inspector"
      title="📦 모델"
      defaultY={80}
      width={280}
      accent="#22d3ee"
      right={
        <>
          <input
            value={model.name}
            onChange={(e) => update(model.id, { name: e.target.value })}
            style={nameInputStyle}
          />
          {/* ✕ = 패널 닫기(선택 해제). 모델은 지우지 않음 — 삭제는 아래 🗑 버튼. */}
          <button onClick={() => select(null)} title="닫기 (모델 유지)" style={closeBtnStyle}>
            ✕
          </button>
        </>
      }
    >
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
        {/* 축별 배율 — 씬의 크기 기즈모(빨/초/파 핸들 드래그)와 동일 값 */}
        <Vec3 value={model.scale} onChange={(i, v) => {
          const sc: [number, number, number] = [...model.scale];
          sc[i] = Math.max(0.01, v);
          update(model.id, { scale: sc });
        }} step={0.05} />
        <NumberRow
          label="균등"
          value={model.scale[0]}
          min={0.01}
          max={20}
          step={0.05}
          onChange={(v) => update(model.id, { scale: [v, v, v] })}
        />
      </Section>

      <MaterialSection modelId={model.id} />

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => update(model.id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })}
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
      <button
        onClick={() => { remove(model.id); select(null); }}
        style={{ ...resetBtnStyle, width: '100%', marginTop: 6, background: '#7f1d1d', color: '#fff' }}
        title="모델 삭제"
      >
        🗑 모델 삭제
      </button>
    </DraggablePanel>
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
            onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(i as 0 | 1 | 2, v); }}
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
        onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }}
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

const PRESETS: { p: MaterialPreset; label: string }[] = [
  { p: 'metal', label: '금속' },
  { p: 'glass', label: '유리' },
  { p: 'plastic', label: '플라스틱' },
  { p: 'ceramic', label: '세라믹' },
  { p: 'wood', label: '우드' },
  { p: 'rubber', label: '고무' },
  { p: 'emissive', label: '발광' },
];

/** 머티리얼 (PBR) 편집 섹션 — 슬롯 선택 → 속성 편집 + 프리셋 적용(추가) + 리셋(삭제). */
function MaterialSection({ modelId }: { modelId: string }) {
  const models = useImportedModelStore((s) => s.models);
  const editMaterial = useImportedModelStore((s) => s.editMaterial);
  const resetMaterial = useImportedModelStore((s) => s.resetMaterial);
  const applyPreset = useImportedModelStore((s) => s.applyMaterialPreset);
  const [selKey, setSelKey] = useState<string | null>(null);

  const model = models.find((m) => m.id === modelId);
  const slots = model?.materialSlots ?? [];
  if (slots.length === 0) {
    return (
      <Section title="머티리얼 (PBR)">
        <div style={{ fontSize: 10, opacity: 0.5 }}>로딩 중… (모델 머티리얼 감지)</div>
      </Section>
    );
  }
  const activeKey = selKey ?? slots[0].key;
  const slot = slots.find((s) => s.key === activeKey) ?? slots[0];
  const edit = model?.materialEdits?.[slot.key] ?? {};
  const val = <K extends keyof typeof slot.original>(k: K) =>
    (edit[k] ?? slot.original[k]) as number;
  const colorVal = (k: 'color' | 'emissive') => (edit[k] ?? slot.original[k] ?? '#ffffff') as string;
  const set = (patch: Parameters<typeof editMaterial>[2]) => editMaterial(modelId, slot.key, patch);

  return (
    <Section title={`머티리얼 (PBR) · ${slots.length}개`}>
      {/* 슬롯 선택 */}
      <select
        value={slot.key}
        onChange={(e) => setSelKey(e.target.value)}
        style={{ ...numInputStyle, width: '100%', marginBottom: 6 }}
      >
        {slots.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}{s.textures?.length ? ` (텍스처 ${s.textures.length})` : ''}
          </option>
        ))}
      </select>

      {/* 텍스처 맵 목록 — 이 재질이 참조하는 맵 종류/이름/해상도 */}
      {slot.textures && slot.textures.length > 0 ? (
        <div style={{ marginBottom: 8, padding: '4px 6px', background: '#1c1c1f', borderRadius: 4, border: '1px solid #2e2e33' }}>
          <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 3 }}>텍스처 맵 · {slot.textures.length}개</div>
          {slot.textures.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: 10, lineHeight: '16px' }}>
              <span style={{ color: '#7dd3fc', minWidth: 44 }}>{t.kind}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>{t.name}</span>
              {t.size && <span style={{ opacity: 0.5 }}>{t.size}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 8 }}>텍스처 맵 없음 (단색 재질)</div>
      )}

      {/* 프리셋 (추가 = 새 머티리얼 룩) */}
      <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 2 }}>프리셋 적용</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
        {PRESETS.map(({ p, label }) => (
          <button
            key={p}
            onClick={() => applyPreset(modelId, slot.key, p)}
            style={{
              padding: '3px 7px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
              border: '1px solid #3f3f46', background: '#27272a', color: '#e5e5e5',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <ColorRow label="베이스색" value={colorVal('color')} onChange={(v) => set({ color: v })} />
      <NumberRow label="거칠기" value={val('roughness')} min={0} max={1} step={0.02} onChange={(v) => set({ roughness: v })} />
      <NumberRow label="금속성" value={val('metalness')} min={0} max={1} step={0.02} onChange={(v) => set({ metalness: v })} />
      <NumberRow label="투과(유리)" value={val('transmission')} min={0} max={1} step={0.02} onChange={(v) => set({ transmission: v })} />
      <NumberRow label="굴절률" value={val('ior')} min={1} max={2.5} step={0.01} onChange={(v) => set({ ior: v })} />
      <NumberRow label="클리어코트" value={val('clearcoat')} min={0} max={1} step={0.02} onChange={(v) => set({ clearcoat: v })} />
      <NumberRow label="투명도" value={val('opacity')} min={0} max={1} step={0.02} onChange={(v) => set({ opacity: v })} />
      <ColorRow label="발광색" value={colorVal('emissive')} onChange={(v) => set({ emissive: v })} />
      <NumberRow label="발광강도" value={val('emissiveIntensity')} min={0} max={5} step={0.05} onChange={(v) => set({ emissiveIntensity: v })} />

      <button onClick={() => resetMaterial(modelId, slot.key)} style={{ ...resetBtnStyle, width: '100%', marginTop: 4 }}>
        ↺ 이 머티리얼 원본 복원 (삭제)
      </button>
    </Section>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={rowStyle}>
      <span style={lblStyle}>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: 34, height: 20, padding: 0, border: 'none', background: 'none' }} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ ...numInputStyle, flex: 1 }} />
    </label>
  );
}

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