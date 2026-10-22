import { useMemo, useState } from 'react';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { useHomvueStore } from './homvueStore';
import { showableProducts, won } from './homvueAssets';
import { BenefitNotice } from './HomvueEstimatePanel';

/**
 * 상품 모아보기 — 언리얼 WB_CheckProducts(WB_CheckProductsTab · WB_CheckProductsCell) 대응.
 * 탭 = 방, 줄 = 「보여 줄 상품」(마스터·가격 있음, 방마다 상품 코드 중복 제거). 누르면 그 상품을 선택한다.
 */
export function HomvueCheckProducts() {
  const open = useHomvueStore((s) => s.checkOpen);
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const overrides = useHomvueStore((s) => s.overrides);
  const selected = useHomvueStore((s) => s.selected);
  const [tab, setTab] = useState<string | null>(null);

  const list = useMemo(() => (plan ? showableProducts(plan, modules, overrides) : []), [plan, modules, overrides]);
  if (!open || !plan) return null;
  const rooms = plan.rooms.filter((r) => list.some((p) => p.room === r.type));
  const current = tab && rooms.some((r) => r.type === tab) ? tab : rooms[0]?.type ?? null;
  const rows = list.filter((p) => p.room === current);
  const s = useHomvueStore.getState();

  return (
    <DraggablePanel
      id="homvue-check-products"
      title="📋 상품 모아보기"
      defaultX={332}
      defaultY={140}
      width={360}
      accent="#38bdf8"
      right={
        <button onClick={() => s.setCheckOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {rooms.map((r) => (
          <button key={r.type} onClick={() => setTab(r.type)} style={r.type === current ? tabActiveStyle : tabStyle}>
            {r.label} {list.filter((p) => p.room === r.type).length}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 420, overflowY: 'auto' }}>
        {rows.map(({ key, item }) => (
          <button key={key} onClick={() => s.select(key)} style={key === selected ? rowActiveStyle : rowStyle}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              <div>{item.product!.name}</div>
              <div style={{ opacity: 0.5 }}>
                {item.product!.code} · {item.product!.type}
                {item.glb ? '' : ' · 변환 전'}
              </div>
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{won(item.product!.price)}</span>
          </button>
        ))}
        {!rows.length && <div style={{ fontSize: 11, opacity: 0.6 }}>가격이 있는 상품이 없습니다</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 700 }}>
        <span>총합</span>
        <span>{won(rows.reduce((t, r) => t + r.item.product!.price, 0))}</span>
      </div>
      <BenefitNotice />
    </DraggablePanel>
  );
}

const tabStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
  color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const tabActiveStyle: React.CSSProperties = { ...tabStyle, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe' };
const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', padding: '5px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)',
  background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const rowActiveStyle: React.CSSProperties = { ...rowStyle, border: '1px solid #facc15', color: '#fef9c3' };
const closeBtnStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' };
