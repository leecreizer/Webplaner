import { useMeshSelectionStore, type MeshMaterialOverride } from '@/features/selection/meshSelectionStore';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';

/**
 * 선택된 mesh (wall / floor / ceiling) 의 material 속성 편집 패널.
 *
 * - meshSelectionStore.selectedMeshKey 가 있을 때만 표시
 * - color / roughness / metalness / opacity / emissive / emissiveIntensity 슬라이더
 * - "기본값으로 리셋" 버튼
 *
 * 위치: 좌측 하단 floating (LightInspector 와 겹치지 않게).
 */
export function MeshInspector() {
  const selectedKey = useMeshSelectionStore((s) => s.selectedMeshKey);
  const override = useMeshSelectionStore((s) => (selectedKey ? s.materials[selectedKey] : undefined));
  const setMaterial = useMeshSelectionStore((s) => s.setMaterial);
  const resetMaterial = useMeshSelectionStore((s) => s.resetMaterial);
  const selectMesh = useMeshSelectionStore((s) => s.selectMesh);

  if (!selectedKey) return null;

  const [kind, ownerId] = selectedKey.split('-');
  const set = (patch: MeshMaterialOverride) => setMaterial(selectedKey, patch);

  return (
    <DraggablePanel
      id="mesh-inspector"
      title={`${kindLabel(kind)} #${ownerId}`}
      defaultY={400}
      width={300}
      accent="#fbbf24"
      right={
        <button onClick={() => selectMesh(null)} title="선택 해제" style={closeBtnStyle}>✕</button>
      }
    >
      <Section title="Material">
        <ColorField label="색" value={override?.color ?? '#cccccc'} onChange={(v) => set({ color: v })} />
        <NumberField
          label="거칠기 (roughness)"
          value={override?.roughness ?? 0.85}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => set({ roughness: v })}
        />
        <NumberField
          label="금속성 (metalness)"
          value={override?.metalness ?? 0.0}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => set({ metalness: v })}
        />
        <NumberField
          label="투명도 (opacity)"
          value={override?.opacity ?? 1.0}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => set({ opacity: v })}
        />
      </Section>

      <Section title="Emissive (자체 발광)">
        <ColorField
          label="발광 색"
          value={override?.emissive ?? '#000000'}
          onChange={(v) => set({ emissive: v })}
        />
        <NumberField
          label="발광 강도"
          value={override?.emissiveIntensity ?? 0}
          min={0}
          max={5}
          step={0.05}
          onChange={(v) => set({ emissiveIntensity: v })}
        />
      </Section>

      <button onClick={() => resetMaterial(selectedKey)} style={resetBtnStyle}>
        ↺ 디폴트로 리셋
      </button>
    </DraggablePanel>
  );
}

function kindLabel(kind: string): string {
  return ({ wall: '▌ 벽', floor: '▭ 바닥', ceiling: '▬ 천장', product: '● 가구' } as Record<string, string>)[kind] ?? kind;
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

const resetBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: '#3f3f46',
  color: '#fbbf24',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};