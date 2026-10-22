import { useEffect, useState } from 'react';
import { Euler, MathUtils } from 'three';
import { DraggablePanel } from '@/ui/panels/DraggablePanel';
import { ColorRow, NumberRow, Section, Vec3, closeBtnStyle, resetBtnStyle, rowStyle } from '@/ui/ModelInspector';
import { useHomvueStore } from './homvueStore';
import { commitTarget, homvueProductObjects, type HomvueGizmoTarget } from './HomvueGizmo';
import { currentValues, materialSlots } from './homvueMaterialEdit';
import type { HomvueLight } from './homvueAssets';

/**
 * Homvue 편집 패널 — 고른 것(상품·집 부품·방 바닥·레벨 메시·언리얼 조명)의 위치·회전·크기와 재질·조명 값을 고친다.
 * - 기즈모 모드(이동·회전·크기)와 숫자 입력은 같은 물체를 움직인다 — 숫자를 고치면 기즈모를 놓은 것과 같은 길(commitTarget)로 저장
 * - 재질: 고칠 때 그 물체용으로 재질을 복제한다(같은 재질을 쓰는 다른 물체는 그대로). 「원래대로」로 되돌린다
 * - 조명: 언리얼 값(루멘·색·색온도·크기·각도)을 고친다. 위치·회전은 손잡이(기즈모)로
 * 저장: 상품 위치는 평면 저장 파일(언리얼 FSaveData)에 들어간다. 재질·조명·부품 편집은 이번 화면에서만 유지
 */
export function HomvueInspector() {
  const selected = useHomvueStore((s) => s.selected);
  useHomvueStore((s) => s.editTick); // 기즈모로 옮기면 숫자를 다시 읽는다
  const mode = useHomvueStore((s) => s.gizmoMode);
  const setMode = useHomvueStore((s) => s.setGizmoMode);
  const [, setTick] = useState(0);
  const entry = selected ? homvueProductObjects.get(selected) : undefined;
  // 물체가 늦게 등록될 수 있다(GLB 받는 중) — 잠깐 뒤 다시 본다
  useEffect(() => {
    if (!selected || entry) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), 300);
    return () => window.clearTimeout(t);
  }, [selected, entry]);
  if (!selected || !entry) return null;
  const isLight = selected.startsWith('light:');
  const { obj } = entry;
  if (!obj.matrixAutoUpdate) {
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    obj.matrixAutoUpdate = true;
  }
  const deg = new Euler().setFromQuaternion(obj.quaternion);
  const rot: [number, number, number] = [MathUtils.radToDeg(deg.x), MathUtils.radToDeg(deg.y), MathUtils.radToDeg(deg.z)];
  const pos: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z];
  const scl: [number, number, number] = [obj.scale.x, obj.scale.y, obj.scale.z];
  const changed = () => commitTarget(selected);
  const modes: { m: 'translate' | 'rotate' | 'scale'; label: string }[] = [
    { m: 'translate', label: '이동' },
    { m: 'rotate', label: '회전' },
    ...(isLight ? [] : [{ m: 'scale' as const, label: '크기' }]),
  ];

  return (
    <DraggablePanel
      id="homvue-inspector"
      title="🏠 편집"
      defaultY={120}
      width={290}
      accent="#facc15"
      right={
        <>
          <span style={nameStyle} title={entry.label ?? selected}>{entry.label ?? selected}</span>
          <button onClick={() => useHomvueStore.getState().select(null)} title="닫기(선택 해제)" style={closeBtnStyle}>✕</button>
        </>
      }
    >
      <Section title="조작 모드 (기즈모)">
        <div style={{ display: 'flex', gap: 4 }}>
          {modes.map(({ m, label }) => (
            <button key={m} onClick={() => setMode(m)} style={modeBtn(mode === m)}>{label}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>R = 회전 · G·T = 이동 · Esc = 선택 해제</div>
      </Section>

      <Section title="위치 (m)">
        <Vec3 value={pos} step={0.05} onChange={(i, v) => { obj.position.setComponent(i, v); changed(); }} />
      </Section>
      <Section title="회전 (°)">
        <Vec3 value={rot} step={5} onChange={(i, v) => {
          const e = new Euler().setFromQuaternion(obj.quaternion);
          const r = [e.x, e.y, e.z];
          r[i] = MathUtils.degToRad(v);
          obj.quaternion.setFromEuler(new Euler(r[0], r[1], r[2]));
          changed();
        }} />
      </Section>
      {!isLight && (
        <Section title="크기">
          <Vec3 value={scl} step={0.05} onChange={(i, v) => { obj.scale.setComponent(i, Math.max(0.01, v)); changed(); }} />
          <NumberRow label="균등" value={scl[0]} min={0.05} max={5} step={0.05} onChange={(v) => { obj.scale.setScalar(Math.max(0.01, v)); changed(); }} />
        </Section>
      )}

      {isLight ? <LightSection index={Number(selected.slice(6))} /> : <MaterialSection objKey={selected} entry={entry} />}
    </DraggablePanel>
  );
}

/** 재질 — 물체가 쓰는 재질 목록에서 골라 값 편집 */
function MaterialSection({ objKey, entry }: { objKey: string; entry: HomvueGizmoTarget }) {
  const edits = useHomvueStore((s) => s.matEdits[objKey]);
  const setMatEdit = useHomvueStore((s) => s.setMatEdit);
  const [pick, setPick] = useState(0);
  const slots = materialSlots(entry.obj, entry.materials);
  if (!slots.length) return null;
  const slot = slots[Math.min(pick, slots.length - 1)];
  const v = currentValues(slot, edits?.[slot.id]);
  const set = (patch: Record<string, number | string>) => {
    // 합쳐 둔 레벨 메시는 고칠 때 떼어 낸다(그 메시만 바뀌게)
    entry.onDragStart?.();
    setMatEdit(objKey, slot.id, patch);
  };
  return (
    <Section title={`재질 · ${slots.length}개`}>
      <select value={Math.min(pick, slots.length - 1)} onChange={(e) => setPick(Number(e.target.value))} style={selectStyle}>
        {slots.map((s, i) => (
          <option key={s.id} value={i}>{s.name}{edits?.[s.id] ? ' (편집됨)' : ''}</option>
        ))}
      </select>
      <ColorRow label="색" value={v.color} onChange={(c) => set({ color: c })} />
      <NumberRow label="거칠기" value={v.roughness} min={0} max={1} step={0.02} onChange={(x) => set({ roughness: x })} />
      <NumberRow label="금속성" value={v.metalness} min={0} max={1} step={0.02} onChange={(x) => set({ metalness: x })} />
      <NumberRow label="불투명도" value={v.opacity} min={0} max={1} step={0.02} onChange={(x) => set({ opacity: x })} />
      {v.transmission !== null && <NumberRow label="투과" value={v.transmission} min={0} max={1} step={0.02} onChange={(x) => set({ transmission: x })} />}
      {v.ior !== null && <NumberRow label="굴절률" value={v.ior} min={1} max={2.5} step={0.01} onChange={(x) => set({ ior: x })} />}
      <ColorRow label="발광색" value={v.emissive} onChange={(c) => set({ emissive: c })} />
      <NumberRow label="발광" value={v.emissiveIntensity} min={0} max={20} step={0.1} onChange={(x) => set({ emissiveIntensity: x })} />
      <button onClick={() => setMatEdit(objKey, slot.id, null)} style={{ ...resetBtnStyle, width: '100%', marginTop: 4 }}>↺ 이 재질 원래대로</button>
    </Section>
  );
}

const toHex = (c: [number, number, number, number] | [number, number, number] | null) =>
  c ? `#${[c[0], c[1], c[2]].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}` : '#ffffff';
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** 언리얼 조명 값 — 루멘·색·색온도·크기·각도 */
function LightSection({ index }: { index: number }) {
  const base = useHomvueStore((s) => s.plan?.base.lights?.[index]);
  const edit = useHomvueStore((s) => s.lightEdits[index]);
  const setLightEdit = useHomvueStore((s) => s.setLightEdit);
  if (!base) return null;
  const l: HomvueLight = { ...base, ...edit };
  const set = (patch: Partial<HomvueLight>) => setLightEdit(index, patch);
  const maxLm = Math.max(50, (base.intensity ?? 10) * 20);
  return (
    <Section title={`조명 (언리얼 ${l.units === 'lumens' ? '루멘' : l.units})`}>
      <NumberRow label="세기" value={l.intensity ?? 0} min={0} max={maxLm} step={0.5} onChange={(x) => set({ intensity: x })} />
      <ColorRow label="색" value={toHex(l.color as [number, number, number] | null)} onChange={(h) => set({ color: fromHex(h) })} />
      <label style={rowStyle}>
        <input type="checkbox" checked={l.temperature != null} onChange={(e) => set({ temperature: e.target.checked ? base.temperature ?? 6500 : null })} />
        <span style={{ fontSize: 11 }}>색온도 사용</span>
      </label>
      {l.temperature != null && <NumberRow label="색온도 K" value={l.temperature} min={1500} max={12000} step={100} onChange={(x) => set({ temperature: x })} />}
      {l.kind === 'rect' ? (
        <>
          <NumberRow label="가로 cm" value={l.width_cm ?? 100} min={1} max={500} step={1} onChange={(x) => set({ width_cm: x })} />
          <NumberRow label="세로 cm" value={l.height_cm ?? 100} min={1} max={500} step={1} onChange={(x) => set({ height_cm: x })} />
        </>
      ) : (
        <>
          <NumberRow label="안쪽 °" value={l.inner_deg ?? 0} min={0} max={89} step={1} onChange={(x) => set({ inner_deg: Math.min(x, l.outer_deg ?? 44) })} />
          <NumberRow label="바깥 °" value={l.outer_deg ?? 44} min={1} max={89} step={1} onChange={(x) => set({ outer_deg: x })} />
        </>
      )}
      <button onClick={() => setLightEdit(index, null)} style={{ ...resetBtnStyle, width: '100%', marginTop: 4 }}>↺ 이 조명 원래대로</button>
    </Section>
  );
}

const nameStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: '#facc15', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = {
  width: '100%', marginBottom: 6, background: '#27272a', color: '#e5e5e5', border: '1px solid #3f3f46', borderRadius: 3, padding: '3px 4px', fontSize: 11,
};
const modeBtn = (on: boolean): React.CSSProperties => ({
  flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 3, cursor: 'pointer', border: '1px solid #3f3f46',
  background: on ? '#facc15' : '#27272a', color: on ? '#0a0a0a' : '#e5e5e5', fontWeight: on ? 700 : 400,
});
