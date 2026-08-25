import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  type ClientToolCancelFrame,
  type ClientToolRequestFrame,
  type ClientToolResultFrame,
} from '@piwin/contracts';
import { DeviceCapabilityRegistry } from './device-capability-registry.js';
import { DeviceCapabilityStore } from './device-capability-store.js';
import { DeviceToolBroker } from './device-tool-broker.js';

const DISPLAY = {
  title: '读取 Apple Health' as const,
  metricLabels: ['步数'],
  periodLabel: '今天',
  explicitTurnIntent: false,
};

const SENTINEL_STEPS = 424242;

function healthArgs(): Record<string, unknown> {
  return { metrics: ['steps'], range: { preset: 'today' }, sentinel: SENTINEL_STEPS };
}

async function createBroker(): Promise<{
  broker: DeviceToolBroker;
  registry: DeviceCapabilityRegistry;
  logs: string[];
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-cap-'));
  const store = new DeviceCapabilityStore(join(directory, 'capabilities.json'));
  const registry = new DeviceCapabilityRegistry({ store });
  await registry.load();
  const logs: string[] = [];
  const broker = new DeviceToolBroker({
    registry,
    logger: (event) => {
      logs.push(JSON.stringify(event));
    },
  });
  return {
    broker,
    registry,
    logs,
    cleanup: async () => {
      broker.dispose();
      await broker.flush();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('DeviceToolBroker', () => {
  it('sends one targeted request and accepts exactly one matching result', async () => {
    const { broker, logs, cleanup } = await createBroker();
    const sent: Array<ClientToolRequestFrame | ClientToolCancelFrame> = [];
    broker.attach({
      deviceId: 'device-a',
      connectionEpoch: 'epoch-1',
      clientType: 'mobile',
      clientVersion: 'test',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      send: (frame) => {
        sent.push(frame);
      },
    });

    const pending = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        arguments: healthArgs(),
        deadlineMs: 5_000,
        display: DISPLAY,
      },
      new AbortController().signal,
    );

    expect(sent).toHaveLength(1);
    const request = sent[0];
    if (request === undefined || request.type !== 'client-tool/request') {
      throw new Error('expected a client-tool request');
    }
    expect(request.capabilityId).toBe(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID);
    expect(request.timeoutMs).toBe(5_000);
    expect(request.deadlineAt).toEqual(expect.any(String));

    const success: ClientToolResultFrame = {
      type: 'client-tool/result',
      requestId: request.requestId,
      status: 'success',
      completedAt: new Date().toISOString(),
      result: { schemaVersion: 1, source: 'apple-health', records: [{ value: SENTINEL_STEPS }] },
    };
    broker.admitResult({
      connectionEpoch: 'epoch-1',
      deviceId: 'device-a',
      frame: success,
    });
    broker.admitResult({
      connectionEpoch: 'epoch-1',
      deviceId: 'device-a',
      frame: success,
    });

    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: true, deviceId: 'device-a' });
    expect(broker.pendingCount()).toBe(0);
    expect(logs.join('\n')).not.toContain(String(SENTINEL_STEPS));
    await cleanup();
  });

  it('ignores late, wrong-device, and wrong-connection results', async () => {
    const { broker, cleanup } = await createBroker();
    const sent: Array<ClientToolRequestFrame | ClientToolCancelFrame> = [];
    broker.attach({
      deviceId: 'device-a',
      connectionEpoch: 'epoch-1',
      clientType: 'mobile',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      send: (frame) => {
        sent.push(frame);
      },
    });
    broker.attach({
      deviceId: 'device-b',
      connectionEpoch: 'epoch-b',
      clientType: 'mobile',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      send: () => undefined,
    });

    const pending = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        arguments: healthArgs(),
        deadlineMs: 5_000,
        preferredDeviceId: 'device-a',
        display: DISPLAY,
      },
      new AbortController().signal,
    );
    const request = sent[0];
    if (request === undefined || request.type !== 'client-tool/request') {
      throw new Error('expected request');
    }

    broker.admitResult({
      connectionEpoch: 'epoch-b',
      deviceId: 'device-b',
      frame: {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'success',
        completedAt: new Date().toISOString(),
        result: { ok: true },
      },
    });
    broker.admitResult({
      connectionEpoch: 'epoch-1',
      deviceId: 'device-b',
      frame: {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'success',
        completedAt: new Date().toISOString(),
        result: { ok: true },
      },
    });
    expect(broker.pendingCount()).toBe(1);

    broker.admitResult({
      connectionEpoch: 'epoch-1',
      deviceId: 'device-a',
      frame: {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'permission-denied',
        completedAt: new Date().toISOString(),
        errorCode: 'local-policy-denied',
      },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: 'permission-denied',
      retryable: false,
    });
    await cleanup();
  });

  it('fails pending work on disconnect without resending, and cancels on abort and shutdown', async () => {
    const { broker, cleanup } = await createBroker();
    const sent: Array<ClientToolRequestFrame | ClientToolCancelFrame> = [];
    broker.attach({
      deviceId: 'device-a',
      connectionEpoch: 'epoch-1',
      clientType: 'mobile',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      send: (frame) => {
        sent.push(frame);
      },
    });

    const first = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        arguments: healthArgs(),
        deadlineMs: 5_000,
        display: DISPLAY,
      },
      new AbortController().signal,
    );
    broker.detach('epoch-1');
    await expect(first).resolves.toMatchObject({
      ok: false,
      reason: 'client-device-disconnected',
      retryable: true,
    });
    expect(sent.filter((frame) => frame.type === 'client-tool/request')).toHaveLength(1);

    broker.attach({
      deviceId: 'device-a',
      connectionEpoch: 'epoch-2',
      clientType: 'mobile',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      send: (frame) => {
        sent.push(frame);
      },
    });
    expect(sent.filter((frame) => frame.type === 'client-tool/request')).toHaveLength(1);

    const abort = new AbortController();
    const aborted = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-2',
        toolCallId: 'tool-2',
        arguments: healthArgs(),
        deadlineMs: 5_000,
        display: DISPLAY,
      },
      abort.signal,
    );
    abort.abort();
    await expect(aborted).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    expect(sent.some((frame) => frame.type === 'client-tool/cancel' && frame.reason === 'run-aborted')).toBe(
      true,
    );

    const shuttingDown = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-3',
        toolCallId: 'tool-3',
        arguments: healthArgs(),
        deadlineMs: 5_000,
        display: DISPLAY,
      },
      new AbortController().signal,
    );
    broker.dispose();
    await expect(shuttingDown).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    expect(
      sent.some((frame) => frame.type === 'client-tool/cancel' && frame.reason === 'host-shutdown'),
    ).toBe(true);
    await cleanup();
  });

  it('enforces host-wide and per-device pending caps', async () => {
    const { broker, cleanup } = await createBroker();
    for (let index = 0; index < 32; index += 1) {
      const deviceId = `device-${index}`;
      broker.attach({
        deviceId,
        connectionEpoch: `epoch-${index}`,
        clientType: 'mobile',
        capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
        send: () => undefined,
      });
    }
    const inflight: Array<Promise<unknown>> = [];
    for (let index = 0; index < 32; index += 1) {
      inflight.push(
        broker.execute(
          {
            capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
            sessionId: 'session-1',
            runId: `run-${index}`,
            toolCallId: `tool-${index}`,
            arguments: healthArgs(),
            deadlineMs: 5_000,
            preferredDeviceId: `device-${index}`,
            display: DISPLAY,
          },
          new AbortController().signal,
        ),
      );
    }
    await expect(
      broker.execute(
        {
          capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
          sessionId: 'session-1',
          runId: 'run-overflow',
          toolCallId: 'tool-overflow',
          arguments: healthArgs(),
          deadlineMs: 5_000,
          preferredDeviceId: 'device-0',
          display: DISPLAY,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'client-device-unavailable' });

    broker.detach('epoch-0');
    await inflight[0];
    const secondOnSameDevice = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-again',
        toolCallId: 'tool-again',
        arguments: healthArgs(),
        deadlineMs: 5_000,
        preferredDeviceId: 'device-1',
        display: DISPLAY,
      },
      new AbortController().signal,
    );
    await expect(secondOnSameDevice).resolves.toMatchObject({
      ok: false,
      reason: 'client-device-unavailable',
    });
    broker.dispose();
    await Promise.all(inflight.slice(1));
    await cleanup();
  });

  it('refuses to target an unknown capability and times out without leaking pending work', async () => {
    const { broker, cleanup } = await createBroker();
    broker.attach({
      deviceId: 'device-a',
      connectionEpoch: 'epoch-1',
      clientType: 'mobile',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      send: () => undefined,
    });
    await expect(
      broker.execute(
        {
          capabilityId: 'camera.capture.v1',
          sessionId: 'session-1',
          runId: 'run-1',
          toolCallId: 'tool-1',
          arguments: {},
          deadlineMs: 1_000,
          display: DISPLAY,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'client-device-unavailable' });

    const timed = broker.execute(
      {
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-timeout',
        toolCallId: 'tool-timeout',
        arguments: healthArgs(),
        deadlineMs: 20,
        display: DISPLAY,
      },
      new AbortController().signal,
    );
    await expect(timed).resolves.toMatchObject({
      ok: false,
      reason: 'client-tool-timeout',
      retryable: true,
    });
    expect(broker.pendingCount()).toBe(0);
    await cleanup();
  });
});

describe('DeviceCapabilityStore', () => {
  it('round-trips advertisements atomically and treats missing files as empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-cap-store-'));
    const path = join(directory, 'capabilities.json');
    const store = new DeviceCapabilityStore(path);
    const empty = await store.load();
    expect(empty.devices).toEqual({});

    await store.save({
      version: 1,
      devices: {
        'device-a': {
          clientType: 'mobile',
          clientVersion: '1.0.0',
          lastAdvertisedAt: '2026-08-23T12:00:00.000Z',
          capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
        },
      },
      primaryByCapability: {
        [APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID]: 'device-a',
      },
    });
    const loaded = await store.load();
    expect(loaded.devices['device-a']?.capabilities[0]?.id).toBe(
      APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
    );

    const broken = new DeviceCapabilityStore(path);
    await rm(path);
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(path, '{not-json', { encoding: 'utf8', mode: 0o600 }),
    );
    await expect(broken.load()).rejects.toThrow(/capabilities store/i);
    await rm(directory, { recursive: true, force: true });
  });

  it('removes a revoked device from persisted capability facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-cap-rev-'));
    const store = new DeviceCapabilityStore(join(directory, 'capabilities.json'));
    const registry = new DeviceCapabilityRegistry({ store });
    await registry.load();
    await registry.recordAdvertisement({
      deviceId: 'device-a',
      clientType: 'mobile',
      clientVersion: 'test',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
    });
    expect(registry.isKnownCapable('device-a', APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID)).toBe(true);
    await registry.removeDevice('device-a');
    expect(registry.isKnownCapable('device-a', APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID)).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });
});
