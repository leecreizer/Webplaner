import { useMemo, useState } from 'react';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { useHomvueStore } from './homvueStore';
import { won } from './homvueAssets';
import { buildEstimate } from './homvueEstimate';

/**
 * 견적 — 언리얼 WB_Estimate(WB_EstimateTab · WB_EstimateCell · WB_EstimatTitleCell) 대응.
 * 탭 = 전체 + 방별, 줄 = 상품(코드·이름·단가·수량·금액). 계산은 homvueEstimate.ts.
 */
export function HomvueEstimatePanel() {
  const open = useHomvueStore((s) => s.estimateOpen);
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const overrides = useHomvueStore((s) => s.overrides);
  const [tab, setTab] = useState(0);

  const tabs = useMemo(() => (plan ? buildEstimate(plan, modules, overrides) : []), [plan, modules, overrides]);
  if (!open || !plan) return null;
  const current = tabs[Math.min(tab, tabs.length - 1)];

  return (
    <DraggablePanel
      id="homvue-estimate"
      title="💰 견적"
      defaultX={332}
      defaultY={140}
      width={420}
      accent="#38bdf8"
      right={
        <button onClick={() => useHomvueStore.getState().setEstimateOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {tabs.map((t, i) => (
          <button key={t.label} onClick={() => setTab(i)} style={t === current ? tabActiveStyle : tabStyle}>
            {t.label}
          </button>
        ))}
      </div>
      {current && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ opacity: 0.6, textAlign: 'left' }}>
                <th style={thStyle}>제품명 · 제품유형</th>
                <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>단가</th>
                <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>수량</th>
                <th style={{ ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>가격</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((r) => (
                <tr key={r.product.code} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={tdStyle}>
                    <div>{r.product.name}</div>
                    <div style={{ opacity: 0.5 }}>{r.product.code} · {r.product.type}</div>
                  </td>
                  <td style={numStyle}>{won(r.product.price)}</td>
                  <td style={numStyle}>{r.count}</td>
                  <td style={numStyle}>{won(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!current.rows.length && <div style={{ fontSize: 11, opacity: 0.6 }}>가격이 있는 상품이 없습니다</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 700 }}>
            <span>총합 ({current.rows.reduce((s, r) => s + r.count, 0)}개)</span>
            <span>{won(current.total)}</span>
          </div>
          <BenefitNotice />
        </>
      )}
    </DraggablePanel>
  );
}

const tabStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
  color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const tabActiveStyle: React.CSSProperties = { ...tabStyle, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe' };
const thStyle: React.CSSProperties = { padding: '2px 4px', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '4px', verticalAlign: 'top' };
const numStyle: React.CSSProperties = { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' };
const closeBtnStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' };

/** 견적·상품 모아보기 하단 — WB_Estimate · WB_CheckProducts 문구 그대로 + 상담 신청 */
export function BenefitNotice() {
  return (
    <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
      <div style={{ opacity: 0.7 }}>혜택이 적용되지 않은 일반 판매가입니다.</div>
      <div style={{ color: '#fca5a5' }}>입주 고객만을 위한 특별 혜택 상담을 원하신다면 상담을 신청해주세요!</div>
      <button
        onClick={() => useHomvueStore.getState().setConsultOpen(true)}
        style={{ marginTop: 6, width: '100%', padding: 6, borderRadius: 4, border: '1px solid #38bdf8', background: '#0284c7', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
      >
        상담 신청
      </button>
    </div>
  );
}
