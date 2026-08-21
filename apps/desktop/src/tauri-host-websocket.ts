import type { WebSocketLike } from '@piwin/host-transport';

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

type PluginCloseFrame = {
  code: number;
  reason: string;
};

type PluginMessage =
  | { type: 'Text'; data: string }
  | { type: 'Binary'; data: number[] }
  | { type: 'Ping'; data: number[] }
  | { type: 'Pong'; data: number[] }
  | { type: 'Close'; data: PluginCloseFrame | null };

type PluginSocket = {
  addListener: (listener: (message: PluginMessage) => void) => () => void;
  send: (message: string) => Promise<void>;
  disconnect: () => Promise<void>;
};

export type TauriHostWebSocketConnect = (endpoint: string) => Promise<PluginSocket>;

/**
 * Probe close and the live client must not overlap on the Tauri plugin.
 * Each connect is cancelable so a timed-out dial does not block the queue forever.
 */
let pluginOpQueue: Promise<void> = Promise.resolve();

function enqueuePluginOp<T>(operation: () => Promise<T>): Promise<T> {
  const run = pluginOpQueue.then(operation, operation);
  pluginOpQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function serializePluginConnect(connect: TauriHostWebSocketConnect): TauriHostWebSocketConnect {
  return async (endpoint) => {
    const socket = await enqueuePluginOp(() => connectWithBudget(connect, endpoint));
    return {
      addListener: (listener) => socket.addListener(listener),
      send: (message) => socket.send(message),
      disconnect: () => enqueuePluginOp(() => socket.disconnect()),
    };
  };
}

/**
 * WKWebView blocks browser `ws://` from the packaged app origin
 * (`The operation is insecure`). Host sockets go through Tauri's Rust client.
 */
export function createTauriHostWebSocket(
  endpoint: string,
  connect: TauriHostWebSocketConnect = connectTauriPluginWebSocket,
): WebSocketLike {
  return new TauriHostWebSocket(endpoint, serializePluginConnect(connect));
}

async function connectTauriPluginWebSocket(endpoint: string): Promise<PluginSocket> {
  const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
  return PluginWebSocket.connect(endpoint);
}

/** Bound native dials so a black-hole Host cannot pin the shared plugin queue. */
const TAURI_CONNECT_BUDGET_MS = 15_000;

async function connectWithBudget(
  connect: TauriHostWebSocketConnect,
  endpoint: string,
  budgetMs = TAURI_CONNECT_BUDGET_MS,
): Promise<PluginSocket> {
  let settled = false;
  return await new Promise<PluginSocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`Tauri Host WebSocket connect timed out after ${budgetMs}ms`));
    }, budgetMs);

    void connect(endpoint)
      .then(async (socket) => {
        clearTimeout(timer);
        if (settled) {
          await socket.disconnect().catch(() => undefined);
          return;
        }
        settled = true;
        resolve(socket);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

class TauriHostWebSocket implements WebSocketLike {
  public readyState = CONNECTING;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  private inner: PluginSocket | undefined;
  private unsubscribeInner: (() => void) | undefined;
  private closed = false;
  private connectGeneration = 0;

  public constructor(endpoint: string, connect: TauriHostWebSocketConnect) {
    void this.open(endpoint, connect);
  }

  public send(data: string): void {
    if (this.readyState !== OPEN || this.inner === undefined) {
      throw new Error('Host WebSocket is not open');
    }
    void this.inner.send(data).catch((error: unknown) => {
      this.fail(error);
    });
  }

  public close(code?: number, reason?: string): void {
    if (this.closed || this.readyState === CLOSING || this.readyState === CLOSED) {
      return;
    }
    // Bump generation so an in-flight plugin connect disconnects on arrival
    // instead of claiming the shared queue slot indefinitely.
    this.connectGeneration += 1;
    this.readyState = CLOSING;
    const socket = this.inner;
    if (socket === undefined) {
      this.finishClose(code ?? 1000, reason ?? '');
      return;
    }
    void socket.disconnect().finally(() => {
      this.finishClose(code ?? 1000, reason ?? '');
    });
  }

  private async open(endpoint: string, connect: TauriHostWebSocketConnect): Promise<void> {
    const generation = this.connectGeneration;
    try {
      const socket = await connect(endpoint);
      if (this.closed || generation !== this.connectGeneration) {
        await socket.disconnect();
        return;
      }
      this.inner = socket;
      this.unsubscribeInner = socket.addListener((message) => {
        this.handlePluginMessage(message);
      });
      this.readyState = OPEN;
      this.onopen?.();
    } catch (error) {
      if (this.closed || generation !== this.connectGeneration) {
        return;
      }
      this.fail(error);
    }
  }

  private handlePluginMessage(message: PluginMessage): void {
    if (this.closed) {
      return;
    }
    if (message.type === 'Text') {
      this.onmessage?.({ data: message.data });
      return;
    }
    if (message.type === 'Close') {
      this.finishClose(message.data?.code ?? 1000, message.data?.reason ?? '');
      return;
    }
    if (message.type === 'Binary') {
      this.fail(new Error('Host transport received a non-text frame'));
    }
  }

  private fail(error: unknown): void {
    if (this.closed || this.readyState === CLOSING || this.readyState === CLOSED) {
      return;
    }
    this.readyState = CLOSING;
    this.onerror?.(error);
    const reason = error instanceof Error ? error.message : 'Host WebSocket error';
    const socket = this.inner;
    if (socket === undefined) {
      this.finishClose(1006, reason);
      return;
    }
    void socket.disconnect().finally(() => {
      this.finishClose(1006, reason);
    });
  }

  private finishClose(code: number, reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readyState = CLOSED;
    this.unsubscribeInner?.();
    this.unsubscribeInner = undefined;
    this.inner = undefined;
    this.onclose?.({ code, reason });
  }
}
