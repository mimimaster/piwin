import type { WebSocketLike } from './websocket-host-transport.js';

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export type NativeHostWebSocketMessage =
  | { type: 'Text'; data: string }
  | { type: 'Binary'; data: number[] }
  | { type: 'Ping'; data: number[] }
  | { type: 'Pong'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null };

export type NativeHostWebSocketSocket = {
  addListener: (listener: (message: NativeHostWebSocketMessage) => void) => () => void;
  send: (message: string) => Promise<void>;
  disconnect: () => Promise<void>;
};

export type NativeHostWebSocketConnect = (endpoint: string) => Promise<NativeHostWebSocketSocket>;

/**
 * Native WebSocket adapter for packaged Tauri shells. WKWebView rejects a
 * cleartext LAN `ws://` dial from the app origin, so the shell must provide a
 * native socket implementation while the shared Host transport keeps its
 * browser-shaped WebSocketLike contract.
 */
export function createNativeHostWebSocket(
  endpoint: string,
  connect: NativeHostWebSocketConnect,
): WebSocketLike {
  return new NativeHostWebSocket(endpoint, serializeNativeConnect(connect));
}

/** Probe close and the live client must not overlap on the native plugin. */
let nativeOperationQueue: Promise<void> = Promise.resolve();

function enqueueNativeOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = nativeOperationQueue.then(operation, operation);
  nativeOperationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function serializeNativeConnect(connect: NativeHostWebSocketConnect): NativeHostWebSocketConnect {
  return async (endpoint) => {
    const socket = await enqueueNativeOperation(() => connectWithBudget(connect, endpoint));
    return {
      addListener: (listener) => socket.addListener(listener),
      send: (message) => socket.send(message),
      disconnect: () => enqueueNativeOperation(() => socket.disconnect()),
    };
  };
}

/** Bound native dials so a black-hole Host cannot pin the shared plugin queue. */
const NATIVE_CONNECT_BUDGET_MS = 15_000;

async function connectWithBudget(
  connect: NativeHostWebSocketConnect,
  endpoint: string,
  budgetMs = NATIVE_CONNECT_BUDGET_MS,
): Promise<NativeHostWebSocketSocket> {
  let settled = false;
  return await new Promise<NativeHostWebSocketSocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`Native Host WebSocket connect timed out after ${budgetMs}ms`));
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

class NativeHostWebSocket implements WebSocketLike {
  public readyState = CONNECTING;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  private inner: NativeHostWebSocketSocket | undefined;
  private unsubscribeInner: (() => void) | undefined;
  private closed = false;
  private connectGeneration = 0;

  public constructor(endpoint: string, connect: NativeHostWebSocketConnect) {
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

  private async open(endpoint: string, connect: NativeHostWebSocketConnect): Promise<void> {
    const generation = this.connectGeneration;
    try {
      const socket = await connect(endpoint);
      if (this.closed || generation !== this.connectGeneration) {
        await socket.disconnect().catch(() => undefined);
        return;
      }
      this.inner = socket;
      this.unsubscribeInner = socket.addListener((message) => {
        this.handleNativeMessage(message);
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

  private handleNativeMessage(message: NativeHostWebSocketMessage): void {
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
