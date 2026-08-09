import { describe, expect, it } from 'vitest';
import type {
  HostClientHello,
  HostCommandFrame,
  HostHello,
  HostHydrationFrame,
  HostPushBatchFrame,
  HostPushFrame,
  HostReplayFrame,
  HostResponseFrame,
  HostWireMessage,
} from '@piwin/contracts';
import type {
  HostTransport,
  HostTransportMessageListener,
  HostTransportState,
  HostTransportStateListener,
} from '@piwin/host-transport';
import { HostClient } from './host-client.js';

class FakeTransport implements HostTransport {
  public readonly sent: Array<HostCommandFrame | HostReplayFrame> = [];
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
    const hello: HostHello = {
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
    this.emitState({ kind: 'open' });
    return hello;
  }

  public send(message: HostCommandFrame | HostReplayFrame): void {
    this.sent.push(message);
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

  public getConfiguredHello(): HostClientHello | undefined {
    return this.helloFactory?.(this.lastSeq);
  }

  private emit(message: HostWireMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
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
});

type HostClientStateSnapshot = ReturnType<HostClient['getState']>;
