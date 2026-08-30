import { describe, expect, it, vi } from 'vitest';
import type {
  HostClientHello,
  HostClientOutboundFrame,
  HostCommandFrame,
  HostHello,
  HostHydrationFrame,
  HostPushBatchFrame,
  HostPush,
  HostPushFrame,
  HostReplayFrame,
  HostResponseFrame,
  HostWireMessage,
} from '@piwin/contracts';
import { APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID } from '@piwin/contracts';
import {
  WebSocketHostTransport,
  type HostTransport,
  type HostTransportMessageListener,
  type HostTransportState,
  type HostTransportStateListener,
  type WebSocketLike,
} from '@piwin/host-transport';
import { HostClient, MAX_PENDING_PUSH_FRAMES } from './host-client.js';

class FakeTransport implements HostTransport {
  public readonly sent: HostClientOutboundFrame[] = [];
  public nextHello: HostHello | undefined;
  public helloAtConnect: HostClientHello | undefined;
  /** When true, connect() returns hello before emitting replay/done. */
  public deferCatchUp = false;
  private helloFactory: ((lastSeq: number) => HostClientHello) | undefined;
  private lastSeq = 0;
  private readonly messageListeners = new Set<HostTransportMessageListener>();
  private readonly stateListeners = new Set<HostTransportStateListener>();
  private state: HostTransportState = { kind: 'idle' };

  public setHelloFactory(factory: (lastSeq: number) => HostClientHello): void {
    this.helloFactory = factory;
  }

  public setLastSeq(lastSeq: number): void {
    this.lastSeq = lastSeq;
  }

  public async connect(): Promise<HostHello> {
    this.helloAtConnect = this.helloFactory?.(this.lastSeq);
    const hello: HostHello = this.nextHello ?? {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-test',
      currentSeq: this.lastSeq,
      authRequired: false,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: false,
        permissionResolve: false,
        mediaUpload: false,
      },
    };
    this.emit(hello);
    if (!this.deferCatchUp) {
      this.emitCatchUp(hello.currentSeq);
    }
    this.emitState({ kind: 'open' });
    return hello;
  }

  public emitCatchUp(currentSeq = this.lastSeq): void {
    this.emit({
      type: 'replay/done',
      requestId: 'fake-hello-replay',
      fromSeq: this.lastSeq + 1,
      toSeq: this.lastSeq,
      currentSeq,
      complete: true,
    });
  }

  public send(message: HostClientOutboundFrame): void {
    this.sent.push(message);
    if (message.type === 'client/subscriptions') {
      this.emit({
        type: 'subscriptions/applied',
        requestId: message.requestId,
        revision: message.revision,
        fenceSeq: 12,
      });
      return;
    }
    if (message.type === 'command') {
      const response: HostResponseFrame = {
        type: 'response',
        requestId: message.requestId,
        response: {
          type: 'response',
          command: message.command.type,
          success: true,
          data: { pong: true },
        },
      };
      this.emit(response);
    }
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
    this.emitState({ kind: 'closed' });
  }

  public emitPush(seq: number): void {
    const frame: HostPushFrame = {
      type: 'push',
      seq,
      eventId: `event-${seq}`,
      push: { type: 'host/status', mode: 'sdk', ready: true, mock: true },
    };
    this.emit(frame);
  }

  public emitBatch(frame: HostPushBatchFrame): void {
    this.emit(frame);
  }

  public emitHydration(frame: HostHydrationFrame): void {
    this.emit(frame);
  }

  public emit(message: HostWireMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  public getConfiguredHello(): HostClientHello | undefined {
    return this.helloFactory?.(this.lastSeq);
  }

  private emitState(state: HostTransportState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}

describe('HostClient', () => {
  it('configures identity, sends commands, and resolves responses', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'mobile-test',
      clientType: 'mobile',
      clientVersion: 'test',
    });

    await client.connect();
    expect(transport.getConfiguredHello()).toMatchObject({
      clientId: 'mobile-test',
      clientType: 'mobile',
      lastSeq: 0,
    });

    const response = await client.request({ type: 'host/ping' });
    expect(response).toMatchObject({ success: true, command: 'host/ping' });
    expect(transport.sent[0]).toMatchObject({ command: { type: 'host/ping' } });

    await client.close();
  });

  it('sends a live subscription update and resolves the applied fence', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'mobile-sub',
      clientType: 'mobile',
      clientVersion: 'test',
      capabilities: { liveSubscriptions: true },
    });
    await client.connect();
    const applied = await client.updateSubscriptions(['session-b']);
    expect(applied).toMatchObject({ type: 'subscriptions/applied', revision: 1, fenceSeq: 12 });
    expect(transport.sent.some((frame) => frame.type === 'client/subscriptions')).toBe(true);
    await client.close();
  });

  it('does not mint an idempotency key and fails remote mutations that omit one', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'mobile-test',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    const missing = await client.request({
      type: 'session/prompt',
      sessionId: 's1',
      input: { text: 'hi' },
      foreground: { kind: 'if-idle' },
    });
    expect(missing).toMatchObject({
      success: false,
      error: 'idempotency-key-required',
      problem: { code: 'idempotency-key-required' },
    });
    expect(transport.sent).toHaveLength(0);

    const ok = await client.request(
      {
        type: 'session/prompt',
        sessionId: 's1',
        input: { text: 'hi' },
        foreground: { kind: 'if-idle' },
      },
      { idempotencyKey: 'gesture-1' },
    );
    expect(ok.success).toBe(true);
    expect(transport.sent[0]).toMatchObject({
      type: 'command',
      idempotencyKey: 'gesture-1',
      command: { type: 'session/prompt' },
    });
    await client.close();
  });

  it('rejects commands outside the negotiated ceiling without sending them', async () => {
    const transport = new FakeTransport();
    transport.nextHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-command-ceiling',
      currentSeq: 0,
      authRequired: false,
      authenticated: true,
      capabilities: {
        allowedCommands: ['host/ping'],
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: false,
        permissionResolve: false,
        mediaUpload: false,
      },
    };
    const client = new HostClient({
      transport,
      clientId: 'desktop-command-ceiling',
      clientType: 'desktop',
      clientVersion: 'test',
    });

    await client.connect();
    expect(client.supportsCommand('host/ping')).toBe(true);
    expect(client.supportsCommand('settings/get')).toBe(false);

    const response = await client.request({ type: 'settings/get' });
    expect(response).toMatchObject({
      command: 'settings/get',
      success: false,
      error: 'This Host does not expose settings/get to remote clients',
    });
    expect(transport.sent).toEqual([]);
    await client.close();
  });

  it('sends settings/get when the Host omitted the command ceiling', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'desktop-legacy-ceiling',
      clientType: 'desktop',
      clientVersion: 'test',
    });

    await client.connect();
    expect(client.supportsCommand('host/status')).toBe(true);
    expect(client.supportsCommand('settings/get')).toBe(true);
    expect(client.supportsCommand('settings/apply')).toBe(true);

    const response = await client.request({ type: 'settings/get' });
    expect(response.success).toBe(true);
    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0] as HostCommandFrame | undefined;
    expect(sent?.command.type).toBe('settings/get');
    await client.close();
  });

  it('advertises subscriptions and atomically applies hydration', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'desktop-test',
      clientType: 'desktop',
      clientVersion: 'test',
      subscriptions: { sessionIds: ['session-1', 'session-1', 'session-2'] },
    });
    const hydrated: string[] = [];
    client.subscribeHydration((frame) => hydrated.push(frame.snapshot.snapshotId));

    await client.connect();
    expect(transport.getConfiguredHello()).toMatchObject({
      subscriptions: { sessionIds: ['session-1', 'session-2'] },
    });
    const frame: HostHydrationFrame = {
      type: 'hydration',
      reason: 'replay-too-old',
      snapshot: {
        snapshotId: 'snapshot-1',
        hostInstanceId: 'host-test',
        snapshotSeq: 12,
        status: {
          hostInstanceId: 'host-test',
          protocolVersion: 1,
          mode: 'sdk',
          ready: true,
          mock: false,
          activeSessionCount: 1,
          capabilities: {
            pushSequencing: true,
            replay: true,
            snapshot: true,
            sessionRead: true,
            sessionControl: false,
            permissionResolve: false,
            mediaUpload: false,
          },
        },
        sessions: [],
        messagesBySession: {},
        truncatedSessionIds: [],
      },
    };
    transport.emitHydration(frame);

    expect(hydrated).toEqual(['snapshot-1']);
    expect(client.getCursor()).toEqual({ hostInstanceId: 'host-test', throughSeq: 12 });
    await client.close();
  });

  it('deduplicates old pushes and reports a sequence gap', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'mobile-test',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    const states: HostClientStateSnapshot[] = [];
    client.subscribeState((state) => states.push(state));
    const received: number[] = [];
    client.subscribePush((_push, frame) => received.push(frame.seq));

    await client.connect();
    transport.emitPush(1);
    transport.emitPush(1);
    transport.emitPush(3);
    transport.emitPush(2);

    expect(received).toEqual([1, 2, 3]);
    expect(states).toContainEqual({ kind: 'resync-required', expectedSeq: 2, receivedSeq: 3 });
    expect(transport.sent.some((message) => message.type === 'replay')).toBe(true);

    await client.close();
  });

  it('drops buffered out-of-order pushes once the pending cap is reached', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'desktop-test',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    const received: number[] = [];
    client.subscribePush((_push, frame) => received.push(frame.seq));

    await client.connect();
    transport.emitPush(1);
    for (let seq = 3; seq < 3 + MAX_PENDING_PUSH_FRAMES; seq += 1) {
      transport.emitPush(seq);
    }
    transport.emitPush(3 + MAX_PENDING_PUSH_FRAMES);
    transport.emitPush(2);

    expect(received).toEqual([1, 2]);

    await client.close();
  });

  it('applies a cursor batch atomically and permits filtered sequence gaps', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'desktop-test',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    const batches: HostPushBatchFrame[] = [];
    const received: number[] = [];
    client.subscribeBatch((batch) => batches.push(batch));
    client.subscribePush((_push, frame) => received.push(frame.seq));

    await client.connect();
    transport.emitBatch({
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 0,
      throughSeq: 3,
      items: [
        {
          seq: 1,
          eventId: 'event-1',
          push: { type: 'host/log', level: 'info', message: 'one' },
        },
        {
          seq: 3,
          eventId: 'event-3',
          push: { type: 'host/log', level: 'info', message: 'three' },
        },
      ],
    });

    expect(batches).toHaveLength(1);
    expect(received).toEqual([1, 3]);
    expect(client.getLastSeq()).toBe(3);
    expect(client.getCursor()).toEqual({ hostInstanceId: 'host-test', throughSeq: 3 });

    transport.emitBatch({
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 3,
      throughSeq: 3,
      items: [],
    });
    expect(batches).toHaveLength(1);
    await client.close();
  });

  it('adopts the replay cursor fence across a filtered tail before live batches resume', async () => {
    const transport = new FakeTransport();
    transport.deferCatchUp = true;
    const client = new HostClient({
      transport,
      clientId: 'filtered-replay-test',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    const received: number[] = [];
    client.subscribePush((_push, frame) => received.push(frame.seq));

    await client.connect();
    transport.emitBatch({
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 0,
      throughSeq: 3,
      items: [
        {
          seq: 1,
          eventId: 'event-1',
          push: { type: 'host/log', level: 'info', message: 'one' },
        },
        {
          seq: 3,
          eventId: 'event-3',
          push: { type: 'host/log', level: 'info', message: 'three' },
        },
      ],
    });
    transport.emit({
      type: 'replay/done',
      requestId: 'hello-replay-filtered',
      fromSeq: 1,
      toSeq: 3,
      currentSeq: 5,
      complete: true,
    });

    expect(client.getLastSeq()).toBe(5);
    transport.emitBatch({
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 5,
      throughSeq: 7,
      items: [
        {
          seq: 7,
          eventId: 'event-7',
          push: { type: 'host/log', level: 'info', message: 'seven' },
        },
      ],
    });

    expect(received).toEqual([1, 3, 7]);
    expect(client.getLastSeq()).toBe(7);
    expect(transport.sent.filter((frame) => frame.type === 'replay')).toEqual([]);
    await client.close();
  });

  it('sends a pairing token without a door token and adopts the issued secret', async () => {
    const transport = new FakeTransport();
    transport.nextHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-test',
      currentSeq: 0,
      authRequired: true,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: false,
        permissionResolve: false,
        mediaUpload: false,
      },
      deviceId: 'device-1',
      deviceSecret: 'issued-secret',
    };
    const issued: Array<{ deviceId: string; deviceSecret: string }> = [];
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
      pairingToken: 'one-time',
      deviceName: 'iPhone',
      onIssuedDeviceCredential: (credential) => {
        issued.push(credential);
      },
    });

    await client.connect();
    expect(transport.helloAtConnect).toMatchObject({
      pairingToken: 'one-time',
      deviceName: 'iPhone',
    });
    expect(transport.helloAtConnect?.authToken).toBeUndefined();
    expect(issued).toEqual([{ deviceId: 'device-1', deviceSecret: 'issued-secret' }]);
    expect(transport.getConfiguredHello()).toMatchObject({
      deviceCredential: { deviceId: 'device-1', deviceSecret: 'issued-secret' },
    });
    expect(transport.getConfiguredHello()?.pairingToken).toBeUndefined();
    await client.close();
  });

  it('rejects combining a door token with a pairing token', () => {
    expect(
      () =>
        new HostClient({
          transport: new FakeTransport(),
          clientId: 'phone',
          clientType: 'mobile',
          clientVersion: 'test',
          authToken: 'door',
          pairingToken: 'one-time',
        }),
    ).toThrow('exactly one admission key');
  });

  it('keeps Transport lastSeq in sync so reconnect hellos use the live cursor', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'cursor-sync',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    await client.connect();
    expect(client.getState().kind).toBe('ready');
    transport.emitPush(1);
    transport.emitPush(2);
    expect(client.getLastSeq()).toBe(2);
    expect(transport.getConfiguredHello()).toMatchObject({ lastSeq: 2 });
    await client.close();
  });

  it('soft-fails durable cursor writes without publishing sticky error', async () => {
    const transport = new FakeTransport();
    const states: HostClientStateSnapshot[] = [];
    const client = new HostClient({
      transport,
      clientId: 'cursor-soft-fail',
      clientType: 'desktop',
      clientVersion: 'test',
      lastSeqStore: {
        read: () => 0,
        write: () => {
          throw new Error('quota exceeded');
        },
      },
    });
    client.subscribeState((state) => states.push(state));
    await client.connect();
    expect(client.getState().kind).toBe('ready');
    transport.emitPush(1);
    expect(client.getLastSeq()).toBe(1);
    expect(transport.getConfiguredHello()).toMatchObject({ lastSeq: 1 });
    expect(states.some((state) => state.kind === 'error')).toBe(false);
    expect(client.getState().kind).toBe('ready');
    await client.close();
  });

  it('does not go sticky-error on an uncorrelated Host error after hello', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'uncorrelated-error',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    await client.connect();
    expect(client.getState().kind).toBe('ready');
    transport.emit({
      type: 'error',
      code: 'request-failed',
      message: 'Remote media asset is not available on this Host',
    });
    expect(client.getState().kind).toBe('ready');
    await client.close();
  });

  it('fills unknown-agent-failure on legacy Agent error pushes', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'legacy-error',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    const events: HostPush[] = [];
    client.subscribePush((push) => events.push(push));
    await client.connect();
    transport.emit({
      type: 'push',
      seq: 1,
      eventId: 'e1',
      push: {
        type: 'event',
        sessionId: 's1',
        event: { type: 'error', message: 'Stream ended without finish_reason' },
      },
    });
    expect(events[0]).toMatchObject({
      type: 'event',
      event: {
        type: 'error',
        failure: { code: 'unknown-agent-failure', origin: 'runtime' },
      },
    });
    await client.close();
  });

  it('delivers an unknown HostPush type without entering error state', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'unknown-push',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    const events: HostPush[] = [];
    client.subscribePush((push) => events.push(push));
    await client.connect();
    transport.emit({
      type: 'push',
      seq: 1,
      eventId: 'e-unknown',
      push: { type: 'future/unknown-telemetry', sessionId: 's1' } as unknown as HostPush,
    });
    expect(client.getState().kind).toBe('ready');
    expect(events).toEqual([{ type: 'future/unknown-telemetry', sessionId: 's1' }]);
    await client.close();
  });

  it('does not close the socket when catch-up exceeds the request timeout', async () => {
    const transport = new FakeTransport();
    transport.deferCatchUp = true;
    const close = vi.spyOn(transport, 'close');
    const client = new HostClient({
      transport,
      clientId: 'catch-up-timeout',
      clientType: 'desktop',
      clientVersion: 'test',
      requestTimeoutMs: 20,
    });
    await client.connect();
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(client.getState().kind).toBe('connecting');
    expect(close).not.toHaveBeenCalled();
    transport.emitCatchUp();
    await vi.waitFor(() => {
      expect(client.getState().kind).toBe('ready');
    });
    await client.close();
  });

  it('returns from connect after hello without waiting for a delayed catch-up', async () => {
    const transport = new FakeTransport();
    transport.deferCatchUp = true;
    const client = new HostClient({
      transport,
      clientId: 'hello-first',
      clientType: 'desktop',
      clientVersion: 'test',
      requestTimeoutMs: 5_000,
    });
    const pending = client.connect();
    await expect(pending).resolves.toMatchObject({ type: 'host/hello' });
    expect(client.getState().kind).toBe('connecting');
    expect(client.getHostHello()?.hostInstanceId).toBe('host-test');
    transport.emitCatchUp();
    await vi.waitFor(() => {
      expect(client.getState().kind).toBe('ready');
    });
    await client.close();
  });

  it('clamps a future cursor when Host currentSeq is behind the stored cursor', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'future-cursor',
      clientType: 'desktop',
      clientVersion: 'test',
      lastSeqStore: {
        read: () => 99,
        write: () => undefined,
      },
    });
    transport.nextHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-restarted',
      currentSeq: 3,
      authRequired: false,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: false,
        permissionResolve: false,
        mediaUpload: false,
      },
    };
    await client.connect();
    expect(client.getLastSeq()).toBe(3);
    await client.close();
  });

  it('connects after the first dial fails when the transport auto-reconnects', async () => {
    const sockets: RetryFakeSocket[] = [];
    const transport = new WebSocketHostTransport({
      endpoint: 'ws://test-host',
      autoReconnect: true,
      reconnectMinDelayMs: 1,
      reconnectMaxDelayMs: 2,
      webSocketFactory: () => {
        const socket = new RetryFakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const client = new HostClient({
      transport,
      clientId: 'cold-host',
      clientType: 'desktop',
      clientVersion: 'test',
    });
    const pending = client.connect();
    const first = sockets[0];
    if (first === undefined) {
      throw new Error('Expected the first fake socket');
    }
    first.emitClose(1006, 'connection refused');
    await vi.waitFor(() => {
      expect(sockets.length).toBe(2);
    });
    const second = sockets[1];
    if (second === undefined) {
      throw new Error('Expected a retry socket');
    }
    second.emitOpen();
    second.emitHello('host-late');
    await expect(pending).resolves.toMatchObject({ hostInstanceId: 'host-late' });
    expect(client.getHostHello()?.hostInstanceId).toBe('host-late');
    await client.close();
  });
});

describe('HostClient client-tool frames', () => {
  it('dispatches request/cancel without advancing the push cursor', async () => {
    const transport = new FakeTransport();
    transport.nextHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-tools',
      currentSeq: 4,
      authRequired: true,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: true,
        permissionResolve: true,
        mediaUpload: false,
        clientToolRequests: true,
      },
    };
    const client = new HostClient({
      transport,
      clientId: 'mobile-test',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    transport.emitPush(client.getLastSeq() + 1);
    const cursorAfterPush = client.getLastSeq();
    expect(cursorAfterPush).toBeGreaterThan(0);
    const requests: string[] = [];
    const cancels: string[] = [];
    client.subscribeClientToolRequests((frame) => {
      requests.push(frame.requestId);
    });
    client.subscribeClientToolCancellations((frame) => {
      cancels.push(frame.requestId);
    });
    transport.emit({
      type: 'client-tool/request',
      requestId: 'req-health',
      capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      arguments: { metrics: ['steps'] },
      deadlineAt: '2026-08-23T12:02:00.000Z',
      timeoutMs: 120_000,
      display: {
        title: '读取 Apple Health',
        metricLabels: ['步数'],
        periodLabel: '今天',
        explicitTurnIntent: false,
      },
    });
    transport.emit({
      type: 'client-tool/cancel',
      requestId: 'req-health',
      reason: 'run-aborted',
    });
    expect(requests).toEqual(['req-health']);
    expect(cancels).toEqual(['req-health']);
    expect(client.getLastSeq()).toBe(cursorAfterPush);
    await client.close();
  });

  it('sends a result only when ready and the Host negotiated client tools', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'mobile-test',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    expect(() =>
      client.sendClientToolResult({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'cancelled',
        completedAt: '2026-08-23T12:00:00.000Z',
        errorCode: 'cancelled',
      }),
    ).toThrow(/authenticated ready/i);

    transport.nextHello = {
      type: 'host/hello',
      protocolVersion: 1,
      hostInstanceId: 'host-old',
      currentSeq: 0,
      authRequired: false,
      authenticated: true,
      capabilities: {
        pushSequencing: true,
        replay: true,
        snapshot: true,
        sessionRead: true,
        sessionControl: false,
        permissionResolve: false,
        mediaUpload: false,
      },
    };
    await client.connect();
    expect(() =>
      client.sendClientToolResult({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'cancelled',
        completedAt: '2026-08-23T12:00:00.000Z',
        errorCode: 'cancelled',
      }),
    ).toThrow(/does not support client-tool/i);
    await client.close();
  });
});

class RetryFakeSocket implements WebSocketLike {
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

  public emitHello(hostInstanceId: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        type: 'host/hello',
        protocolVersion: 1,
        hostInstanceId,
        currentSeq: 0,
        authRequired: false,
        authenticated: true,
        capabilities: {
          pushSequencing: true,
          replay: true,
          snapshot: true,
          sessionRead: true,
          sessionControl: false,
          permissionResolve: false,
          mediaUpload: false,
        },
      }),
    });
  }
}

type HostClientStateSnapshot = ReturnType<HostClient['getState']>;
