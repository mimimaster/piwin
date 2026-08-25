import { describe, expect, it } from 'vitest';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
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
import { createMemoryClientToolPreferenceStore } from './client-tool-preferences.js';
import {
  advertiseMobileHealthRuntime,
  attachMobileClientToolRuntime,
  buildMobileHelloCapabilities,
  shouldAdvertiseHealthOnHello,
  shouldIncludeAppleHealthOnSend,
} from './mobile-health-session.js';

class FakeTransport implements HostTransport {
  public readonly sent: HostClientOutboundFrame[] = [];
  public helloFrame: unknown;
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

  public setHelloFactory(factory: (lastSeq: number) => unknown): void {
    this.helloFactory = factory;
  }

  public setLastSeq(_lastSeq: number): void {
    void _lastSeq;
  }

  public async connect(): Promise<HostHello> {
    this.helloFrame = this.helloFactory?.(0);
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

describe('mobile health session wiring', () => {
  it('puts apple-health.read-context.v1 on hello only when Health is connected', () => {
    expect(shouldAdvertiseHealthOnHello({
      healthConnected: false,
      nativeAvailable: true,
      production: false,
      allowFake: true,
    })).toBe(false);
    expect(shouldAdvertiseHealthOnHello({
      healthConnected: true,
      nativeAvailable: false,
      production: true,
      allowFake: true,
    })).toBe(false);
    expect(shouldAdvertiseHealthOnHello({
      healthConnected: true,
      nativeAvailable: false,
      production: false,
      allowFake: true,
    })).toBe(true);
    expect(buildMobileHelloCapabilities({ advertiseHealth: true }).clientTools).toEqual([
      { id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 },
    ]);
    expect(buildMobileHelloCapabilities({ advertiseHealth: false }).clientTools).toBeUndefined();
  });

  it('constructs a runtime that advertises and subscribes to client-tool/request', async () => {
    const transport = new FakeTransport();
    const client = new HostClient({
      transport,
      clientId: 'phone',
      clientType: 'mobile',
      clientVersion: 'test',
      capabilities: buildMobileHelloCapabilities({ advertiseHealth: true }),
    });
    const runtime = attachMobileClientToolRuntime({
      client,
      endpoint: 'ws://127.0.0.1:8787',
      deviceId: 'device-a',
      preferences: createMemoryClientToolPreferenceStore(),
      healthEnabled: true,
      nativeHealthAvailable: false,
      production: false,
      allowFakeHealth: true,
      requestConsent: async () => 'once',
    });
    await client.connect();
    const advertised = await advertiseMobileHealthRuntime(runtime);
    expect(advertised).toEqual([{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }]);
    expect(transport.sent.some((frame) => frame.type === 'client-tool/capabilities')).toBe(true);
    expect(transport.helloFrame).toMatchObject({
      type: 'client/hello',
      capabilities: {
        clientTools: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      },
    });
    runtime.stop();
    await client.close();
  });

  it('passes includeAppleHealth only when the chip is on and Health is enabled', () => {
    expect(shouldIncludeAppleHealthOnSend({ healthEnabled: true, includeAppleHealth: true })).toBe(
      true,
    );
    expect(shouldIncludeAppleHealthOnSend({ healthEnabled: false, includeAppleHealth: true })).toBe(
      false,
    );
  });
});


