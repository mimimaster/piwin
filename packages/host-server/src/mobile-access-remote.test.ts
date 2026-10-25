import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MobileAccessPairingCodeData, MobileAccessStatusData } from '@piwin/contracts';
import {
  createRelaySecureWebSocketFactory,
  decodeBase64Url,
  generateNoiseKeyPair,
  parsePairingLinkV3,
  WebSocketHostTransport,
  type RelayInnerSocket,
} from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMobileAccessController } from './mobile-access-controller.js';
import { FakeRuntime, hello } from './remote-access-harness.fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('phone-access controller with ADR 0101 remote access', () => {
  it('mints v3 links and admits a channel shell on the phone listener', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-sidecar-remote-'));
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
    const controller = await createMobileAccessController({
      runtime: new FakeRuntime(),
      instanceId: 'sidecar',
      piwinRoot: root,
      bindPort: 0,
    });
    cleanups.push(() => controller.dispose());

    const started = await controller.handle({ type: 'mobile-access/start', profileId: 'loopback' });
    if (!started.success) throw new Error(started.error);
    const status = started.data as MobileAccessStatusData;
    const code = await controller.handle({ type: 'mobile-access/create-pairing-code' });
    if (!code.success) throw new Error(code.error);
    const link = parsePairingLinkV3((code.data as MobileAccessPairingCodeData).channelUri ?? '');
    if (link === undefined || link.directUrl === undefined) throw new Error('no v3 link');
    expect(link.directUrl).toBe(status.bindUrl);

    const transport = new WebSocketHostTransport({
      endpoint: `${link.directUrl}/v1/u/${link.userId}/connect?hostId=${link.hostId}`,
      autoReconnect: false,
      createHello: () => hello({ pairingToken: link.pairingToken }),
      webSocketFactory: createRelaySecureWebSocketFactory({
        userId: link.userId,
        hostId: link.hostId,
        hostKey: decodeBase64Url(link.hostKey) ?? new Uint8Array(),
        clientStaticKeyPair: generateNoiseKeyPair(),
        createInnerSocket: (url) => new WebSocket(url) as unknown as RelayInnerSocket,
      }),
    });
    const hostHello = await transport.connect();
    expect(hostHello.deviceSecret).toBeDefined();
    await transport.close();

    const devices = await controller.handle({ type: 'mobile-access/list-devices' });
    expect(devices).toMatchObject({ success: true, data: { devices: [{ secureChannel: true }] } });
  });
});

describe('phone-access controller remote-access commands', () => {
  it('reports remote status, applies operator commands and mints operator codes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-sidecar-remote-ops-'));
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
    const controller = await createMobileAccessController({
      runtime: new FakeRuntime(),
      instanceId: 'sidecar',
      piwinRoot: root,
      bindPort: 0,
    });
    cleanups.push(() => controller.dispose());
    await controller.handle({ type: 'mobile-access/start', profileId: 'loopback' });

    const status = await controller.handle({ type: 'mobile-access/status' });
    expect(status).toMatchObject({ success: true, data: { remote: { legacyAccess: 'full' } } });

    const configured = await controller.handleRemoteAccess({
      type: 'host/remote-access-configure',
      legacyAccess: 'migrate-only',
    });
    expect(configured).toMatchObject({ success: true, data: { legacyAccess: 'migrate-only' } });
    expect(
      await controller.handleRemoteAccess({ type: 'host/relay-user-enrollment-line' }),
    ).toMatchObject({ success: true, data: { line: expect.stringMatching(/^piwin-user:v1:/) } });

    const code = await controller.handle({
      type: 'mobile-access/create-pairing-code',
      role: 'operator',
    });
    if (!code.success) throw new Error(code.error);
    expect(
      parsePairingLinkV3((code.data as MobileAccessPairingCodeData).channelUri ?? '')?.role,
    ).toBe('operator');
  });
});
