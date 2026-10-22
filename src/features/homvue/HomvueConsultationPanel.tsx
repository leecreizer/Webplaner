import { useEffect, useState } from 'react';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { useHomvueStore } from './homvueStore';
import {
  AGREEMENTS, SELECT_STORE_TITLE, appendRecord, fetchStores, isValidPhone, makeRecord, normalizePhone, sendConsultation,
} from './homvueConsultation';

/**
 * 상담 신청 — 언리얼 WB_PhoneNumInput · WB_AgreementPopup · WB_SelectStore → RequestConsultation.
 * 발송은 아직 연결하지 않았다(homvueConsultation.ts 참고) — 화면에 그 사실을 그대로 표시한다.
 */
export function HomvueConsultationPanel() {
  const open = useHomvueStore((s) => s.consultOpen);
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<string | null>(null);
  const [stores, setStores] = useState<string[]>([]);
  const [store, setStore] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (open && !stores.length) void fetchStores().then(setStores);
  }, [open, stores.length]);

  if (!open || !plan) return null;
  const s = useHomvueStore.getState();
  const allAgreed = AGREEMENTS.every((a) => agree[a.id]);
  const ready = isValidPhone(phone) && allAgreed && !!store;
  const style = plan.rooms.map((r) => r.modules.find((m) => m.no === modules[r.type])?.style).find(Boolean) ?? '';

  const submit = async () => {
    const rec = await sendConsultation({ ...makeRecord(plan, phone, store, style), admin: admin ? 'Y' : 'N' });
    const saved = appendRecord(rec);
    setMsg(`문자는 보내지 않았습니다 — 웹 상담 발송이 아직 연결되지 않았습니다.${saved ? ' 신청 내용은 이 기기에 기록했습니다.' : ''}`);
  };

  return (
    <DraggablePanel
      id="homvue-consultation"
      title="📞 VR 및 혜택 받기"
      defaultX={332}
      defaultY={140}
      width={380}
      accent="#38bdf8"
      right={
        <button onClick={() => s.setConsultOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      }
    >
      <div style={labelStyle}>이름</div>
      {/* 언리얼 WB_UserInfo 에 입력칸은 있으나 상담 API(RequestConsultation)로는 보내지 않는다 */}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" style={{ ...inputStyle, marginBottom: 6 }} />
      <div style={labelStyle}>휴대폰번호</div>
      <input
        value={phone}
        inputMode="numeric"
        onChange={(e) => setPhone(normalizePhone(e.target.value).slice(0, 11))}
        placeholder="01012345678"
        style={inputStyle}
      />
      {phone && !isValidPhone(phone) && <div style={warnStyle}>휴대전화번호를 확인해 주세요</div>}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontWeight: 700 }}>
        <input
          type="checkbox"
          checked={allAgreed}
          onChange={(e) => setAgree(Object.fromEntries(AGREEMENTS.map((a) => [a.id, e.target.checked])))}
        />
        전체 동의
      </label>
      {AGREEMENTS.map((a) => (
        <div key={a.id} style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={!!agree[a.id]} onChange={(e) => setAgree({ ...agree, [a.id]: e.target.checked })} />
            <span style={{ flex: 1 }}>{a.title}</span>
            <button onClick={() => setDetail(detail === a.id ? null : a.id)} style={linkBtnStyle}>
              {detail === a.id ? '닫기' : '보기'}
            </button>
          </label>
          {detail === a.id && (
            <div style={detailStyle}>
              <div style={{ whiteSpace: 'pre-line', marginBottom: 6 }}>{a.lead}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {a.rows.map(([k, v]) => (
                    <tr key={k} style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ textAlign: 'left', padding: '3px 4px', width: 110, fontWeight: 600 }}>{k}</th>
                      <td style={{ padding: '3px 4px' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      <div style={{ ...labelStyle, marginTop: 10 }}>{SELECT_STORE_TITLE}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {stores.map((x) => (
          <button key={x} onClick={() => setStore(x)} style={x === store ? chipActiveStyle : chipStyle}>
            {x}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11 }}>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        관리자 (선택)
      </label>
      <button onClick={submit} disabled={!ready} style={{ ...submitStyle, opacity: ready ? 1 : 0.4, marginTop: 8 }}>
        VR 및 혜택 받기
      </button>
      {msg && <div style={{ ...warnStyle, color: '#fde68a', marginTop: 6 }}>{msg}</div>}
      <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
        언리얼 키오스크는 신청 시 고객 휴대폰으로 VR 링크 문자를 보냅니다. 웹 발송은 담당 확인 후 연결 예정입니다.
      </div>
    </DraggablePanel>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, opacity: 0.8, marginBottom: 3 };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: 14, letterSpacing: 1,
};
const warnStyle: React.CSSProperties = { fontSize: 11, color: '#fca5a5' };
const detailStyle: React.CSSProperties = {
  fontSize: 11, padding: 6, marginTop: 4, borderRadius: 4, background: 'rgba(255,255,255,0.05)', lineHeight: 1.5,
};
const linkBtnStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: '#7dd3fc', cursor: 'pointer', fontSize: 11 };
const chipStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
  color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const chipActiveStyle: React.CSSProperties = { ...chipStyle, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe' };
const submitStyle: React.CSSProperties = {
  width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #38bdf8', background: '#0284c7', color: '#fff',
  fontWeight: 700, cursor: 'pointer',
};
const closeBtnStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' };
