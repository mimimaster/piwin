import { describe, expect, it } from 'vitest';
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
    expect(JSON.parse(secondSocket.sent[0] ?? '{}')).toMatchObject({ lastSeq: 0 });
    secondSocket.emitMessage(createHostHello('host-1'));
    await waitFor(() => states.includes('connecting') && states.at(-1) === 'open');

    await transport.close();
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
