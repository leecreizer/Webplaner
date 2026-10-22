import { useRef, useState } from 'react';
import { useHomvueStore } from './homvueStore';
import { makeSave, parseSave, readSaves, writeSaves, type SavedEntry } from './homvueSave';

/**
 * 저장·불러오기 — 언리얼 WB_SaveLoad · WB_LoadCell 대응.
 *
 * 언리얼 키오스크는 프로젝트 폴더(HVPlanSaved)에 「전화번호.json」으로 저장한다. 웹은 이 기기(브라우저)에
 * 같은 형식으로 저장하고, 파일로 내보내기·가져오기를 더해 키오스크 저장 파일도 열 수 있게 한다.
 */
export function HomvueSaveLoad() {
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const plans = useHomvueStore((s) => s.plans);
  const [saves, setSaves] = useState<SavedEntry[]>(() => readSaves());
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = async (data: unknown) => {
    try {
      const { planId, modules: saved } = parseSave(data, plans);
      await useHomvueStore.getState().openPlan(planId, saved);
      setMsg('불러왔습니다');
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };

  const save = () => {
    if (!plan) return;
    const phone = name.trim();
    if (!phone) {
      setMsg('연락처를 입력하세요!');
      return;
    }
    const entry: SavedEntry = { name: phone, savedAt: new Date().toISOString(), data: makeSave(plan, modules, { phone }) };
    // 언리얼처럼 같은 이름이면 덮어쓴다
    const list = [entry, ...saves.filter((x) => x.name !== entry.name)];
    setMsg(writeSaves(list) ? '저장 성공' : '저장 실패 — 이 브라우저에 저장할 수 없습니다. 파일로 내보내기를 쓰세요');
    setSaves(list);
  };

  const remove = (n: string) => {
    const list = saves.filter((x) => x.name !== n);
    writeSaves(list);
    setSaves(list);
  };

  const download = () => {
    if (!plan) return;
    const data = makeSave(plan, modules, { phone: name.trim() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${name.trim() || `homvue-${plan.planName}`}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {plan && (
        <div style={{ display: 'flex', gap: 4 }}>
          <input value={name} onChange={(e) => setName(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" placeholder="연락처(핸드폰)" style={inputStyle} />
          <button onClick={save} style={btnStyle}>저장</button>
          <button onClick={download} style={btnStyle} title="이 구성을 JSON 파일로 내려받기">⬇</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button onClick={() => fileRef.current?.click()} style={btnStyle} title="키오스크·다른 기기에서 저장한 JSON 열기">
          파일 열기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              await open(JSON.parse(await f.text()));
            } catch {
              setMsg('JSON 파일을 읽지 못했습니다');
            }
          }}
        />
        {msg && <span style={{ fontSize: 11, opacity: 0.75 }}>{msg}</span>}
      </div>
      {!saves.length && <div style={{ fontSize: 11, opacity: 0.5 }}>저장 데이터가 없습니다</div>}
      {saves.map((x) => (
        <div key={x.name} style={rowStyle}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</div>
            <div style={{ opacity: 0.5 }}>
              {x.data.roomList[0]?.planName ?? '?'} · {new Date(x.savedAt).toLocaleString('ko-KR')}
            </div>
          </span>
          <button onClick={() => open(x.data)} style={btnStyle}>불러오기</button>
          <button onClick={() => remove(x.name)} style={delStyle} title="삭제">✕</button>
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: 12,
};
const btnStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe', cursor: 'pointer', fontSize: 11,
};
const delStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' };
const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)', fontSize: 11,
};
