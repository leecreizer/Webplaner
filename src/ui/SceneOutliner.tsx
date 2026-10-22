import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { useCustomLightStore } from '@/engine/stores/customLightStore';
import { useLightingStore, type BuiltinLightKind } from '@/engine/stores/lightingStore';
import { useMeshSelectionStore, meshKey } from '@/features/selection/meshSelectionStore';
import { useSelectionStore } from '@/features/selection/selectionStore';
import { useVisibilityStore } from '@/features/scene/visibilityStore';
import { useImportedModelStore } from '@/features/models/importedModelStore';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { Wall } from '@/domain/structures/Wall';
import { Space } from '@/domain/structures/Space';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { homvueProductObjects } from '@/features/homvue/HomvueGizmo';
import { useHomvueStore } from '@/features/homvue/homvueStore';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { requestShadowUpdate } from '@/engine/lighting/ShadowDemand';

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
  const removed = useVisibilityStore((s) => s.removed);
  const removeMesh = useVisibilityStore((s) => s.remove);
  /** 바닥/천장 삭제 — 렌더 제외 + 트리 제거 + 선택 해제 */
  const deleteMesh = (key: string) => {
    removeMesh(key);
    const ms = useMeshSelectionStore.getState();
    if (ms.selectedMeshKeys.includes(key)) ms.selectMesh(null);
  };

  // 불러온 모델
  const importedModels = useImportedModelStore((s) => s.models);
  const selectedModelId = useImportedModelStore((s) => s.selectedId);
  const selectModel = useImportedModelStore((s) => s.select);
  const removeModel = useImportedModelStore((s) => s.remove);
  const updateModel = useImportedModelStore((s) => s.update);

  // 배치된 상품
  const placedProducts = usePlacedProductStore((s) => s.placed);
  const selectedPlacedId = usePlacedProductStore((s) => s.selectedId);
  const selectPlaced = usePlacedProductStore((s) => s.select);
  const removePlaced = usePlacedProductStore((s) => s.remove);

  // 기본 광원
  const selectedBuiltin = useLightingStore((s) => s.selectedBuiltin);
  const setSelectedBuiltin = useLightingStore((s) => s.setSelectedBuiltin);
  const sunVisible = useLightingStore((s) => s.sunVisible);
  const ambientVisible = useLightingStore((s) => s.ambientVisible);
  const hemiVisible = useLightingStore((s) => s.hemiVisible);
  const setBuiltinVisible = useLightingStore((s) => s.setBuiltinVisible);
  const builtinList: { kind: BuiltinLightKind; label: string; visible: boolean }[] = [
    { kind: 'sun', label: '☀ 태양광 (Directional)', visible: sunVisible },
    { kind: 'ambient', label: '○ 환경광 (Ambient)', visible: ambientVisible },
    { kind: 'hemi', label: '◐ 헤미스피어 (Sky/Ground)', visible: hemiVisible },
  ];

  // 화면에서 고른 것을 트리에서도 보이게 — 선택된 줄(data-selected)까지 스크롤
  const bodyRef = useRef<HTMLDivElement>(null);
  const homvueSelected = useHomvueStore((s) => s.selected);
  const modules = useSpaceModuleStore((s) => s.modules);
  const selectedModuleId = useSpaceModuleStore((s) => s.selectedId);
  const selectionSig = `${selectedMeshKeys.join(',')}|${selectedLightId}|${selectedPlacedId}|${selectedModelId}|${selectedBuiltin}|${homvueSelected}|${selectedModuleId}`;
  useEffect(() => {
    // 묶음이 펼쳐진 뒤 그려지므로 한 프레임 뒤에
    const id = requestAnimationFrame(() => bodyRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [selectionSig]);

  return (
    <DraggablePanel id="outliner" title="🌳 씬 트리" defaultX={16} defaultY={80} width={240} accent="#a3e635">
      <div ref={bodyRef}>
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
              {!removed[floorKey] && (
                <Row
                  label="└ 바닥"
                  isSelected={selectedMeshKeys.includes(floorKey)}
                  isHidden={!!hidden[floorKey]}
                  onSelect={(shift) => selectMesh(floorKey, shift)}
                  onToggle={() => toggle(floorKey)}
                  onDelete={() => deleteMesh(floorKey)}
                  indent
                />
              )}
              {!removed[ceilingKey] && (
                <Row
                  label="└ 천장"
                  isSelected={selectedMeshKeys.includes(ceilingKey)}
                  isHidden={!!hidden[ceilingKey]}
                  onSelect={(shift) => selectMesh(ceilingKey, shift)}
                  onToggle={() => toggle(ceilingKey)}
                  onDelete={() => deleteMesh(ceilingKey)}
                  indent
                />
              )}
            </div>
          );
        })}
      </Section>

      <Section title={`공간 모듈 (${modules.length})`}>
        {modules.length === 0 && <Empty />}
        {modules.map((md) => (
          <Row
            key={md.id}
            label={`▦ ${md.name}`}
            isSelected={selectedModuleId === md.id}
            isHidden={false}
            onSelect={() => useSpaceModuleStore.getState().select(selectedModuleId === md.id ? null : md.id)}
            onDelete={() => useSpaceModuleStore.getState().remove(md.id)}
          />
        ))}
      </Section>

      <Section title="기본 광원">
        {builtinList.map((b) => (
          <Row
            key={b.kind}
            label={b.label}
            isSelected={selectedBuiltin === b.kind}
            isHidden={!b.visible}
            onSelect={() => setSelectedBuiltin(selectedBuiltin === b.kind ? null : b.kind)}
            onToggle={() => setBuiltinVisible(b.kind, !b.visible)}
          />
        ))}
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

      <Section title={`배치 상품 (${placedProducts.length})`}>
        {placedProducts.length === 0 && <Empty />}
        {placedProducts.map((p) => (
          <Row
            key={p.id}
            label={`▣ ${p.name}`}
            isSelected={selectedPlacedId === p.id}
            isHidden={false}
            onSelect={() => selectPlaced(selectedPlacedId === p.id ? null : p.id)}
            onToggle={() => {}}
            onDelete={() => removePlaced(p.id)}
          />
        ))}
      </Section>

      <HomvueSection />

      <Section title={`불러온 모델 (${importedModels.length})`}>
        {importedModels.length === 0 && <Empty />}
        {importedModels.map((mdl) => (
          <Row
            key={mdl.id}
            label={`📦 ${mdl.name}`}
            isSelected={selectedModelId === mdl.id}
            isHidden={!mdl.visible}
            onSelect={() => selectModel(selectedModelId === mdl.id ? null : mdl.id)}
            onToggle={() => updateModel(mdl.id, { visible: !mdl.visible })}
            onDelete={() => removeModel(mdl.id)}
          />
        ))}
      </Section>
      </div>
    </DraggablePanel>
  );
}

/**
 * Homvue 평면에 놓인 것 — 집 구조(벽·천장·바닥) · 공용 · 방별 상품 · 조명. 기즈모 등록부(homvueProductObjects)를 그대로 읽는다.
 * 누르면 선택(기즈모·편집 패널), 👁 는 숨김. 묶음은 접고 펴며 지금 있는 방만 펼쳐 시작한다(상품이 200개 넘는다)
 */
function HomvueSection() {
  const plan = useHomvueStore((s) => s.plan);
  const selected = useHomvueStore((s) => s.selected);
  const currentRoom = useHomvueStore((s) => s.currentRoom);
  useSyncExternalStore(homvueProductObjects.subscribe, () => homvueProductObjects.version);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // 화면에서 고른 물체의 묶음을 펼친다(접혀 있으면 트리에서 선택이 안 보였다)
  useEffect(() => {
    if (!selected) return;
    const gid = groupOf(selected);
    setOpen((o) => (o[gid] ? o : { ...o, [gid]: true }));
  }, [selected]);
  if (!plan) return null;

  const roomLabel = new Map<string, string>();
  for (const r of (plan.rooms ?? []) as { type?: string; label?: string }[]) if (r.type) roomLabel.set(r.type, r.label ?? r.type);
  const groups = new Map<string, { title: string; room?: string; rows: { key: string; label: string; hidden: boolean }[] }>();
  const add = (gid: string, title: string, room: string | undefined, key: string, label: string, hidden: boolean) => {
    let g = groups.get(gid);
    if (!g) groups.set(gid, (g = { title, room, rows: [] }));
    g.rows.push({ key, label, hidden });
  };
  const titles: Record<string, string> = { '0part': '집 구조', '9light': '조명', '1base': '공용' };
  for (const [key, e] of homvueProductObjects) {
    const label = e.label ?? e.item?.product?.name ?? e.item?.blueprint.split('/').pop() ?? key;
    const gid = groupOf(key);
    const type = gid.startsWith('5') ? gid.slice(1) : undefined;
    add(gid, titles[gid] ?? roomLabel.get(type!) ?? type ?? gid, type, key, label, !e.obj.visible);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = homvueProductObjects.size;
  const isOpen = (gid: string, room?: string) => open[gid] ?? (!!room && !!currentRoom && currentRoom.startsWith(room));
  const toggleHidden = (key: string) => {
    const e = homvueProductObjects.get(key);
    if (!e) return;
    e.obj.visible = !e.obj.visible;
    requestShadowUpdate();
    homvueProductObjects.bump();
  };

  return (
    <Section title={`Homvue 평면 (${total})`}>
      {total === 0 && <Empty />}
      {sorted.map(([gid, g]) => (
        <div key={gid} style={spaceGroupStyle}>
          <div
            style={{ ...spaceTitleStyle, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setOpen((o) => ({ ...o, [gid]: !isOpen(gid, g.room) }))}
          >
            {isOpen(gid, g.room) ? '▾' : '▸'} {g.title} ({g.rows.length})
          </div>
          {isOpen(gid, g.room) &&
            g.rows.map((r) => (
              <Row
                key={r.key}
                label={`└ ${r.label}`}
                isSelected={selected === r.key}
                isHidden={r.hidden}
                onSelect={() => useHomvueStore.getState().select(selected === r.key ? null : r.key)}
                onToggle={() => toggleHidden(r.key)}
                indent
              />
            ))}
        </div>
      ))}
    </Section>
  );
}

/** 씬 트리 묶음 — 집 구조(part:) · 조명(light:) · 공용(base-) · 방(키 앞부분 Living01 등) */
function groupOf(key: string): string {
  if (key.startsWith('part:')) return '0part';
  if (key.startsWith('light:')) return '9light';
  if (key.startsWith('base-')) return '1base';
  return `5${key.split('-')[0]}`;
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
  /** 없으면 숨김 버튼을 그리지 않는다 */
  onToggle?: () => void;
  onDelete?: () => void;
  indent?: boolean;
}) {
  return (
    <div
      data-selected={isSelected ? 'true' : undefined}
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
      {onToggle && (
        <button onClick={onToggle} title={isHidden ? '표시' : '숨김'} style={iconBtnStyle}>
          {isHidden ? '🚫' : '👁'}
        </button>
      )}
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