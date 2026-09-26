import { describe, expect, it, vi } from 'vitest';
import type { HostHello, HostWireMessage } from '@piwin/contracts';
import { encodeHostWireMessage } from './protocol-codec.js';
import { WebSocketHostTransport, type WebSocketLike } from './websocket-host-transport.js';

class FakeSocket implements WebSocketLike {
  public readonly sent: string[] = [];
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(code = 1000, reason = 'closed'): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  public emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public emitClose(code = 1006, reason = 'network'): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  public emitMessage(message: HostWireMessage): void {
    this.onmessage?.({ data: encodeHostWireMessage(message) });
  }

  public emitBinary(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes });
  }
}

const CAPABILITIES = {
  pushSequencing: true,
  replay: true,
  snapshot: true,
  sessionRead: true,
  sessionControl: false,
  permissionResolve: false,
  mediaUpload: false,
} as const;

describe('WebSocketHostTransport', () => {
  it('sends the hello and resolves after the host hello', async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-1',
        lastSeq,
      }),
      webSocketFactory: () => socket,
    });
    transport.setLastSeq(7);

    const connection = transport.connect();
    socket.emitOpen();
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ lastSeq: 7 });

    const hello: HostHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-1',
      currentSeq: 7,
      authRequired: false,
      authenticated: true,
      capabilities: CAPABILITIES,
    };
    socket.emitMessage(hello);

    await expect(connection).resolves.toEqual(hello);
    await transport.close();
  });

  it('delivers binary frames to the binary subscriber without erroring the socket', async () => {
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://127.0.0.1:1',
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-binary',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const received: Uint8Array[] = [];
    transport.subscribeBinary((bytes) => received.push(bytes));
    const connect = transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('socket missing');
    socket.emitOpen();
    socket.emitMessage(createHostHello('host-1'));
    await connect;

    socket.emitBinary(new Uint8Array([0x50, 0x42, 0x46, 0x31]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toHaveLength(1);
    expect(Array.from(received[0] as Uint8Array)).toEqual([0x50, 0x42, 0x46, 0x31]);
    // A binary frame is not a text-frame protocol error.
    expect(socket.readyState).toBe(1);
  });

  it('ignores binary frames when nothing subscribes', async () => {
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://127.0.0.1:1',
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-binary',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const connect = transport.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('socket missing');
    socket.emitOpen();
    socket.emitMessage(createHostHello('host-1'));
    await connect;

    socket.emitBinary(new Uint8Array([1]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(socket.readyState).toBe(1);
  });

  it('reconnects with the last cursor after an unexpected close', async () => {
    const sockets: FakeSocket[] = [];
    const states: string[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      reconnectMinDelayMs: 1,
      reconnectMaxDelayMs: 2,
      heartbeatIntervalMs: 1_000,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-1',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    transport.subscribeState((state) => states.push(state.kind));
    transport.setLastSeq(42);

    const connection = transport.connect();
    const firstSocket = sockets[0];
    if (firstSocket === undefined) {
      throw new Error('Expected the first fake socket');
    }
    firstSocket.emitOpen();
    firstSocket.emitMessage(createHostHello('host-1'));
    await connection;

    firstSocket.emitClose();
    await waitFor(() => sockets.length === 2);
    const secondSocket = sockets[1];
    if (secondSocket === undefined) {
      throw new Error('Expected a reconnecting fake socket');
    }
    secondSocket.emitOpen();
    expect(JSON.parse(secondSocket.sent[0] ?? '{}')).toMatchObject({ lastSeq: 42 });
    secondSocket.emitMessage(createHostHello('host-1'));
    await waitFor(() => states.includes('connecting') && states.at(-1) === 'open');

    await transport.close();
  });

  it('resolves the original connect() after Host comes up on a later attempt', async () => {
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      reconnectMinDelayMs: 1,
      reconnectMaxDelayMs: 2,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-cold-start',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const connection = transport.connect();
    const firstSocket = sockets[0];
    if (firstSocket === undefined) {
      throw new Error('Expected the first fake socket');
    }
    firstSocket.emitClose(1006, 'connection refused');
    await waitFor(() => sockets.length === 2);
    const secondSocket = sockets[1];
    if (secondSocket === undefined) {
      throw new Error('Expected a retry socket after Host was down');
    }
    secondSocket.emitOpen();
    secondSocket.emitMessage(createHostHello('host-late'));
    await expect(connection).resolves.toMatchObject({ hostInstanceId: 'host-late' });

    await transport.close();
  });

  it('fails the initial dial instead of looping when pre-handshake reconnect is disabled', async () => {
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      autoReconnectBeforeHandshake: false,
      reconnectMinDelayMs: 1,
      reconnectMaxDelayMs: 2,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-no-initial-loop',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const connection = transport.connect();
    const socket = sockets[0];
    if (socket === undefined) {
      throw new Error('Expected the first fake socket');
    }
    socket.emitClose(1006, 'connection refused');

    await expect(connection).rejects.toThrow('connection refused');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sockets).toHaveLength(1);
    await transport.close();
  });

  it('retries after a connect timeout until hello arrives when autoReconnect is on', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      connectTimeoutMs: 100,
      reconnectMinDelayMs: 20,
      reconnectMaxDelayMs: 20,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-timeout-retry',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    try {
      const connection = transport.connect();
      await vi.advanceTimersByTimeAsync(100);
      expect(sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(20);
      expect(sockets).toHaveLength(2);
      const secondSocket = sockets[1];
      if (secondSocket === undefined) {
        throw new Error('Expected a retry socket after connect timeout');
      }
      secondSocket.emitOpen();
      secondSocket.emitMessage(createHostHello('host-after-timeout'));
      await expect(connection).resolves.toMatchObject({ hostInstanceId: 'host-after-timeout' });
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('does not auto-reconnect after a fatal auth close code', async () => {
    const sockets: FakeSocket[] = [];
    const states: Array<{ kind: string; reason?: string }> = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      reconnectMinDelayMs: 1,
      reconnectMaxDelayMs: 2,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-fatal',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    transport.subscribeState((state) => states.push(state));

    const connection = transport.connect();
    const socket = sockets[0];
    if (socket === undefined) {
      throw new Error('Expected a socket');
    }
    socket.emitOpen();
    socket.emitClose(4004, 'Authentication failed');
    await expect(connection).rejects.toThrow(/4004/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sockets).toHaveLength(1);
    expect(states.at(-1)?.kind).toBe('error');
    await transport.close();
  });

  it('preserves the Host handshake error when the socket closes', async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      createHello: () => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-handshake-error',
        lastSeq: 0,
      }),
      webSocketFactory: () => socket,
    });

    const connection = transport.connect();
    socket.emitOpen();
    socket.emitMessage({
      type: 'error',
      code: 'authentication-required',
      message: 'Pairing token is invalid or expired',
    });
    socket.emitClose(4004, 'Authentication failed');

    await expect(connection).rejects.toThrow('Pairing token is invalid or expired');
    await transport.close();
  });

  it('closes CONNECTING sockets on connect timeout', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    let closed = false;
    socket.close = () => {
      closed = true;
      socket.readyState = 3;
    };
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      connectTimeoutMs: 100,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-timeout',
        lastSeq,
      }),
      webSocketFactory: () => socket,
    });
    try {
      const connection = transport.connect();
      const rejected = expect(connection).rejects.toThrow(/Timed out/);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(closed).toBe(true);
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('keeps the socket open when Host pushes arrive without answering ping', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const states: string[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      heartbeatIntervalMs: 1_000,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-heartbeat',
        lastSeq,
      }),
      webSocketFactory: () => socket,
    });
    transport.subscribeState((state) => states.push(state.kind));
    try {
      const connection = transport.connect();
      socket.emitOpen();
      socket.emitMessage(createHostHello('host-1'));
      await connection;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(socket.sent.some((frame) => frame.includes('host/ping'))).toBe(true);

      socket.emitMessage({
        type: 'push',
        seq: 1,
        eventId: 'event-1',
        push: { type: 'host/log', level: 'info', message: 'agent still running' },
      });
      // A live agent turn keeps pushing. Five seconds of silence after a
      // push is still inside HEARTBEAT_TIMEOUT; fifteen would send a new
      // ping and then legitimately die.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(socket.readyState).toBe(1);
      expect(states).not.toContain('error');
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('does not treat a delayed heartbeat interval as a dead Host', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const states: string[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      heartbeatIntervalMs: 1_000,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'client-overlap',
        lastSeq,
      }),
      webSocketFactory: () => socket,
    });
    transport.subscribeState((state) => states.push(state.kind));
    try {
      const connection = transport.connect();
      socket.emitOpen();
      socket.emitMessage(createHostHello('host-1'));
      await connection;
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(states).not.toContain('error');
      await vi.advanceTimersByTimeAsync(9_000);
      expect(states).toContain('error');
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('wake probes an open socket and declares it dead fast when the ping goes unanswered', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const states: string[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      autoReconnectBeforeHandshake: false,
      reconnectMinDelayMs: 50,
      reconnectMaxDelayMs: 50,
      heartbeatIntervalMs: 30_000,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-wake-probe',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    transport.subscribeState((state) => states.push(state.kind));
    try {
      const connection = transport.connect();
      sockets[0]?.emitOpen();
      sockets[0]?.emitMessage(createHostHello('host-1'));
      await connection;

      // Suspended socket: still reads OPEN, but nothing will ever answer.
      expect(transport.wake()).toBe(true);
      expect(sockets[0]?.sent.filter((frame) => frame.includes('host/ping'))).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(3_999);
      expect(states).not.toContain('error');
      await vi.advanceTimersByTimeAsync(1);
      expect(states).toContain('error');
      await vi.advanceTimersByTimeAsync(50);
      expect(sockets).toHaveLength(2);
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('wake keeps a live socket when the probe is answered', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const states: string[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      heartbeatIntervalMs: 30_000,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-wake-alive',
        lastSeq,
      }),
      webSocketFactory: () => socket,
    });
    transport.subscribeState((state) => states.push(state.kind));
    try {
      const connection = transport.connect();
      socket.emitOpen();
      socket.emitMessage(createHostHello('host-1'));
      await connection;
      transport.wake();
      const ping = JSON.parse(socket.sent.at(-1) ?? '{}') as { requestId?: string };
      socket.emitMessage({
        type: 'response',
        requestId: ping.requestId ?? '',
        response: { type: 'response', command: 'host/ping', success: true },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(socket.readyState).toBe(1);
      expect(states).not.toContain('error');
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('wake skips the grown backoff and redials immediately', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      autoReconnectBeforeHandshake: false,
      reconnectMinDelayMs: 10_000,
      reconnectMaxDelayMs: 10_000,
      createHello: (lastSeq) => ({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'mobile',
        clientVersion: 'test',
        clientId: 'client-wake-redial',
        lastSeq,
      }),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    try {
      const connection = transport.connect();
      sockets[0]?.emitOpen();
      sockets[0]?.emitMessage(createHostHello('host-1'));
      await connection;
      sockets[0]?.emitClose(1006, 'suspended');
      expect(sockets).toHaveLength(1);

      expect(transport.wake()).toBe(true);
      expect(sockets).toHaveLength(2);
      // The skipped timer must not dial a third socket later.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sockets).toHaveLength(2);
    } finally {
      await transport.close();
      vi.useRealTimers();
    }
  });

  it('wake reports false once the transport is closed for good', async () => {
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      webSocketFactory: () => new FakeSocket(),
    });
    await transport.close();
    expect(transport.wake()).toBe(false);
  });
});

function createHostHello(hostInstanceId: string): HostHello {
  return {
    type: 'host/hello',
    protocolVersion: 1,
    hostInstanceId,
    currentSeq: 0,
    authRequired: false,
    authenticated: true,
    capabilities: CAPABILITIES,
  };
}

function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 1_000) {
        reject(new Error('Timed out waiting for fake WebSocket state'));
        return;
      }
      setTimeout(check, 1);
    };
    check();
  });
}
