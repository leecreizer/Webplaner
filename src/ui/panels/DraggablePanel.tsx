import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePanelStore, snapPanel, type PanelRect } from './panelStore';

/**
 * 자유 이동 + 자석 스냅 떠다니는 패널.
 *
 * - 제목 바(⠿)를 드래그하면 자유 이동.
 * - 놓으면: 브라우저 좌/우 *끝에 닿으면* 엣지 스냅, 다른 패널 가장자리에 *가까우면* 옆/아래에
 *   자석처럼 붙음 (snapPanel).
 * - 위치는 panelStore 에 {x,y} 로 세션 유지.
 *
 * @param id 고유 id (위치 저장 키)
 * @param defaultX/defaultY 초기 좌표 (없을 때만)
 * @param right 제목 바 우측 슬롯 (닫기/삭제 버튼 등)
 */
export function DraggablePanel({
  id,
  title,
  defaultX,
  defaultY = 80,
  width = 280,
  accent = '#fbbf24',
  right,
  children,
}: {
  id: string;
  title: ReactNode;
  defaultX?: number;
  defaultY?: number;
  width?: number;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const pos = usePanelStore((s) => s.pos[id]);
  const setPos = usePanelStore((s) => s.setPos);
  const ensureDefault = usePanelStore((s) => s.ensureDefault);
  const ref = useRef<HTMLDivElement>(null);

  // 기본 위치 1회 등록 — defaultX 없으면 우측 정렬
  useEffect(() => {
    const dx = defaultX ?? window.innerWidth - width - 16;
    ensureDefault(id, { x: dx, y: defaultY });
  }, [id, defaultX, defaultY, width, ensureDefault]);

  const x = pos?.x ?? (defaultX ?? 16);
  const y = pos?.y ?? defaultY;

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = x;
    const baseY = y;
    let curX = baseX;
    let curY = baseY;

    const onMove = (me: PointerEvent) => {
      curX = baseX + (me.clientX - startX);
      curY = baseY + (me.clientY - startY);
      setDrag({ x: curX, y: curY });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const w = ref.current?.offsetWidth ?? width;
      const h = ref.current?.offsetHeight ?? 200;
      // 다른 패널 rect 수집 (자기 제외)
      const others: PanelRect[] = [];
      document.querySelectorAll<HTMLElement>('[data-panel-id]').forEach((el) => {
        if (el.dataset.panelId === id) return;
        const r = el.getBoundingClientRect();
        others.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      });
      setPos(id, snapPanel(curX, curY, w, h, others));
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const left = drag ? drag.x : x;
  const topCss = drag ? drag.y : y;

  return (
    <div
      ref={ref}
      data-panel-id={id}
      style={{
        position: 'fixed',
        left,
        top: topCss,
        width,
        maxHeight: 'calc(100vh - 90px)',
        overflowY: 'auto',
        background: 'rgba(20, 20, 22, 0.95)',
        color: '#e5e5e5',
        border: '1px solid #3f3f46',
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        zIndex: drag ? 200 : 90,
        boxShadow: drag ? '0 8px 24px rgba(0,0,0,0.6)' : '0 4px 12px rgba(0,0,0,0.5)',
        userSelect: drag ? 'none' : undefined,
      }}
    >
      <div
        onPointerDown={onPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          cursor: 'move',
          borderBottom: '1px solid #3f3f46',
          background: 'rgba(255,255,255,0.03)',
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
        }}
      >
        <span style={{ fontSize: 11, opacity: 0.5 }}>⠿</span>
        <span style={{ flex: 1, fontWeight: 600, color: accent, fontSize: 12 }}>{title}</span>
        {right}
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}