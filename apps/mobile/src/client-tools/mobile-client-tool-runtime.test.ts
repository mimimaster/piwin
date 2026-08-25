import { describe, expect, it } from 'vitest';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  type ClientToolRequestFrame,
  type HostClientOutboundFrame,
  type HostHello,
} from '@piwin/contracts';
import { HostClient } from '@piwin/host-client';
import type {
  HostTransport,
  HostTransportMessageListener,
  HostTransportState,
  HostTransportStateListener,
} from '@piwin/host-transport';
import { createMemoryClientToolPreferenceStore, healthConsentScopeKey } from './client-tool-preferences.js';
import { FAKE_HEALTH_STEPS, isFakeHealthExecutorAllowed } from './fake-health-executor.js';
import { MobileClientToolRuntime } from './mobile-client-tool-runtime.js';

class FakeTransport implements HostTransport {
  public readonly sent: HostClientOutboundFrame[] = [];
  public nextHello: HostHello = {
    type: 'host/hello',
    protocolVersion: 1,
    hostInstanceId: 'host-a',
    currentSeq: 0,
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
  private helloFactory: ((lastSeq: number) => unknown) | undefined;
  private readonly messageListeners = new Set<HostTransportMessageListener>();
  private readonly stateListeners = new Set<HostTransportStateListener>();

  public setHelloFactory(factory: (lastSeq: number) => never): void {
    this.helloFactory = factory;
  }

  public setLastSeq(_lastSeq: number): void {
    void _lastSeq;
  }

  public async connect(): Promise<HostHello> {
    this.helloFactory?.(0);
    this.emit(this.nextHello);
    this.emit({
      type: 'replay/done',
      requestId: 'hello-replay',
      fromSeq: 1,
      toSeq: 0,
      currentSeq: 0,
      complete: true,
    });
    this.emitState({ kind: 'open' });
    return this.nextHello;
  }

  public send(message: HostClientOutboundFrame): void {
    this.sent.push(message);
  }

  public subscribe(listener: HostTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public subscribeState(listener: HostTransportStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public async close(): Promise<void> {
    this.emitState({ kind: 'closed' });
  }

  public emit(message: Parameters<HostTransportMessageListener>[0]): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private emitState(state: HostTransportState): void {
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}

const REQUEST: ClientToolRequestFrame = {
  type: 'client-tool/request',
  requestId: 'req-1',
  capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  sessionId: 'session-1',
  runId: 'run-1',
  toolCallId: 'tool-1',
  arguments: { metrics: ['steps'], range: { preset: 'today' } },
  deadlineAt: '2026-08-23T12:02:00.000Z',
  timeoutMs: 5_000,
  display: {
    title: '读取 Apple Health',
    metricLabels: ['步数'],
    periodLabel: '今天',
    explicitTurnIntent: false,
  },
};

describe('MobileClientToolRuntime', () => {
  it('answers a fake executor once and ignores a late cancel settlement', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    const runtime = new MobileClientToolRuntime({
      client,
      endpoint: 'ws://127.0.0.1:8787',
      deviceId: 'device-a',
      preferences: createMemoryClientToolPreferenceStore(),
      isAppActive: () => true,
      production: false,
      allowFakeHealth: true,
      requestConsent: async () => 'once',
    });
    runtime.start();
    transport.emit(REQUEST);
    await waitFor(() => transport.sent.some((frame) => frame.type === 'client-tool/result'));
    const results = transport.sent.filter((frame) => frame.type === 'client-tool/result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'success' });
    expect(JSON.stringify(results[0])).toContain(String(FAKE_HEALTH_STEPS));

    transport.emit({ type: 'client-tool/cancel', requestId: 'req-1', reason: 'run-aborted' });
    expect(transport.sent.filter((frame) => frame.type === 'client-tool/result')).toHaveLength(1);
    runtime.stop();
    await client.close();
  });

  it('does not reuse Host A consent for Host B', async () => {
    const preferences = createMemoryClientToolPreferenceStore();
    const firstKey = await healthConsentScopeKey('ws://127.0.0.1:8787/host-a', 'device-a');
    const secondKey = await healthConsentScopeKey('wss://host.example:9443', 'device-a');
    expect(firstKey).not.toBe(secondKey);
    preferences.write(firstKey, {
      mode: 'always-allow-this-host',
      alwaysAllowUnlocked: true,
    });

    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    let asked = 0;
    const runtime = new MobileClientToolRuntime({
      client,
      endpoint: 'wss://host.example:9443',
      deviceId: 'device-a',
      preferences,
      isAppActive: () => true,
      production: false,
      allowFakeHealth: true,
      requestConsent: async () => {
        asked += 1;
        return 'deny';
      },
    });
    runtime.start();
    transport.emit(REQUEST);
    await waitFor(() => transport.sent.some((frame) => frame.type === 'client-tool/result'));
    expect(asked).toBe(1);
    expect(transport.sent.at(-1)).toMatchObject({ status: 'permission-denied' });
    runtime.stop();
    await client.close();
  });

  it('maps native no-accessible-data instead of query-failed', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    const runtime = new MobileClientToolRuntime({
      client,
      endpoint: 'ws://127.0.0.1:8787',
      deviceId: 'device-a',
      preferences: createMemoryClientToolPreferenceStore(),
      isAppActive: () => true,
      production: false,
      executors: new Map([
        [
          APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
          async () => {
            throw new Error('healthkit-no-accessible-data');
          },
        ],
      ]),
      requestConsent: async () => 'once',
    });
    runtime.start();
    transport.emit(REQUEST);
    await waitFor(() => transport.sent.some((frame) => frame.type === 'client-tool/result'));
    expect(transport.sent.at(-1)).toMatchObject({
      status: 'no-accessible-data',
      errorCode: 'healthkit-no-accessible-data',
    });
    runtime.stop();
    await client.close();
  });

  it('asks again when always-allow is stored but provider facts are missing', async () => {
    const preferences = createMemoryClientToolPreferenceStore();
    const scopeKey = await healthConsentScopeKey('ws://127.0.0.1:8787', 'device-a');
    preferences.write(scopeKey, {
      mode: 'always-allow-this-host',
      alwaysAllowUnlocked: true,
      destinationFingerprint: 'external:openai',
    });
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    let asked = 0;
    const runtime = new MobileClientToolRuntime({
      client,
      endpoint: 'ws://127.0.0.1:8787',
      deviceId: 'device-a',
      preferences,
      isAppActive: () => true,
      production: false,
      allowFakeHealth: true,
      requestConsent: async () => {
        asked += 1;
        return 'deny';
      },
    });
    runtime.start();
    transport.emit(REQUEST);
    await waitFor(() => transport.sent.some((frame) => frame.type === 'client-tool/result'));
    expect(asked).toBe(1);
    expect(transport.sent.at(-1)).toMatchObject({ status: 'permission-denied' });
    runtime.stop();
    await client.close();
  });

  it('skips the consent sheet for an explicit @Health turn', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    let asked = 0;
    const runtime = new MobileClientToolRuntime({
      client,
      endpoint: 'ws://127.0.0.1:8787',
      deviceId: 'device-a',
      preferences: createMemoryClientToolPreferenceStore(),
      isAppActive: () => true,
      production: false,
      allowFakeHealth: true,
      requestConsent: async () => {
        asked += 1;
        return 'deny';
      },
    });
    runtime.start();
    transport.emit({
      ...REQUEST,
      display: {
        ...REQUEST.display,
        explicitTurnIntent: true,
        provider: { id: 'local-ollama', label: 'Ollama', processing: 'local' },
      },
    });
    await waitFor(() => transport.sent.some((frame) => frame.type === 'client-tool/result'));
    expect(asked).toBe(0);
    expect(transport.sent.at(-1)).toMatchObject({ status: 'success' });
    runtime.stop();
    await client.close();
  });

  it('does not advertise Health when local use is off', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
    });
    await client.connect();
    const runtime = new MobileClientToolRuntime({
      client,
      endpoint: 'ws://127.0.0.1:8787',
      deviceId: 'device-a',
      preferences: createMemoryClientToolPreferenceStore(),
      isAppActive: () => true,
      production: false,
      allowFakeHealth: true,
      healthEnabled: false,
      requestConsent: async () => 'once',
    });
    expect(runtime.advertisedCapabilities()).toEqual([]);
    runtime.stop();
    await client.close();
  });

  it('never registers fake health values on the production path', () => {
    expect(isFakeHealthExecutorAllowed({ production: true, allowFake: true })).toBe(false);
    expect(isFakeHealthExecutorAllowed({ production: false, allowFake: false })).toBe(false);
    expect(isFakeHealthExecutorAllowed({ production: false, allowFake: true })).toBe(true);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2_000) {
      throw new Error('timed out');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}
