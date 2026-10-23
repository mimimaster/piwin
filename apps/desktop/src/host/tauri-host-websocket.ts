import {
  createNativeHostWebSocket,
  type NativeHostWebSocketConnect,
  type NativeHostWebSocketSocket,
} from '@piwin/host-transport';
import type { WebSocketLike } from '@piwin/host-transport';

export type TauriHostWebSocketConnect = NativeHostWebSocketConnect;

/** Desktop's Tauri shell must use the native plugin for remote Host sockets. */
export function createTauriHostWebSocket(
  endpoint: string,
  connect: TauriHostWebSocketConnect = connectTauriPluginWebSocket,
): WebSocketLike {
  return createNativeHostWebSocket(endpoint, connect);
}

async function connectTauriPluginWebSocket(endpoint: string): Promise<NativeHostWebSocketSocket> {
  const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
  return PluginWebSocket.connect(endpoint);
}
