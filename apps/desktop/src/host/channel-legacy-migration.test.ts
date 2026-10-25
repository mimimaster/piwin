// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostBookEntry } from '@piwin/contracts';
import { isMigratableLegacyTarget, migrateSavedLegacyTarget } from './channel-legacy-migration';
import { loadDesktopRemoteHostTarget, saveDesktopRemoteHostTarget } from './remote-host-session';

const fakes = vi.hoisted(() => ({
  migrate: vi.fn(),
  credential: undefined as { deviceId: string; deviceSecret: string } | undefined,
  forget: vi.fn(async () => undefined),
  prime: vi.fn(async () => true),
}));

vi.mock('@piwin/host-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@piwin/host-client')>()),
  migrateLegacyHost: fakes.migrate,
}));
vi.mock('../devices/device-admission.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../devices/device-admission.js')>()),
  peekDeviceCredential: () => fakes.credential,
  forgetDeviceCredential: fakes.forget,
}));
vi.mock('./channel-host-book.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./channel-host-book.js')>()),
  channelVault: () => ({}),
  primeChannelHost: fakes.prime,
}));

const ENTRY: HostBookEntry = {
  userId: 'AbCdEfGhIjKlMnOpQrSt_-',
  userName: 'Yorick',
  hostId: 'ZyXwVuTsRqPoNmLkJiHg-_',
  hostName: 'MacBook',
  hostKey: 'key',
  relayUrl: 'wss://relay.example.com',
  role: 'member',
  pairedAt: 'now',
};

describe('isMigratableLegacyTarget', () => {
  it('takes remote legacy targets with a credential or token only', () => {
    expect(isMigratableLegacyTarget({ endpoint: 'ws://10.0.0.2:8790' }, true)).toBe(true);
    expect(
      isMigratableLegacyTarget({ endpoint: 'ws://10.0.0.2:8790', authToken: 't' }, false),
    ).toBe(true);
    expect(isMigratableLegacyTarget({ endpoint: 'ws://10.0.0.2:8790' }, false)).toBe(false);
    expect(
      isMigratableLegacyTarget({ endpoint: 'ws://127.0.0.1:8787', authToken: 't' }, true),
    ).toBe(false);
    expect(
      isMigratableLegacyTarget({ endpoint: 'wss://relay.example.com', hostId: ENTRY.hostId }, true),
    ).toBe(false);
    expect(isMigratableLegacyTarget(undefined, true)).toBe(false);
  });
});

describe('migrateSavedLegacyTarget', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    fakes.credential = undefined;
  });

  it('switches the saved target to the host id and drops the old credential', async () => {
    fakes.credential = { deviceId: 'd', deviceSecret: 's' };
    fakes.migrate.mockResolvedValue({ status: 'migrated', entry: ENTRY });
    saveDesktopRemoteHostTarget({ endpoint: 'ws://10.0.0.2:8790' });
    const outcome = await migrateSavedLegacyTarget();
    expect(outcome?.status).toBe('migrated');
    expect(fakes.migrate).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          endpoint: 'ws://10.0.0.2:8790',
          credential: fakes.credential,
        }),
      }),
    );
    expect(fakes.prime).toHaveBeenCalledWith(ENTRY.hostId);
    expect(loadDesktopRemoteHostTarget()).toEqual({
      endpoint: 'wss://relay.example.com',
      hostId: ENTRY.hostId,
    });
    expect(fakes.forget).toHaveBeenCalledWith('ws://10.0.0.2:8790');
  });

  it('keeps the legacy target when the Host is older or the migration fails', async () => {
    saveDesktopRemoteHostTarget({ endpoint: 'ws://10.0.0.2:8790', authToken: 'token' });
    fakes.migrate.mockResolvedValueOnce({ status: 'unsupported' });
    expect((await migrateSavedLegacyTarget())?.status).toBe('unsupported');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakes.migrate.mockResolvedValueOnce({ status: 'failed', error: new Error('down') });
    expect((await migrateSavedLegacyTarget())?.status).toBe('failed');
    warn.mockRestore();
    expect(loadDesktopRemoteHostTarget()).toEqual({
      endpoint: 'ws://10.0.0.2:8790',
      authToken: 'token',
    });
    expect(fakes.forget).not.toHaveBeenCalled();
  });

  it('does nothing for a target already on the channel', async () => {
    saveDesktopRemoteHostTarget({ endpoint: 'wss://relay.example.com', hostId: ENTRY.hostId });
    expect(await migrateSavedLegacyTarget()).toBeUndefined();
    expect(fakes.migrate).not.toHaveBeenCalled();
  });
});
