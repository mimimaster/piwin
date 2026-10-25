import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRemoteId } from '@piwin/contracts';
import { parseRelayEnrollmentLine } from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { HostIdentityStore } from './host-identity-store.js';
import { RelayUserStore, RelayUserStoreError } from './relay-user-store.js';
import {
  defaultRemoteAccessSettings,
  normalizeRelayUrl,
  RemoteAccessSettingsStore,
} from './remote-access-settings-store.js';

const directories: string[] = [];
async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-remote-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const FAST = { N: 2 ** 14, r: 8, p: 1 };

describe('HostIdentityStore', () => {
  it('creates once, owner-only, and returns the same identity afterwards', async () => {
    const path = join(await tempDir(), 'host-identity.json');
    const first = await new HostIdentityStore(path).loadOrCreate();
    const again = await new HostIdentityStore(path).loadOrCreate();
    expect(isRemoteId(first.hostId)).toBe(true);
    expect(again.hostId).toBe(first.hostId);
    expect(again.hostKey).toBe(first.hostKey);
    expect(again.staticKeyPair.publicKey).toEqual(first.staticKeyPair.publicKey);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('refuses a damaged file instead of minting a new identity', async () => {
    const path = join(await tempDir(), 'host-identity.json');
    await writeFile(path, JSON.stringify({ version: 1, signingSecretKey: 'short' }));
    await expect(new HostIdentityStore(path).loadOrCreate()).rejects.toThrow('damaged');
  });
});

describe('RelayUserStore', () => {
  it('creates, renames and produces an enrollment line the relay accepts', async () => {
    const store = new RelayUserStore(join(await tempDir(), 'relay-user.json'));
    expect(await store.load()).toBeUndefined();
    const user = await store.create(' Yorick ');
    expect(user.name).toBe('Yorick');
    await expect(store.create('again')).rejects.toBeInstanceOf(RelayUserStoreError);
    const renamed = await store.rename('Yorick J');
    expect(renamed.userId).toBe(user.userId);
    expect(parseRelayEnrollmentLine(await store.enrollmentLine())).toMatchObject({
      userId: user.userId,
      name: 'Yorick J',
    });
  });

  it('moves a user to another Host through a passphrase bundle', async () => {
    const directory = await tempDir();
    const source = new RelayUserStore(join(directory, 'a.json'));
    const target = new RelayUserStore(join(directory, 'b.json'));
    const user = await source.create('Yorick');
    await target.create('Someone else');
    const bundle = await source.exportBundle('correct horse', FAST);
    const imported = await target.importBundle(bundle, 'correct horse');
    expect(imported.userId).toBe(user.userId);
    expect((await target.load())?.userId).toBe(user.userId);
    await expect(target.importBundle(bundle, 'wrong')).rejects.toMatchObject({
      reason: 'wrong-passphrase',
    });
  });

  it('needs a user before rename, export or enrollment line', async () => {
    const store = new RelayUserStore(join(await tempDir(), 'relay-user.json'));
    await expect(store.rename('x')).rejects.toBeInstanceOf(RelayUserStoreError);
    await expect(store.enrollmentLine()).rejects.toBeInstanceOf(RelayUserStoreError);
    await expect(store.create('   ')).rejects.toBeInstanceOf(RelayUserStoreError);
  });
});

describe('RemoteAccessSettingsStore', () => {
  it('defaults to relay off, direct on, legacy full', async () => {
    const store = new RemoteAccessSettingsStore(join(await tempDir(), 'remote-access.json'));
    expect(await store.load()).toEqual(defaultRemoteAccessSettings());
  });

  it('migrates enabled, port and address override from mobile-access.json', async () => {
    const directory = await tempDir();
    const legacy = join(directory, 'mobile-access.json');
    await writeFile(
      legacy,
      JSON.stringify({
        version: 1,
        enabled: false,
        port: 8791,
        advertisedEndpoint: 'ws://192.168.1.5:8791',
      }),
    );
    const store = new RemoteAccessSettingsStore(join(directory, 'remote-access.json'), {
      legacyMobileAccessPath: legacy,
    });
    expect(await store.load()).toEqual({
      relay: { enabled: false },
      direct: { enabled: false, port: 8791, advertisedUrl: 'ws://192.168.1.5:8791' },
      legacyAccess: 'full',
    });
  });

  it('round-trips settings and keeps the relay off without a URL', async () => {
    const store = new RemoteAccessSettingsStore(join(await tempDir(), 'remote-access.json'));
    await store.save({
      relay: {
        enabled: true,
        url: 'wss://relay.example.com/',
        enrollToken: 'token-0123456789abcdef',
      },
      direct: { enabled: true, port: 8790 },
      legacyAccess: 'migrate-only',
    });
    expect(await store.load()).toEqual({
      relay: {
        enabled: true,
        url: 'wss://relay.example.com',
        enrollToken: 'token-0123456789abcdef',
      },
      direct: { enabled: true, port: 8790 },
      legacyAccess: 'migrate-only',
    });
    await store.save({ relay: { enabled: true }, direct: { enabled: true }, legacyAccess: 'off' });
    expect((await store.load()).relay).toEqual({ enabled: false });
  });

  it('accepts wss:// and localhost ws:// relays only, without a path', () => {
    expect(normalizeRelayUrl(' wss://relay.example.com/ ')).toBe('wss://relay.example.com');
    expect(normalizeRelayUrl('ws://127.0.0.1:7466')).toBe('ws://127.0.0.1:7466');
    for (const bad of [
      'ws://relay.example.com',
      'https://relay.example.com',
      'wss://r.example/x',
      'nope',
    ]) {
      expect(() => normalizeRelayUrl(bad)).toThrow();
    }
  });
});
