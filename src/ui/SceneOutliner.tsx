import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { useCustomLightStore } from '@/engine/stores/customLightStore';
import { useMeshSelectionStore, meshKey } from '@/features/selection/meshSelectionStore';
import { useSelectionStore } from '@/features/selection/selectionStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';
import { Wall } from '@/domain/structures/Wall';
import { Space } from '@/domain/structures/Space';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';

/**
 * 씬 트리 outliner — 모든 오브젝트 (벽 / 공간 / 가구 / 라이트) 목록.
 *
 * 각 항목:
 *  - 이름/타입
 *  - 클릭 = 선택 (mesh/light inspector 활성)
 *  - 👁️ = visibility 토글 (visibilityStore)
 *  - ✕  = 삭제
 *
 * 위치: 좌측 상단 floating panel.
 */
export function SceneOutliner() {
  const walls = useLayoutStore((s) => s.walls);
  const spaces = useLayoutStore((s) => s.spaces);
  const lights = useCustomLightStore((s) => s.lights);
  const selectedMeshKeys = useMeshSelectionStore((s) => s.selectedMeshKeys);
  const selectMesh = useMeshSelectionStore((s) => s.selectMesh);
  const selectedLightId = useCustomLightStore((s) => s.selectedId);
  const selectLight = useCustomLightStore((s) => s.select);
  const removeLight = useCustomLightStore((s) => s.remove);
  const hidden = useVisibilityStore((s) => s.hidden);
  const toggle = useVisibilityStore((s) => s.toggle);

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <span>🌳 씬 트리</span>
      </header>

      <Section title={`벽 (${walls.length})`}>
        {walls.length === 0 && <Empty />}
        {walls.map((w) => {
          const key = meshKey('wall', w.wallIndex);
          return (
            <Row
              key={key}
              label={`wall-${w.wallIndex}`}
              isSelected={selectedMeshKeys.includes(key)}
              isHidden={!!hidden[key]}
              onSelect={(shift) => {
                if (!shift) useSelectionStore.getState().selectWall(w);
                selectMesh(key, shift);
              }}
              onToggle={() => toggle(key)}
              onDelete={() => deleteWall(w)}
            />
          );
        })}
      </Section>

      <Section title={`공간 (${spaces.length})`}>
        {spaces.length === 0 && <Empty />}
        {spaces.map((sp) => {
          const floorKey = meshKey('floor', sp.spaceIndex);
          const ceilingKey = meshKey('ceiling', sp.spaceIndex);
          return (
            <div key={`sp-${sp.spaceIndex}`} style={spaceGroupStyle}>
              <div style={spaceTitleStyle}>{sp.name || `공간 ${sp.spaceIndex}`}</div>
              <Row
                label="└ 바닥"
                isSelected={selectedMeshKeys.includes(floorKey)}
                isHidden={!!hidden[floorKey]}
                onSelect={(shift) => selectMesh(floorKey, shift)}
                onToggle={() => toggle(floorKey)}
                indent
              />
              <Row
                label="└ 천장"
                isSelected={selectedMeshKeys.includes(ceilingKey)}
                isHidden={!!hidden[ceilingKey]}
                onSelect={(shift) => selectMesh(ceilingKey, shift)}
                onToggle={() => toggle(ceilingKey)}
                indent
              />
            </div>
          );
        })}
      </Section>

      <Section title={`라이트 (${lights.length})`}>
        {lights.length === 0 && <Empty />}
        {lights.map((l) => {
          const key = `light-${l.id}`;
          return (
            <Row
              key={l.id}
              label={`${kindIcon(l.kind)} ${l.name}`}
              isSelected={selectedLightId === l.id}
              isHidden={!!hidden[key]}
              // 라이트는 다중 선택 미지원 — shift 무시
              onSelect={() => selectLight(selectedLightId === l.id ? null : l.id)}
              onToggle={() => toggle(key)}
              onDelete={() => removeLight(l.id)}
            />
          );
        })}
      </Section>
    </div>
  );
}

function kindIcon(kind: string): string {
  return ({ point: '●', spot: '◑', rect: '▭', hemisphere: '◐' } as Record<string, string>)[kind] ?? '○';
}

function Row({
  label,
  isSelected,
  isHidden,
  onSelect,
  onToggle,
  onDelete,
  indent,
}: {
  label: string;
  isSelected: boolean;
  isHidden: boolean;
  /** Shift 키 여부 전달 — multi-select 분기용 (light row 는 무시) */
  onSelect: (shift?: boolean) => void;
  onToggle: () => void;
  onDelete?: () => void;
  indent?: boolean;
}) {
  return (
    <div
      style={{
        ...rowStyle,
        background: isSelected ? '#1e3a5f' : 'transparent',
        opacity: isHidden ? 0.45 : 1,
        paddingLeft: indent ? 14 : 4,
      }}
    >
      <span
        onClick={(e) => onSelect(e.shiftKey)}
        style={{
          flex: 1,
          cursor: 'pointer',
          color: isSelected ? '#22d3ee' : '#e5e5e5',
          textDecoration: isHidden ? 'line-through' : 'none',
          userSelect: 'none',
        }}
      >
        {label}
      </span>
      <button
        onClick={onToggle}
        title={isHidden ? '표시' : '숨김'}
        style={iconBtnStyle}
      >
        {isHidden ? '🚫' : '👁'}
      </button>
      {onDelete && (
        <button onClick={onDelete} title="삭제" style={delBtnStyle}>
          ✕
        </button>
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

function Empty() {
  return <div style={{ fontSize: 11, opacity: 0.5, padding: '2px 4px' }}>— 없음 —</div>;
}

function deleteWall(w: Wall): void {
  Wall.delete(w, layoutRegistry);
  useSelectionStore.getState().clear();
  useMeshSelectionStore.getState().selectMesh(null);
  const existing = [...useLayoutStore.getState().spaces];
  for (const sp of existing) Space.delete(sp, layoutRegistry);
  buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
  useLayoutStore.setState((s) => ({ walls: [...s.walls], spaces: [...s.spaces] }));
}

// ============ styles ============

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  left: 16,
  width: 240,
  maxHeight: 'calc(100vh - 120px)',
  overflowY: 'auto',
  background: 'rgba(20, 20, 22, 0.95)',
  color: '#e5e5e5',
  border: '1px solid #3f3f46',
  borderRadius: 6,
  padding: 10,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  zIndex: 80,
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
};

const headerStyle: React.CSSProperties = {
  fontWeight: 600,
  paddingBottom: 8,
  marginBottom: 8,
  borderBottom: '1px solid #3f3f46',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#fbbf24',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 4px',
  borderRadius: 3,
  fontSize: 12,
};

const spaceGroupStyle: React.CSSProperties = {
  marginBottom: 4,
};

const spaceTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#a1a1aa',
  padding: '2px 4px',
  fontWeight: 500,
};

const iconBtnStyle: React.CSSProperties = {
  width: 22,
  height: 20,
  padding: 0,
  background: 'transparent',
  border: '1px solid #3f3f46',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 10,
  color: '#e5e5e5',
};

const delBtnStyle: React.CSSProperties = {
  width: 22,
  height: 20,
  padding: 0,
  background: '#7f1d1d',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 10,
  color: '#fff',
};