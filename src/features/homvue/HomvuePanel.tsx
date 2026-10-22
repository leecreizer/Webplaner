import { useEffect } from 'react';
import { NumberField } from '@/ui/NumberField';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { useHomvueStore } from './homvueStore';
import { fetchPlans, planLabel, type PlanIndexEntry } from './homvueAssets';
import { HomvueProductSwap } from './HomvueProductSwap';
import { HomvueSaveLoad } from './HomvueSaveLoad';
import { HomvueSpaceMaterial } from './HomvueSpaceMaterial';
import { buildEstimate } from './homvueEstimate';
import { won } from './homvueAssets';

/**
 * Homvue 메뉴 패널.
 * - 아파트·평면 선택 — 언리얼 WB_Step_PlanMenu(WB_MenuAPTCell · WB_MenuPlanCell) 대응
 * - 방 유형·스타일 변경 — 언리얼 WB_MenuRoomStyleCell · ChangeRoomModule 대응: 방마다 모듈(가구 구성)을 고른다
 * - 상품 선택·교체 — 장면에서 상품을 누르면 같은 종류 후보 목록 (HomvueProductSwap)
 * - 투어 — 언리얼 1인칭 둘러보기 + 방으로 이동(TravelToRoom, 미니맵 공간 버튼 WB_MinimapSpaceButton 대응)
 */
export function HomvuePanel() {
  const open = useHomvueStore((s) => s.panelOpen);
  const plans = useHomvueStore((s) => s.plans);
  const listError = useHomvueStore((s) => s.listError);
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const showCeiling = useHomvueStore((s) => s.showCeiling);
  const loadState = useHomvueStore((s) => s.loadState);
  const loadError = useHomvueStore((s) => s.loadError);
  const walk = useHomvueStore((s) => s.walk);
  const overrides = useHomvueStore((s) => s.overrides);
  const lightScale = useHomvueStore((s) => s.lightScale);
  const showLightMarkers = useHomvueStore((s) => s.showLightMarkers);

  useEffect(() => {
    if (!open || plans.length) return;
    fetchPlans()
      .then((list) => useHomvueStore.getState().setPlans(list))
      .catch((e) => useHomvueStore.getState().setListError(String(e.message ?? e)));
  }, [open, plans.length]);

  if (!open) return null;
  const s = useHomvueStore.getState();

  // 아파트별로 묶기
  const byApt = new Map<string, PlanIndexEntry[]>();
  for (const p of plans) byApt.set(p.apt.label, [...(byApt.get(p.apt.label) ?? []), p]);

  return (
    <DraggablePanel
      id="homvue-panel"
      title="🏢 Homvue"
      defaultX={16}
      defaultY={140}
      width={300}
      accent="#38bdf8"
      right={
        <button onClick={s.togglePanel} title="닫기 (불러온 평면은 유지)" style={closeBtnStyle}>
          ✕
        </button>
      }
    >
      {/* WB_Intro 문구 */}
      <div style={{ fontWeight: 700, fontSize: 13 }}>미리 보는 우리집, 한샘 Homvue</div>
      <div style={{ ...hintStyle, marginBottom: 6 }}>우리집에 꼭 맞는 추천 가구 배치를 확인해보고 다양한 제안을 3D로 체험해보세요.</div>
      <div style={groupStyle}>단지 선택 · 타입 선택</div>
      {listError && <div style={errorStyle}>{listError}</div>}
      {!listError && !plans.length && <div style={hintStyle}>목록 불러오는 중…</div>}

      {[...byApt].map(([apt, list]) => (
        <div key={apt} style={{ marginBottom: 6 }}>
          <div style={groupStyle}>{apt}</div>
          {list.map((p) => {
            const active = plan?.id === p.id;
            return (
              <div key={p.id} style={active ? activeRowStyle : rowStyle}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{planLabel(p)}</div>
                  <div style={hintStyle}>
                    방 {p.rooms.length}개 · 상품 {p.products - p.unconvertedProducts}/{p.products}
                  </div>
                </div>
                <button
                  onClick={() => (active ? s.closePlan() : s.openPlan(p.id))}
                  style={active ? stopBtnStyle : loadBtnStyle}
                >
                  {active ? '닫기' : '불러오기'}
                </button>
              </div>
            );
          })}
        </div>
      ))}

      <div style={groupStyle}>저장·불러오기</div>
      <HomvueSaveLoad />

      {plan && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showCeiling} onChange={(e) => s.setShowCeiling(e.target.checked)} />
            천장 표시
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="언리얼 조명 자리에 점을 표시 — 누르면 골라 위치·세기·색을 고친다">
            <input type="checkbox" checked={showLightMarkers} onChange={(e) => s.setShowLightMarkers(e.target.checked)} />
            조명 위치 표시
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            실내 조명
            <input
              type="range" min={0} max={10} step={0.1} value={lightScale}
              onChange={(e) => s.setLightScale(Number(e.target.value))}
              style={{ flex: 1 }}
              title="언리얼 실내 조명(창가·천장·다운라이트) 전체 배율 — 비율은 원본 그대로"
            />
            ×<NumberField value={lightScale} onChange={s.setLightScale} min={0} max={40} step={0.1} width={46} />
          </label>

          <button onClick={() => s.setEstimateOpen(!useHomvueStore.getState().estimateOpen)} style={loadBtnStyle}>
            💰 견적보기 {won(buildEstimate(plan, modules, overrides)[0]?.total ?? 0)}
          </button>
          <button onClick={() => s.setCheckOpen(!useHomvueStore.getState().checkOpen)} style={loadBtnStyle}>
            📋 상품 모아보기
          </button>
          <button onClick={() => s.setConsultOpen(!useHomvueStore.getState().consultOpen)} style={loadBtnStyle}>
            📞 상담신청
          </button>

          <HomvueProductSwap />

          <div style={groupStyle}>공간 재질</div>
          <HomvueSpaceMaterial />

          <div style={groupStyle}>3D 홈투어</div>
          <button onClick={() => s.setWalk(!walk)} style={walk ? stopBtnStyle : loadBtnStyle}>
            {walk ? '■ 홈투어 끝 (Esc)' : '🚶 3D 홈투어 시작'}
          </button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {plan.rooms.map((room) => (
              <button
                key={room.type}
                style={chipStyle}
                title={`${room.label}(으)로 이동`}
                onClick={() => s.goToRoom(room.type)}
              >
                {room.label}로 이동
              </button>
            ))}
          </div>
          {walk && <div style={hintStyle}>WASD·방향키 이동 (Shift 빠르게) · 드래그 둘러보기 · 휠 뒤로 빼기 · 바닥의 ○ 누르면 그 자리로</div>}

          <div style={groupStyle}>방 스타일</div>
          {plan.rooms.map((room) => {
            const current = room.modules.find((m) => m.no === modules[room.type]);
            return (
              <div key={room.type} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 2 }}>{room.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {room.modules.map((m) => (
                    <button
                      key={m.no}
                      onClick={() => s.setModule(room.type, m.no)}
                      style={m.no === modules[room.type] ? chipActiveStyle : chipStyle}
                      title={`${m.name} — 가구 ${m.products.length}개${m.unconverted ? ` (변환 전 ${m.unconverted})` : ''}`}
                    >
                      {m.name}
                      {m.isDefault ? ' ★' : ''}
                    </button>
                  ))}
                </div>
                {current && current.unconverted > 0 && (
                  <div style={hintStyle}>변환 전 상품 {current.unconverted}개는 아직 표시되지 않음</div>
                )}
              </div>
            );
          })}

          <div style={loadState === 'error' ? errorStyle : hintStyle}>
            {loadState === 'loading' && '불러오는 중…'}
            {loadState === 'ready' && '불러오기 완료 — 홈플래너3 도면은 숨김 · ★ = 언리얼 기본 모듈'}
            {loadState === 'error' && `불러오기 실패: ${loadError}`}
          </div>
        </div>
      )}
    </DraggablePanel>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.08)', marginBottom: 4,
};
const activeRowStyle: React.CSSProperties = { ...rowStyle, border: '1px solid #38bdf8', background: 'rgba(56,189,248,0.1)' };
const loadBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 4, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe', cursor: 'pointer',
};
const stopBtnStyle: React.CSSProperties = { ...loadBtnStyle, border: '1px solid #64748b', background: '#334155' };
const chipStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
  color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const chipActiveStyle: React.CSSProperties = { ...chipStyle, border: '1px solid #38bdf8', background: '#0c4a6e', color: '#e0f2fe' };
const closeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
};
const groupStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, opacity: 0.7, margin: '4px 0' };
const hintStyle: React.CSSProperties = { fontSize: 11, opacity: 0.6 };
const errorStyle: React.CSSProperties = { fontSize: 11, color: '#fca5a5' };
