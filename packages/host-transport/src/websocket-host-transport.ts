import type { HostClientHello, HostHello } from '@piwin/contracts';
import { decodeHostWireMessage, encodeHostWireMessage } from './protocol-codec.js';
import type {
  HostClientHelloFactory,
  HostTransport,
  HostTransportMessageListener,
  HostTransportState,
  HostTransportStateListener,
} from './host-transport.js';

export type WebSocketLike = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type WebSocketFactory = (endpoint: string) => WebSocketLike;

export type WebSocketHostTransportOptions = {
  endpoint: string;
  createHello?: HostClientHelloFactory;
  webSocketFactory?: WebSocketFactory;
  connectTimeoutMs?: number;
  autoReconnect?: boolean;
  reconnectMinDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatIntervalMs?: number;
};

const OPEN_READY_STATE = 1;
const CONNECTING_READY_STATE = 0;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_MIN_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
/** Close codes that mean "do not auto-reconnect" (auth / protocol / origin). */
const FATAL_CLOSE_CODES = new Set([4002, 4003, 4004, 4009]);

export class WebSocketHostTransport implements HostTransport {
  private readonly endpoint: string;
  private createHello: HostClientHelloFactory;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly connectTimeoutMs: number;
  private readonly autoReconnect: boolean;
  private readonly reconnectMinDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly messageListeners = new Set<HostTransportMessageListener>();
  private readonly stateListeners = new Set<HostTransportStateListener>();
  private socket: WebSocketLike | undefined;
  private state: HostTransportState = { kind: 'idle' };
  private lastSeq = 0;
  private hostHello: HostHello | undefined;
  private helloPromise:
    | {
        promise: Promise<HostHello>;
        resolve: (hello: HostHello) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private closing = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatRequestId: string | undefined;
  private reconnectAttempt = 0;
  private lastHeartbeatTickAt = 0;

  public constructor(options: WebSocketHostTransportOptions) {
    if (options.endpoint.trim().length === 0) {
      throw new Error('Host endpoint cannot be empty');
    }
    if (options.connectTimeoutMs !== undefined && options.connectTimeoutMs <= 0) {
      throw new Error('Host connect timeout must be greater than zero');
    }
    if (options.reconnectMinDelayMs !== undefined && options.reconnectMinDelayMs <= 0) {
      throw new Error('Host reconnect minimum delay must be greater than zero');
    }
    if (options.reconnectMaxDelayMs !== undefined && options.reconnectMaxDelayMs <= 0) {
      throw new Error('Host reconnect maximum delay must be greater than zero');
    }
    if (
      options.reconnectMinDelayMs !== undefined &&
      options.reconnectMaxDelayMs !== undefined &&
      options.reconnectMaxDelayMs < options.reconnectMinDelayMs
    ) {
      throw new Error('Host reconnect maximum delay must not be less than its minimum delay');
    }
    if (options.heartbeatIntervalMs !== undefined && options.heartbeatIntervalMs <= 0) {
      throw new Error('Host heartbeat interval must be greater than zero');
    }

    this.endpoint = options.endpoint;
    this.createHello =
      options.createHello ??
      (() => {
        throw new Error('Host hello factory has not been configured');
      });
    this.webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.autoReconnect = options.autoReconnect ?? false;
    this.reconnectMinDelayMs = options.reconnectMinDelayMs ?? DEFAULT_RECONNECT_MIN_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  public setLastSeq(lastSeq: number): void {
    if (!Number.isSafeInteger(lastSeq) || lastSeq < 0) {
      throw new Error('Host sequence must be a non-negative safe integer');
    }

    this.lastSeq = lastSeq;
  }

  public setHelloFactory(factory: HostClientHelloFactory): void {
    this.createHello = factory;
  }

  public connect(): Promise<HostHello> {
    if (this.state.kind === 'open' && this.hostHello !== undefined) {
      return Promise.resolve(this.hostHello);
    }
    if (this.helloPromise !== undefined) {
      return this.helloPromise.promise;
    }
    if (this.socket !== undefined) {
      return Promise.reject(new Error('Host WebSocket is already connecting'));
    }

    this.closing = false;
    this.cancelReconnect();
    this.reconnectAttempt = 0;
    this.hostHello = undefined;
    this.publishState({ kind: 'connecting' });
    return this.openSocket(true);
  }

  public send(message: Parameters<HostTransport['send']>[0]): void {
    if (this.socket === undefined || this.socket.readyState !== OPEN_READY_STATE) {
      throw new Error('Host transport is not open');
    }

    this.socket.send(encodeHostWireMessage(message));
  }

  public subscribe(listener: HostTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public subscribeState(listener: HostTransportStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  public async close(): Promise<void> {
    this.closing = true;
    this.cancelReconnect();
    this.clearHeartbeat();
    this.failHello(new Error('Host transport closed'));
    this.disposeSocket();
    this.publishState({ kind: 'closed' });
  }

  private openSocket(waitForHello: true): Promise<HostHello>;
  private openSocket(waitForHello: false): void;
  private openSocket(waitForHello: boolean): Promise<HostHello> | undefined {
    if (waitForHello) {
      if (this.helloPromise === undefined) {
        this.createHelloPromise();
      } else {
        this.resetAttemptTimer();
      }
    }
    try {
      const socket = this.webSocketFactory(this.endpoint);
      this.socket = socket;
      socket.onopen = () => this.handleOpen(socket);
      socket.onmessage = (event) => this.handleMessage(socket, event.data);
      socket.onerror = () => this.handleSocketError(socket);
      socket.onclose = (event) => this.handleClose(socket, event);
    } catch (error) {
      this.abandonAttempt(toError(error, 'Unable to create Host WebSocket'), false);
    }
    return waitForHello ? this.helloPromise?.promise : undefined;
  }

  private createHelloPromise(): Promise<HostHello> {
    let resolveHello: (hello: HostHello) => void = () => undefined;
    let rejectHello: (error: Error) => void = () => undefined;
    const promise = new Promise<HostHello>((resolve, reject) => {
      resolveHello = resolve;
      rejectHello = reject;
    });
    this.helloPromise = {
      promise,
      resolve: resolveHello,
      reject: rejectHello,
      timer: this.startAttemptTimer(promise),
    };
    return promise;
  }

  private startAttemptTimer(promise: Promise<HostHello>): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      if (this.helloPromise?.promise !== promise) {
        return;
      }
      this.abandonAttempt(
        new Error(`Timed out connecting to Host at ${this.endpoint}`),
        false,
      );
    }, this.connectTimeoutMs);
  }

  private resetAttemptTimer(): void {
    const pending = this.helloPromise;
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    pending.timer = this.startAttemptTimer(pending.promise);
  }

  private handleOpen(socket: WebSocketLike): void {
    if (this.socket !== socket) {
      return;
    }

    this.publishState({ kind: 'open' });
    try {
      const hello: HostClientHello = this.createHello(this.lastSeq);
      socket.send(encodeHostWireMessage(hello));
    } catch (error) {
      this.abandonAttempt(toError(error, 'Unable to send Host hello'), false);
    }
  }

  private handleMessage(socket: WebSocketLike, data: unknown): void {
    if (this.socket !== socket) {
      return;
    }
    if (typeof data !== 'string') {
      this.handleSocketError(socket, 'Host transport received a non-text frame');
      return;
    }

    try {
      const message = decodeHostWireMessage(data);
      // Any inbound frame means the Host process is alive. Agent turns flood
      // pushes for longer than HEARTBEAT_TIMEOUT; counting only ping replies
      // then tears the socket and the shell paints "connecting".
      this.noteInboundLiveness();
      if (message.type === 'response' && message.requestId === this.heartbeatRequestId) {
        return;
      }
      if (message.type === 'host/hello') {
        this.hostHello = message;
        this.reconnectAttempt = 0;
        this.startHeartbeat(socket);
        const pendingHello = this.helloPromise;
        if (pendingHello !== undefined) {
          clearTimeout(pendingHello.timer);
          this.helloPromise = undefined;
          pendingHello.resolve(message);
        }
      }
      for (const listener of this.messageListeners) {
        listener(message);
      }
    } catch (error) {
      this.handleSocketError(socket, toError(error, 'Invalid Host wire message').message);
    }
  }

  private handleSocketError(socket: WebSocketLike, reason = 'Host WebSocket error'): void {
    if (this.socket !== socket) {
      return;
    }
    this.publishState({ kind: 'error', reason });
    // Let handleClose be the single settlement: do not reject connect() here
    // or autoReconnect cannot resolve the original handshake.
    if (
      socket.readyState === OPEN_READY_STATE ||
      socket.readyState === CONNECTING_READY_STATE
    ) {
      try {
        socket.close(4007, reason);
      } catch {
        this.handleClose(socket, { code: 1006, reason });
      }
      return;
    }
    this.handleClose(socket, { code: 1006, reason });
  }

  private handleClose(socket: WebSocketLike, event: { code: number; reason: string }): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = undefined;
    this.clearHeartbeat();
    const reason =
      event.reason.length > 0 ? event.reason : `WebSocket closed (${event.code})`;
    const fatal = FATAL_CLOSE_CODES.has(event.code);
    const error = new Error(
      fatal
        ? `Host rejected the connection (${event.code}): ${reason}`
        : `Host WebSocket closed before handshake (${event.code}): ${reason}`,
    );
    if (this.closing) {
      this.failHello(error);
      return;
    }
    this.publishState({ kind: fatal ? 'error' : 'closed', reason });
    if (fatal || !this.autoReconnect) {
      this.failHello(error);
      return;
    }
    this.clearHelloTimer();
    this.scheduleReconnect();
  }

  private abandonAttempt(error: Error, fatal: boolean): void {
    this.disposeSocket();
    this.publishState({ kind: 'error', reason: error.message });
    if (fatal || !this.autoReconnect || this.closing) {
      this.failHello(error);
      return;
    }
    this.clearHelloTimer();
    this.scheduleReconnect();
  }

  private clearHelloTimer(): void {
    const pendingHello = this.helloPromise;
    if (pendingHello === undefined) {
      return;
    }
    clearTimeout(pendingHello.timer);
  }

  private failHello(error: Error): void {
    const pendingHello = this.helloPromise;
    if (pendingHello === undefined) {
      return;
    }

    clearTimeout(pendingHello.timer);
    this.helloPromise = undefined;
    pendingHello.reject(error);
  }

  private disposeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.clearHeartbeat();
    if (socket === undefined) {
      return;
    }

    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    // CONNECTING sockets must be aborted too — otherwise a black-hole dial
    // keeps the shared Tauri plugin queue blocked after connect timeout.
    if (
      socket.readyState === OPEN_READY_STATE ||
      socket.readyState === CONNECTING_READY_STATE
    ) {
      try {
        socket.close(1000, 'transport disposed');
      } catch {
        // Some runtimes throw if the underlying dial already failed.
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.closing || this.reconnectTimer !== undefined) {
      return;
    }
    const exponential = this.reconnectMinDelayMs * 2 ** Math.min(this.reconnectAttempt, 6);
    const capped = Math.min(this.reconnectMaxDelayMs, exponential);
    // Jitter avoids reconnect stampedes when many shells drop together.
    const delay = Math.max(
      this.reconnectMinDelayMs,
      Math.floor(capped * (0.5 + Math.random() * 0.5)),
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closing || this.socket !== undefined) {
        return;
      }
      this.publishState({ kind: 'connecting' });
      if (this.helloPromise !== undefined) {
        this.openSocket(true);
        return;
      }
      const handshake = this.openSocket(true);
      void handshake.catch(() => undefined);
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === undefined) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private startHeartbeat(socket: WebSocketLike): void {
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }
    this.clearHeartbeat();
    this.lastHeartbeatTickAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== OPEN_READY_STATE) {
        this.clearHeartbeat();
        return;
      }
      const now = Date.now();
      // System sleep freezes timers; on wake the first tick looks like a huge gap.
      // Reset outstanding ping state instead of declaring the Host dead.
      if (
        this.lastHeartbeatTickAt > 0 &&
        now - this.lastHeartbeatTickAt >
          this.heartbeatIntervalMs * 2 + HEARTBEAT_TIMEOUT_MS
      ) {
        this.heartbeatRequestId = undefined;
        if (this.heartbeatTimeoutTimer !== undefined) {
          clearTimeout(this.heartbeatTimeoutTimer);
          this.heartbeatTimeoutTimer = undefined;
        }
      }
      this.lastHeartbeatTickAt = now;
      if (this.heartbeatRequestId !== undefined) {
        // A delayed interval tick is not death. The outstanding ping still
        // has its timeout; overlapping that with a busy agent turn used to
        // close a live socket.
        return;
      }
      const requestId = `heartbeat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      this.heartbeatRequestId = requestId;
      try {
        socket.send(
          encodeHostWireMessage({
            type: 'command',
            requestId,
            command: { type: 'host/ping', id: requestId },
          }),
        );
        this.armHeartbeatTimeout(socket, requestId);
      } catch (error) {
        this.heartbeatRequestId = undefined;
        this.handleSocketError(socket, toError(error, 'Unable to send Host heartbeat').message);
      }
    }, this.heartbeatIntervalMs);
  }

  private noteInboundLiveness(): void {
    this.heartbeatRequestId = undefined;
    if (this.heartbeatTimeoutTimer !== undefined) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
  }

  private armHeartbeatTimeout(socket: WebSocketLike, requestId: string): void {
    if (this.heartbeatTimeoutTimer !== undefined) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }
    this.heartbeatTimeoutTimer = setTimeout(() => {
      if (this.socket !== socket || this.heartbeatRequestId !== requestId) {
        return;
      }
      this.handleSocketError(socket, 'Host heartbeat timed out');
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.heartbeatTimeoutTimer !== undefined) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
    this.heartbeatRequestId = undefined;
  }

  private publishState(state: HostTransportState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}

function createDefaultWebSocket(endpoint: string): WebSocketLike {
  const candidate = (
    globalThis as unknown as {
      WebSocket?: new (url: string) => WebSocketLike;
    }
  ).WebSocket;
  if (candidate === undefined) {
    throw new Error('This runtime does not provide a WebSocket implementation');
  }

  return new candidate(endpoint);
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
