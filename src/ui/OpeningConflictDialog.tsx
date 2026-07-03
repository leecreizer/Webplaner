import { useState } from 'react';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import type { OpeningConflict } from '@/features/spaceModules/compileModules';

/** 충돌 식별 키 — 취소(로컬 무시) 목록 관리용. */
const conflictKey = (c: OpeningConflict) =>
  `${c.a.moduleId}:${c.a.openingId}|${c.b.moduleId}:${c.b.openingId}`;

const TYPE_LABEL: Record<'door' | 'opening' | 'window', string> = { door: '문', opening: '개구부', window: '창호' };

/** 공유벽 개구부 충돌 시 어느 쪽을 유지할지 선택하는 모달. */
export function OpeningConflictDialog() {
  const conflicts = useSpaceModuleStore((s) => s.openingConflicts);
  const modules = useSpaceModuleStore((s) => s.modules);
  const resolveConflict = useSpaceModuleStore((s) => s.resolveConflict);
  // 취소로 닫은 충돌 — 로컬 상태만 (재컴파일로 충돌이 바뀌면 다시 표시될 수 있음)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const conflict = conflicts.find((c) => !dismissed.has(conflictKey(c)));
  if (!conflict) return null;

  const findOpening = (moduleId: string, openingId: string) => {
    const m = modules.find((mm) => mm.id === moduleId);
    const o = m?.openings.find((oo) => oo.id === openingId);
    if (!m || !o) return null;
    return { module: m, opening: o };
  };

  const found = findOpening(conflict.a.moduleId, conflict.a.openingId);
  const foundB = findOpening(conflict.b.moduleId, conflict.b.openingId);
  if (!found || !foundB) return null;

  const btnStyle: React.CSSProperties = {
    background: '#27272a',
    border: '1px solid #52525b',
    color: '#fff',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          background: '#18181b', border: '1px solid #3f3f46', borderRadius: 10,
          padding: 20, minWidth: 320, color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          겹치는 문/개구부가 있습니다
        </div>
        <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 16 }}>
          같은 벽면에서 두 개구부가 겹칩니다. 유지할 쪽을 선택하세요.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            style={btnStyle}
            onClick={() => resolveConflict(conflict.a, conflict.b)}
          >
            {found.module.name}의 {TYPE_LABEL[found.opening.type]} 유지
          </button>
          <button
            style={btnStyle}
            onClick={() => resolveConflict(conflict.b, conflict.a)}
          >
            {foundB.module.name}의 {TYPE_LABEL[foundB.opening.type]} 유지
          </button>
          <button
            style={{ ...btnStyle, background: 'transparent', color: '#a1a1aa' }}
            onClick={() => setDismissed((s) => new Set(s).add(conflictKey(conflict)))}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}