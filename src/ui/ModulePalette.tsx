import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { MODULE_PRESETS, useSpaceModuleStore, type ModuleKind } from '@/features/spaceModules/spaceModuleStore';

/** 공간 모듈 팔레트 — 종류 클릭 → 바닥 클릭으로 배치. */
export function ModulePalette() {
  const pending = useSpaceModuleStore((s) => s.pendingKind);
  const setPending = useSpaceModuleStore((s) => s.setPendingKind);
  return (
    <DraggablePanel id="module-palette" title="🧩 공간 모듈" defaultY={120} width={180} accent="#a78bfa">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(MODULE_PRESETS) as ModuleKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setPending(pending === k ? null : k)}
            style={{
              padding: '6px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              border: '1px solid #3f3f46', textAlign: 'left',
              background: pending === k ? '#a78bfa' : '#27272a',
              color: pending === k ? '#0a0a0a' : '#e5e5e5',
            }}
          >
            {MODULE_PRESETS[k].label} <span style={{ opacity: 0.5, fontSize: 10 }}>
              {MODULE_PRESETS[k].w}×{MODULE_PRESETS[k].d}m</span>
          </button>
        ))}
      </div>
      {pending && <div style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>바닥을 클릭해 배치 · ESC 취소</div>}
    </DraggablePanel>
  );
}
