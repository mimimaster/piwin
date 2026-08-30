import { isNativeTauriRuntime } from '../mobile-device-credential-vault.js';
import { GEMINI_LIVE_FIXED_ENDPOINT } from './live-wire.js';
import type { MobileLiveSocket } from './mobile-live-media-driver.js';

export type MobilePcmSocketDeps = {
  WebSocketImpl?: typeof WebSocket;
};

export async function connectGeminiSocket(
  endpoint: string,
  ephemeralToken: string,
  deps: MobilePcmSocketDeps,
): Promise<MobileLiveSocket> {
  if (endpoint !== GEMINI_LIVE_FIXED_ENDPOINT) throw new Error('live-protocol-failed');
  const Socket = deps.WebSocketImpl ?? WebSocket;
  return wrapBrowserSocket(
    new Socket(`${endpoint}?access_token=${encodeURIComponent(ephemeralToken)}`),
  );
}

export async function connectOpenaiSocket(input: {
  endpoint: string;
  bearerToken: string;
}): Promise<MobileLiveSocket> {
  if (!isNativeTauriRuntime()) throw new Error('live-media-unsupported');
  try {
    const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
    const plugin = await PluginWebSocket.connect(input.endpoint, {
      headers: { Authorization: `Bearer ${input.bearerToken}` },
    });
    let readyState = 1;
    const socket: MobileLiveSocket = {
      get readyState() {
        return readyState;
      },
      send(data) {
        void plugin.send(data);
      },
      close() {
        readyState = 2;
        void plugin.disconnect().finally(() => {
          readyState = 3;
          socket.onclose?.({ code: 1000, reason: '' });
        });
      },
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    plugin.addListener((message) => {
      if (message.type === 'Text' && typeof message.data === 'string') {
        socket.onmessage?.({ data: message.data });
      } else if (message.type === 'Close') {
        readyState = 3;
        socket.onclose?.({
          code: message.data?.code ?? 1000,
          reason: message.data?.reason ?? '',
        });
      }
    });
    return socket;
  } catch {
    throw new Error('live-media-unsupported');
  }
}

function wrapBrowserSocket(socket: WebSocket): MobileLiveSocket {
  const wrapped: MobileLiveSocket = {
    get readyState() {
      return socket.readyState;
    },
    send(data) {
      socket.send(data);
    },
    close() {
      socket.close();
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  socket.onopen = () => wrapped.onopen?.();
  socket.onmessage = (event) => wrapped.onmessage?.({ data: event.data });
  socket.onerror = () => wrapped.onerror?.();
  socket.onclose = (event) => wrapped.onclose?.({ code: event.code, reason: event.reason });
  return wrapped;
}
