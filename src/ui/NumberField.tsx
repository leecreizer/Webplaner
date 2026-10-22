import { useState } from 'react';

/**
 * 숫자 직접 입력칸 — 조절바 옆에 붙여 값을 키보드로 넣는다(사용자 요청 2026-10-21 「모든 옵션값은 입력할 수 있게」).
 * - 입력하는 동안 숫자로 읽히면 바로 반영(조절바·화면이 같이 움직인다)
 * - 쓰는 중인 글자("0." 같은 미완성)는 그대로 두고, Enter·다른 곳 클릭 때 정리된 값으로 돌아간다
 * - min·max 밖은 범위 안으로 맞춘다. 표시 자릿수는 step 에 맞춘다
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  width = 58,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
  title?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const digits = decimalsOf(step);
  const shown = text ?? (Number.isFinite(value) ? String(Number(value.toFixed(digits))) : '');
  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    if (c !== value) onChange(c);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      value={shown}
      min={min}
      max={max}
      step={step}
      title={title}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => setText(null)}
      onKeyDown={(e) => {
        // 패널·장면 단축키(R·G·Z·` 등)로 새지 않게
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{
        width,
        padding: '1px 4px',
        fontSize: 11,
        fontFamily: 'ui-monospace, Consolas, monospace',
        background: '#111827',
        color: '#e5e7eb',
        border: '1px solid #374151',
        borderRadius: 3,
        textAlign: 'right',
      }}
    />
  );
}

/** step 의 소수 자릿수(0.05 → 2, 1 → 0). 최대 4자리 */
function decimalsOf(step?: number): number {
  if (!step || step >= 1) return 0;
  const s = String(step);
  const i = s.indexOf('.');
  return Math.min(4, i < 0 ? 0 : s.length - i - 1);
}
