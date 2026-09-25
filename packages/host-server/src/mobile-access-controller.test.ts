import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HostCommand,
  HostResponse,
  MobileAccessEndpointCandidate,
  PushSink,
} from '@piwin/contracts';
import { readMobileAccessPairingCodeData, readMobileAccessStatusData } from '@piwin/contracts';
import { HostDevicePairing } from './device-pairing.js';
import { HostServer, type HostRuntimePort } from './host-server.js';
import { MobileAccessController, createMobileAccessController } from './mobile-access-controller.js';
import { MobileAccessSettingsFileStore } from './mobile-access-settings-store.js';

class FakeRuntime implements HostRuntimePort {
  public commands: HostCommand[] = [];

  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    this.commands.push(command);
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: { ok: true },
    };
  }

  public attachPushSink(_sink: PushSink): () => void {
    return () => undefined;
  }
  public attachBrowserFrameSink(_sink: unknown): () => void {
    return () => undefined;
  }
}

function createController(runtime = new FakeRuntime()) {
  const pairing = new HostDevicePairing();
  const controller = new MobileAccessController({
    runtime,
    pairing,
    instanceId: 'sidecar-mobile-access',
    bindHost: '127.0.0.1',
    bindPort: 0,
  });
  return { runtime, pairing, controller };
}

describe('MobileAccessController', () => {
  it('starts, mints pairing codes, and keeps hostInstanceId across stop/start', async () => {
    const { controller, runtime } = createController();
    try {
      const started = await controller.handle({
        type: 'mobile-access/start',
        profileId: 'loopback',
        advertisedEndpoint: 'ws://127.0.0.1:9',
      });
      expect(started.success).toBe(true);
      if (!started.success) {
        throw new Error(started.error);
      }
      const startedData = started.data as { hostInstanceId?: string; listening?: boolean };
      expect(startedData.listening).toBe(true);
      const instanceId = startedData.hostInstanceId;
      expect(instanceId).toBe('sidecar-mobile-access');

      const first = await controller.handle({ type: 'mobile-access/create-pairing-code' });
      expect(first.success).toBe(true);
      if (!first.success) {
        throw new Error(first.error);
      }
      const firstCode = first.data as { pairingToken: string; uri: string };
      expect(firstCode.uri.startsWith('piwin://pair?')).toBe(true);

      const second = await controller.handle({ type: 'mobile-access/create-pairing-code' });
      expect(second.success).toBe(true);
      if (!second.success) {
        throw new Error(second.error);
      }
      const secondCode = second.data as { pairingToken: string };
      expect(secondCode.pairingToken).not.toBe(firstCode.pairingToken);

      await controller.handle({ type: 'mobile-access/stop' });
      const restarted = await controller.handle({
        type: 'mobile-access/start',
        profileId: 'loopback',
      });
      expect(restarted.success).toBe(true);
      if (!restarted.success) {
        throw new Error(restarted.error);
      }
      const restartedId = (restarted.data as { hostInstanceId?: string }).hostInstanceId;
      expect(restartedId).toBe(instanceId);
      expect(runtime.commands).toEqual([]);
    } finally {
      await controller.dispose();
    }
  });

  it('lists and revokes devices without projecting secret hashes', async () => {
    const { controller, pairing } = createController();
    try {
      const completion = pairing.completePairing(pairing.mintToken().token, 'iPhone');
      const listed = await controller.handle({ type: 'mobile-access/list-devices' });
      expect(listed.success).toBe(true);
      if (!listed.success) {
        throw new Error(listed.error);
      }
      expect(JSON.stringify(listed.data)).not.toContain(completion.credential.deviceSecret);
      expect(JSON.stringify(listed.data)).not.toContain('secretHash');
      expect(listed.data).toMatchObject({
        devices: [{ id: completion.device.id, name: 'iPhone', revoked: false }],
      });

      const revoked = await controller.handle({
        type: 'mobile-access/revoke-device',
        deviceId: completion.device.id,
      });
      expect(revoked).toMatchObject({ success: true, data: { revoked: true } });
      expect(pairing.authenticate(completion.credential)).toBeUndefined();
    } finally {
      await controller.dispose();
    }
  });

  it('rejects unsupported profiles and pairing codes while stopped', async () => {
    const { controller } = createController();
    const unsupported = await controller.handle({
      type: 'mobile-access/start',
      profileId: 'bluetooth',
    });
    expect(unsupported.success).toBe(false);
    if (unsupported.success) {
      throw new Error('expected unsupported profile to fail');
    }
    expect(unsupported.error).toMatch(/Unsupported phone-access profile/);

    const pairing = await controller.handle({ type: 'mobile-access/create-pairing-code' });
    expect(pairing.success).toBe(false);
  });
});

function lanCandidates(port: number): MobileAccessEndpointCandidate[] {
  return [
    { url: `ws://192.168.1.5:${port}`, kind: 'lan', interfaceName: 'en0' },
    { url: `ws://100.101.102.103:${port}`, kind: 'tailscale', interfaceName: 'utun4' },
  ];
}

async function occupyPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address');
  }
  return { server, port: address.port };
}

describe('MobileAccessController LAN profile', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  async function tempSettingsStore(): Promise<{ store: MobileAccessSettingsFileStore; path: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mobile-access-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'mobile-access.json');
    return { store: new MobileAccessSettingsFileStore(path), path };
  }

  it('binds all interfaces and puts the best LAN address in the QR', async () => {
    const controller = new MobileAccessController({
      runtime: new FakeRuntime(),
      pairing: new HostDevicePairing(),
      instanceId: 'lan-1',
      bindPort: 0,
      listEndpointCandidates: lanCandidates,
    });
    cleanups.push(() => controller.dispose());

    const started = await controller.handle({ type: 'mobile-access/start', profileId: 'lan' });
    const status = readMobileAccessStatusData(started.success ? started.data : undefined);
    expect(status).toMatchObject({
      listening: true,
      enabled: true,
      bindHost: '0.0.0.0',
      advertisedEndpointSource: 'auto',
    });
    const port = status?.bindPort ?? -1;
    expect(status?.advertisedEndpoint).toBe(`ws://192.168.1.5:${port}`);
    expect(status?.endpointCandidates).toHaveLength(2);

    const minted = await controller.handle({ type: 'mobile-access/create-pairing-code' });
    const code = readMobileAccessPairingCodeData(minted.success ? minted.data : undefined);
    expect(code?.endpoint).toBe(`ws://192.168.1.5:${port}`);

    const custom = await controller.handle({
      type: 'mobile-access/start',
      profileId: 'lan',
      advertisedEndpoint: `ws://100.101.102.103:${port}`,
    });
    expect(custom).toMatchObject({
      success: true,
      data: { advertisedEndpoint: `ws://100.101.102.103:${port}`, advertisedEndpointSource: 'custom', bindPort: port },
    });

    // Stop + start without an address keeps the custom one; blank returns to auto.
    await controller.handle({ type: 'mobile-access/stop' });
    const reopened = await controller.handle({ type: 'mobile-access/start', profileId: 'lan' });
    const reopenedStatus = readMobileAccessStatusData(reopened.success ? reopened.data : undefined);
    expect(reopenedStatus?.advertisedEndpointSource).toBe('custom');
    const auto = await controller.handle({
      type: 'mobile-access/start',
      profileId: 'lan',
      advertisedEndpoint: '',
    });
    const autoStatus = readMobileAccessStatusData(auto.success ? auto.data : undefined);
    expect(autoStatus?.advertisedEndpointSource).toBe('auto');
    expect(autoStatus?.advertisedEndpoint).toBe(`ws://192.168.1.5:${autoStatus?.bindPort ?? -1}`);

    const wildcard = await controller.handle({
      type: 'mobile-access/start',
      profileId: 'lan',
      advertisedEndpoint: 'ws://0.0.0.0:8787',
    });
    expect(wildcard).toMatchObject({ success: false, error: expect.stringContaining('wildcard') });
    const http = await controller.handle({
      type: 'mobile-access/start',
      profileId: 'lan',
      advertisedEndpoint: 'http://192.168.1.5:8787',
    });
    expect(http).toMatchObject({ success: false, error: expect.stringContaining('ws://') });
  });

  it('moves to the next port when the preferred one is taken', async () => {
    const occupied = await occupyPort();
    cleanups.push(
      () => new Promise<void>((resolve) => occupied.server.close(() => resolve())),
    );
    const controller = new MobileAccessController({
      runtime: new FakeRuntime(),
      pairing: new HostDevicePairing(),
      instanceId: 'lan-busy',
      bindPort: occupied.port,
      listEndpointCandidates: lanCandidates,
    });
    cleanups.push(() => controller.dispose());

    const started = await controller.handle({ type: 'mobile-access/start', profileId: 'lan' });
    expect(started.success).toBe(true);
    const port = readMobileAccessStatusData(started.success ? started.data : undefined)?.bindPort;
    expect(port).toBeGreaterThan(occupied.port);
    expect(port).toBeLessThanOrEqual(occupied.port + 10);
  });

  it('persists the choice and resumes listening on the saved port', async () => {
    const { store, path } = await tempSettingsStore();
    const first = new MobileAccessController({
      runtime: new FakeRuntime(),
      pairing: new HostDevicePairing(),
      settingsStore: store,
      settings: await store.load(),
      instanceId: 'lan-persist',
      listEndpointCandidates: lanCandidates,
    });
    cleanups.push(() => first.dispose());
    await first.resume();
    const firstStatus = await first.handle({ type: 'mobile-access/status' });
    const firstPort = readMobileAccessStatusData(firstStatus.success ? firstStatus.data : undefined)
      ?.bindPort;
    expect(firstPort).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ enabled: true, port: firstPort });

    // App quit keeps the preference; the next launch reopens the same port.
    await first.dispose();
    const second = new MobileAccessController({
      runtime: new FakeRuntime(),
      pairing: new HostDevicePairing(),
      settingsStore: store,
      settings: await store.load(),
      instanceId: 'lan-persist',
      listEndpointCandidates: lanCandidates,
    });
    cleanups.push(() => second.dispose());
    await second.resume();
    const resumed = await second.handle({ type: 'mobile-access/status' });
    expect(resumed).toMatchObject({ success: true, data: { listening: true, bindPort: firstPort } });

    // Turning it off is remembered; resume then stays closed.
    await second.handle({ type: 'mobile-access/stop' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ enabled: false, port: firstPort });
    const third = new MobileAccessController({
      runtime: new FakeRuntime(),
      pairing: new HostDevicePairing(),
      settingsStore: store,
      settings: await store.load(),
      instanceId: 'lan-persist',
    });
    await third.resume();
    expect(await third.handle({ type: 'mobile-access/status' })).toMatchObject({
      data: { listening: false, enabled: false },
    });
  });

  it('reports a failed resume through onError and lastError', async () => {
    const onError = vi.fn();
    const controller = new MobileAccessController({
      runtime: new FakeRuntime(),
      pairing: new HostDevicePairing(),
      settings: { enabled: true, advertisedEndpoint: 'ws://0.0.0.0:1' },
      instanceId: 'lan-fail',
      onError,
    });
    await controller.resume();
    expect(onError).toHaveBeenCalledOnce();
    expect(await controller.handle({ type: 'mobile-access/status' })).toMatchObject({
      data: { listening: false, enabled: true, lastError: expect.stringContaining('wildcard') },
    });
  });

  it('defaults to on for a fresh install and survives a damaged settings file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mobile-access-root-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const fresh = await createMobileAccessController({
      runtime: new FakeRuntime(),
      instanceId: 'fresh',
      piwinRoot: dir,
      bindPort: 0,
    });
    expect(await fresh.handle({ type: 'mobile-access/status' })).toMatchObject({
      data: { enabled: true, listening: false },
    });

    await mkdir(join(dir, 'devices'), { recursive: true });
    await writeFile(join(dir, 'devices', 'mobile-access.json'), '{not json', 'utf8');
    const onError = vi.fn();
    const damaged = await createMobileAccessController({
      runtime: new FakeRuntime(),
      instanceId: 'damaged',
      piwinRoot: dir,
      bindPort: 0,
      onError,
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(await damaged.handle({ type: 'mobile-access/status' })).toMatchObject({
      data: { enabled: false },
    });
  });
});

describe('HostServer remote allowlist', () => {
  it('rejects phone-access listen commands on the Host WebSocket', async () => {
    const server = new HostServer({
      runtime: new FakeRuntime(),
      port: 0,
      instanceId: 'host-deny-mobile-access',
    });
    const address = await server.start();
    const { WebSocket } = await import('ws');
    const { decodeHostWireMessage, encodeHostWireMessage } = await import('@piwin/host-transport');
    const socket = new WebSocket(address.url);
    const messages: unknown[] = [];
    socket.on('message', (data) => {
      messages.push(decodeHostWireMessage(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', (error) => reject(error));
    });
    socket.send(
      encodeHostWireMessage({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId: 'remote-deny-mobile-access',
        lastSeq: 0,
      }),
    );
    await waitFor(() => messages.some(isHello));

    socket.send(
      encodeHostWireMessage({
        type: 'command',
        requestId: 'mobile-access-denied',
        command: { type: 'mobile-access/start', profileId: 'loopback' } as unknown as HostCommand,
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            isError(message) && message.requestId === 'mobile-access-denied' && message.code === 'command-not-allowed',
        ),
    );

    socket.close();
    await server.stop();
  });
});

function isHello(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'host/hello';
}

function isError(value: unknown): value is { type: 'error'; requestId?: string; code?: string } {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'error';
}

async function waitFor(predicate: (messages?: unknown) => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for Host message');
}
