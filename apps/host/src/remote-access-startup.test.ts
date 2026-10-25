import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HostDevicePairing,
  openHostRemoteAccessAtRoot,
  type HostRemoteAccess,
} from '@piwin/host-server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyRemoteAccessEnvironment,
  createOperatorPairingAnnouncement,
} from './remote-access-startup.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function open(): Promise<{ access: HostRemoteAccess; pairing: HostDevicePairing }> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-host-remote-'));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const pairing = new HostDevicePairing();
  const access = await openHostRemoteAccessAtRoot({
    piwinRoot: root,
    pairing,
    hostName: 'Server',
    defaultUserName: 'owner',
  });
  cleanups.push(async () => access.dispose());
  access.setDirectUrlProvider(() => 'ws://192.168.1.20:8787');
  return { access, pairing };
}

describe('applyRemoteAccessEnvironment', () => {
  it('turns the relay on with the enroll token and sets the legacy mode', async () => {
    const { access } = await open();
    const lines = await applyRemoteAccessEnvironment(access, {
      PIWIN_HOST_RELAY_URL: 'wss://relay.example.com',
      PIWIN_RELAY_ENROLL_TOKEN: 'enroll-token-0123456789',
      PIWIN_HOST_LEGACY_ACCESS: 'migrate-only',
    });
    access.stop();
    expect(access.status()).toMatchObject({
      relay: { enabled: true, url: 'wss://relay.example.com' },
      legacyAccess: 'migrate-only',
      user: { name: 'owner' },
    });
    expect(lines.join('\n')).toContain('relay: wss://relay.example.com');
    expect(lines.join('\n')).not.toContain('enroll-token');
  });

  it('leaves settings alone when nothing is set', async () => {
    const { access } = await open();
    await applyRemoteAccessEnvironment(access, {});
    expect(access.status()).toMatchObject({ relay: { enabled: false }, legacyAccess: 'full' });
  });

  it('fails on an invalid relay URL or legacy mode', async () => {
    const { access } = await open();
    await expect(
      applyRemoteAccessEnvironment(access, { PIWIN_HOST_RELAY_URL: 'ws://relay.example.com' }),
    ).rejects.toThrow('wss://');
    await expect(
      applyRemoteAccessEnvironment(access, { PIWIN_HOST_LEGACY_ACCESS: 'sometimes' }),
    ).rejects.toThrow('PIWIN_HOST_LEGACY_ACCESS');
  });
});

describe('createOperatorPairingAnnouncement', () => {
  it('mints an operator code with a v3 link while no operator exists', async () => {
    const { access, pairing } = await open();
    const text = await createOperatorPairingAnnouncement({ pairing, store: undefined, access });
    expect(text).toContain('piwin://pair?v=3');
    expect(text).toContain('role=operator');
    expect(pairing.exportState().pending.map((entry) => entry.role)).toEqual(['operator']);
  });

  it('stays quiet once an operator device exists', async () => {
    const { access, pairing } = await open();
    pairing.completePairing(pairing.mintToken('operator').token, 'Laptop');
    expect(
      await createOperatorPairingAnnouncement({ pairing, store: undefined, access }),
    ).toBeUndefined();
  });
});
