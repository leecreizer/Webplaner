/**
 * Host adapter 공공 API — 외부 호스트(Unity, web shell)와의 이벤트/명령 bridge.
 */
export { HostBridge } from './HostBridge';
export { HostProvider, useHost } from './HostContext';
export type { HostEventHandlers } from './HostEvents';
export type { HostCommands } from './HostCommands';