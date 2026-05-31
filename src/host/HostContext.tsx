import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { HostBridge } from './HostBridge';
import type { HostEventHandlers } from './HostEvents';

/**
 * `HostBridge`를 React 컴포넌트 트리 어디에서나 꺼내쓸 수 있도록 제공하는 Context.
 *
 * App 최상단 한 곳에서 `<HostProvider handlers={...}>`로 감싸면 자식 컴포넌트가 `useHost()`로
 * 브리지를 얻어 명령 호출 또는 이벤트 발행을 할 수 있다.
 */
const HostContext = createContext<HostBridge | null>(null);

/**
 * HostBridge를 자식 컴포넌트에 제공한다.
 *
 * @example
 * ```tsx
 * <HostProvider handlers={{ onLoadedPlan: (r, p) => console.log(p) }}>
 *   <App />
 * </HostProvider>
 * ```
 *
 * @param handlers 부모 React 호스트가 등록할 이벤트 핸들러 모음 (모두 optional)
 * @param bridge 직접 만든 HostBridge 인스턴스를 주입하고 싶을 때 (`handlers`와 동시 사용 불가)
 */
export function HostProvider({
  children,
  handlers,
  bridge,
}: {
  children: ReactNode;
  handlers?: HostEventHandlers;
  bridge?: HostBridge;
}) {
  // 1회 생성 — 동일 컴포넌트 라이프 동안 동일 인스턴스 유지
  const value = useMemo(() => bridge ?? new HostBridge(handlers ?? {}), [bridge, handlers]);

  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/** Provider 내부에서만 호출 — 외부에서 호출 시 예외. */
export function useHost(): HostBridge {
  const bridge = useContext(HostContext);
  if (bridge === null) {
    throw new Error('useHost() must be called inside <HostProvider>');
  }
  return bridge;
}

/** Provider 없이도 안전하게 시도 — 없으면 null 반환. UI 컴포넌트가 호스트 없이도 렌더링되어야 할 때. */
export function useHostOptional(): HostBridge | null {
  return useContext(HostContext);
}