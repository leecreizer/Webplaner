import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useViewStore } from '@/engine/stores/viewStore';

/**
 * 프레임 체크 — 화면 왼쪽 아래에 초당 화면 수·프레임 시간·그리기 호출 수, 경로 추적 상태를 띄운다.
 *
 * - 초당 화면 수 / 평균 프레임 시간 / 최근 1초에서 가장 느린 프레임(끊김은 평균이 아니라 이것으로 보인다)
 * - 그래프: 최근 120 프레임의 프레임 시간 — 16.7ms(60fps)·33ms(30fps) 기준선
 * - 그리기 호출·삼각형: 한 화면을 만드는 데 든 전부(후처리 패스 포함). three 기본은 렌더 호출마다 0 으로 지워
 *   후처리의 마지막 전체 화면 사각형 1개만 남으므로, 자동 초기화를 끄고 프레임 처음에 직접 지운다
 * - MuTracer: 지금 보이는 화면이 래스터(움직이는 중·준비 중)인지 경로 추적인지와 샘플 수
 *
 * 켜고 끄기: 조명·렌더 패널 「프레임 체크」 또는 ` 키(숫자 1 왼쪽).
 */
export function FrameMeter() {
  const show = useViewStore((s) => s.showFrameMeter);
  return show ? <Meter /> : null;
}

const HISTORY = 120;

function Meter() {
  const gl = useThree((s) => s.gl);
  const box = useRef<HTMLDivElement | null>(null);
  const text = useRef<HTMLDivElement | null>(null);
  const graph = useRef<HTMLCanvasElement | null>(null);
  const st = useRef({ last: 0, times: [] as number[], acc: 0, calls: 0, tris: 0 });

  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'frame-meter';
    el.style.cssText = `
      position: fixed; left: 12px; bottom: 12px; z-index: 120; pointer-events: none;
      padding: 6px 8px; background: rgba(0,0,0,0.72); color: #e5e7eb; border-radius: 6px;
      font: 11px/1.45 ui-monospace, Consolas, monospace; min-width: 180px;
    `;
    const t = document.createElement('div');
    const c = document.createElement('canvas');
    c.width = 180;
    c.height = 40;
    c.style.cssText = 'display:block; margin-top:4px; width:180px; height:40px;';
    el.append(t, c);
    document.body.appendChild(el);
    box.current = el;
    text.current = t;
    graph.current = c;
    const autoReset = gl.info.autoReset;
    gl.info.autoReset = false;
    gl.info.reset();
    return () => {
      gl.info.autoReset = autoReset;
      el.remove();
    };
  }, [gl]);

  // 가장 먼저 — 직전 프레임의 그리기 통계를 읽고 지운다
  useFrame(() => {
    const s = st.current;
    s.calls = gl.info.render.calls;
    s.tris = gl.info.render.triangles;
    gl.info.reset();
  }, -1000);

  useFrame(() => {
    const s = st.current;
    const now = performance.now();
    if (s.last) {
      s.times.push(now - s.last);
      if (s.times.length > HISTORY) s.times.shift();
    }
    s.last = now;
    if (now - s.acc < 250 || !text.current) return;
    s.acc = now;
    // 최근 1초
    let sum = 0;
    let worst = 0;
    let n = 0;
    for (let i = s.times.length - 1; i >= 0 && sum < 1000; i--) {
      sum += s.times[i];
      worst = Math.max(worst, s.times[i]);
      n++;
    }
    const fps = n ? (n * 1000) / sum : 0;
    const avg = n ? sum / n : 0;
    const color = fps >= 50 ? '#4ade80' : fps >= 30 ? '#facc15' : '#f87171';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mt = (window as any).__mutracer as
      | { loop: { status: string; samples: number }; hybrid?: { ready: boolean } }
      | undefined;
    const mtLine = mt
      ? `<div>경로 추적: ${mt.hybrid?.ready ? '<b style="color:#60a5fa">경로 추적 화면</b>' : '<b style="color:#facc15">래스터(이동·준비 중)</b>'} · ${mt.loop.status} · 샘플 ${mt.loop.samples}</div>`
      : '';
    text.current.innerHTML =
      `<div><b style="color:${color};font-size:13px">${fps.toFixed(0)} fps</b> · 평균 ${avg.toFixed(1)}ms · 최악 <b style="color:${worst > 50 ? '#f87171' : '#e5e7eb'}">${worst.toFixed(0)}ms</b></div>` +
      `<div>그리기 ${s.calls.toLocaleString()}회 · 삼각형 ${(s.tris / 1e6).toFixed(2)}M</div>` +
      mtLine;
    const c = graph.current?.getContext('2d');
    if (!c) return;
    const W = 180;
    const H = 40;
    const scale = (ms: number) => H - Math.min(H, (ms / 50) * H); // 위끝 = 50ms
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.beginPath();
    for (const ms of [16.7, 33.3]) {
      c.moveTo(0, scale(ms) + 0.5);
      c.lineTo(W, scale(ms) + 0.5);
    }
    c.stroke();
    const bw = W / HISTORY;
    s.times.forEach((ms, i) => {
      c.fillStyle = ms > 33.3 ? '#f87171' : ms > 20 ? '#facc15' : '#4ade80';
      const y = scale(ms);
      c.fillRect(i * bw, y, Math.max(1, bw - 0.3), H - y);
    });
  });

  // ` 키로 켜고 끄기는 FrameMeterHotkey 가 맡는다(꺼져 있어도 켤 수 있게)
  return null;
}

/** ` 키 — 꺼진 상태에서도 켤 수 있도록 캔버스 밖에서 항상 듣는다 */
export function FrameMeterHotkey() {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.code !== 'Backquote') return; // 키 위치로 — 한글 입력 상태에서도
      const v = useViewStore.getState();
      v.setShowFrameMeter(!v.showFrameMeter);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
