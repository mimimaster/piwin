export type OpenaiRealtimeSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null;
};

export async function connectOpenaiRealtimeSocket(input: {
  endpoint: string;
  bearerToken: string;
}): Promise<OpenaiRealtimeSocket> {
  try {
    const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
    const plugin = await PluginWebSocket.connect(input.endpoint, {
      headers: { Authorization: `Bearer ${input.bearerToken}` },
    });
    return wrapTauriPluginSocket(plugin);
  } catch {
    // Node / unit tests may inject connectSocket. Browser WebSocket cannot set
    // Authorization; fail closed rather than leaking a key into the query string.
    throw new Error('live-media-unsupported');
  }
}

function wrapTauriPluginSocket(plugin: {
  addListener: (listener: (message: {
    type: string;
    data?: unknown;
  }) => void) => () => void;
  send: (message: string) => Promise<void>;
  disconnect: () => Promise<void>;
}): OpenaiRealtimeSocket {
  let readyState = 0;
  const socket: OpenaiRealtimeSocket = {
    readyState,
    send(data) {
      void plugin.send(data);
    },
    close() {
      readyState = 2;
      socket.readyState = 2;
      void plugin.disconnect().finally(() => {
        readyState = 3;
        socket.readyState = 3;
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
      return;
    }
    if (message.type === 'Close') {
      readyState = 3;
      socket.readyState = 3;
      const data = message.data as { code?: number; reason?: string } | null | undefined;
      socket.onclose?.({ code: data?.code ?? 1000, reason: data?.reason ?? '' });
    }
  });
  // Plugin connect() resolves only after the handshake succeeds.
  readyState = 1;
  socket.readyState = 1;
  return socket;
}
