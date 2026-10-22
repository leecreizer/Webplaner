import { useState } from 'react';
import { useHomvueStore } from './homvueStore';
import { won } from './homvueAssets';
import { wallRoom, type MaterialInfo, type MatKind } from './homvueMaterials';

/**
 * 공간 재질 — 언리얼 WB_ChangeSpaceMaterial (벽지 DT_WallMatMaster · 바닥재 DT_FloorMatMaster).
 * 언리얼은 「지금 있는 방」에만 바꾼다 — 웹은 방을 고를 수 있게 하고, 투어 중이면 지금 방이 기본.
 */
export function HomvueSpaceMaterial() {
  const plan = useHomvueStore((s) => s.plan);
  const materials = useHomvueStore((s) => s.materials);
  const currentRoom = useHomvueStore((s) => s.currentRoom);
  const matWall = useHomvueStore((s) => s.matWall);
  const matFloor = useHomvueStore((s) => s.matFloor);
  const [picked, setPicked] = useState<string | null>(null);
  if (!plan) return null;
  if (!materials) return <div style={hintStyle}>재질 목록 준비 중 — 재질 굽기가 끝나면 나옵니다</div>;

  // 벽지·바닥재를 바꿀 수 있는 방 = 벽 블루프린트(BP_<방>_Wall)가 있는 방
  const rooms = plan.rooms.filter((r) => plan.base.apartment.some((a) => wallRoom(a.blueprint) === r.type));
  const room = picked ?? (currentRoom && rooms.some((r) => r.type === currentRoom) ? currentRoom : rooms[0]?.type);
  if (!room) return null;
  const s = useHomvueStore.getState();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {rooms.map((r) => (
          <button key={r.type} onClick={() => setPicked(r.type)} style={r.type === room ? chipActiveStyle : chipStyle}>
            {r.label}
          </button>
        ))}
      </div>
      <MaterialList title="벽지" kind="wall" list={materials.materials.wall} current={matWall[room]} onPick={(id) => s.setMaterial('wall', room, id)} />
      <MaterialList title="바닥재" kind="floor" list={materials.materials.floor} current={matFloor[room]} onPick={(id) => s.setMaterial('floor', room, id)} />
    </div>
  );
}

/** 재질 줄 목록 — 썸네일(있으면)·이름·가격. 상품 재질 목록에도 쓴다 */
export function MaterialList({
  title, kind, list, current, onPick,
}: { title: string; kind: MatKind; list: MaterialInfo[]; current?: number; onPick: (id: number) => void }) {
  const ready = useHomvueStore((s) => s.materials);
  const baked = (id: number) => {
    const t = ready?.targets[kind] ?? [];
    return t.some((bp) => ready?.bakes[bp]?.[kind]?.[String(id)]);
  };
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.8, margin: '4px 0 2px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((m) => {
          const ok = baked(m.id);
          return (
            <button
              key={m.id}
              disabled={!ok}
              onClick={() => onPick(m.id)}
              style={{ ...(m.id === current ? itemActiveStyle : itemStyle), opacity: ok ? 1 : 0.4 }}
              title={ok ? `${m.code} ${m.name}` : '재질 굽기 전'}
            >
              {m.thumb ? <img src={m.thumb} width={22} height={22} style={{ borderRadius: 3, objectFit: 'cover' }} alt="" /> : <span style={{ width: 22 }} />}
              <span style={{ flex: 1, textAlign: 'left' }}>{m.name}</span>
              {m.price > 1 && <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>{won(m.price)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
  color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const chipActiveStyle: React.CSSProperties = { ...chipStyle, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe' };
const itemStyle: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', padding: '3px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const itemActiveStyle: React.CSSProperties = { ...itemStyle, border: '1px solid #38bdf8', color: '#e0f2fe' };
const hintStyle: React.CSSProperties = { fontSize: 11, opacity: 0.6 };
