import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePanelStore, resolveStack, type PanelSide } from './panelStore';

/**
 * 드래그 이동 + 좌/우 엣지 스냅 + 같은 변 패널 겹침 방지(reflow) 떠다니는 패널 컨테이너.
 *
 * - 제목 바를 드래그하면 자유 이동, 놓으면 중심 x 로 좌/우 변에 스냅되고 같은 변의 다른 패널과
 *   겹치지 않게 세로로 쌓인다.
 * - 위치는 panelStore 에 저장 (세션 유지). width 고정.
 *
 * @param id 고유 id (위치 저장 키)
 * @param title 제목 바 텍스트
 * @param defaultSide 초기 변
 * @param defaultTop 초기 세로 위치
 * @param width 패널 너비(px)
 * @param accent 제목 바 강조색
 * @param right 제목 바 우측 슬롯 (닫기/접기 버튼 등)
 */
export function DraggablePanel({
  id,
  title,
  defaultSide = 'right',
  defaultTop = 80,
  width = 280,
  accent = '#fbbf24',
  right,
  children,
}: {
  id: string;
  title: ReactNode;
  defaultSide?: PanelSide;
  defaultTop?: number;
  width?: number;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const pos = usePanelStore((s) => s.pos[id]);
  const setPos = usePanelStore((s) => s.setPos);
  const reportHeight = usePanelStore((s) => s.reportHeight);
  const ensureDefault = usePanelStore((s) => s.ensureDefault);
  const ref = useRef<HTMLDivElement>(null);

  // 기본 위치 1회 등록
  useEffect(() => {
    ensureDefault(id, { side: defaultSide, top: defaultTop });
  }, [id, defaultSide, defaultTop, ensureDefault]);

  // 높이 측정 보고 (reflow 계산용)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reportHeight(id, el.offsetHeight));
    ro.observe(el);
    reportHeight(id, el.offsetHeight);
    return () => ro.disconnect();
  }, [id, reportHeight]);

  const side: PanelSide = pos?.side ?? defaultSide;
  const top = pos?.top ?? defaultTop;

  // 드래그 중 자유 좌표 (px). null 이면 스냅된 위치 사용.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    // 현재 화면상 좌표 계산
    const baseX = side === 'left' ? 16 : window.innerWidth - width - 16;
    const baseY = top;
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
      // 중심 x 로 좌/우 판정
      const centerX = curX + width / 2;
      const newSide: PanelSide = centerX < window.innerWidth / 2 ? 'left' : 'right';
      const { pos: allPos, heights } = usePanelStore.getState();
      const resolvedTop = resolveStack(allPos, heights, id, newSide, curY);
      setPos(id, { side: newSide, top: resolvedTop });
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const left = drag ? drag.x : side === 'left' ? 16 : undefined;
  const rightCss = drag ? undefined : side === 'right' ? 16 : undefined;
  const topCss = drag ? drag.y : top;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        right: rightCss,
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
      {/* 드래그 핸들 = 제목 바 */}
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