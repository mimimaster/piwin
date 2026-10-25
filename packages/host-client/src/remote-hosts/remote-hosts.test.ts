import type { HostBookEntry, HostHello } from '@piwin/contracts';
import {
  encodeBase64Url,
  encodePairingLinkV3,
  generateNoiseKeyPair,
  HostHandshakeError,
} from '@piwin/host-transport';
import { describe, expect, it, vi } from 'vitest';
import { groupHostBookByUser, HostBook } from './host-book.js';
import { HostDialPlan } from './host-dial-plan.js';
import { createMemoryKeyValueStorage, createNativeSecretStorage } from './key-value-storage.js';
import { migrateLegacyHost, type LegacyHostConnection } from './legacy-host-migrator.js';
import { classifyPairingInput, dialFirstReachable } from './pair-remote-host.js';
import { RemoteHostVault } from './remote-host-vault.js';

const USER = 'AbCdEfGhIjKlMnOpQrSt_-';
const HOST = 'ZyXwVuTsRqPoNmLkJiHg-_';
const HOST_KEY = encodeBase64Url(new Uint8Array(32).fill(7));

function entry(overrides: Partial<HostBookEntry> = {}): HostBookEntry {
  return {
    userId: USER,
    userName: 'Yorick',
    hostId: HOST,
    hostName: 'MacBook',
    hostKey: HOST_KEY,
    relayUrl: 'wss://relay.example.com',
    directUrl: 'ws://192.168.1.20:8790',
    role: 'member',
    pairedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('HostBook', () => {
  it('upserts, lists, aliases and removes entries', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    await book.upsert(entry());
    await book.upsert(entry({ hostName: 'Renamed' }));
    expect(await book.list()).toHaveLength(1);
    await book.setAlias(HOST, 'mac');
    expect((await book.findByAlias('MAC'))?.hostName).toBe('Renamed');
    expect(await book.remove(HOST)).toBe(true);
    expect(await book.list()).toEqual([]);
  });

  it('rejects invalid entries and entries without an address', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    await expect(book.upsert(entry({ hostKey: 'short' }))).rejects.toThrow();
    await expect(
      book.upsert({
        ...entry(),
        relayUrl: 'ws://relay.example.com',
        directUrl: undefined,
      } as never),
    ).rejects.toThrow();
  });

  it('applies endpoints but never takes a key or another Host from the wire', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    await book.upsert(entry());
    const updated = await book.applyEndpoints(HOST, {
      userId: 'BBBBBBBBBBBBBBBBBBBBBB',
      userName: 'New owner',
      hostId: HOST,
      hostName: 'MacBook Pro',
      relayUrl: 'wss://relay2.example.com',
    });
    expect(updated).toMatchObject({
      userId: 'BBBBBBBBBBBBBBBBBBBBBB',
      relayUrl: 'wss://relay2.example.com',
      hostKey: HOST_KEY,
    });
    expect(updated).not.toHaveProperty('directUrl');
    if (updated === undefined) throw new Error('entry was not updated');
    expect(
      await book.applyEndpoints(HOST, { ...updated, hostId: 'CCCCCCCCCCCCCCCCCCCCCC' }),
    ).toBeUndefined();
  });

  it('keeps the old entry when an update would leave no usable address', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    await book.upsert(entry());
    const kept = await book.applyEndpoints(HOST, {
      userId: USER,
      userName: 'Yorick',
      hostId: HOST,
      hostName: 'MacBook',
      relayUrl: 'ws://public.example.com',
    });
    expect(kept?.relayUrl).toBe('wss://relay.example.com');
  });

  it('reads a damaged document as empty and reports it', async () => {
    const storage = createMemoryKeyValueStorage();
    await storage.write('piwin.host-book.v1', '{broken');
    const onDamaged = vi.fn();
    expect(await new HostBook(storage, onDamaged).list()).toEqual([]);
    expect(onDamaged).toHaveBeenCalledOnce();
  });

  it('serializes concurrent writes', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        book.upsert(entry({ hostId: `HOST${String(index).padStart(18, '0')}` })),
      ),
    );
    expect(await book.list()).toHaveLength(5);
  });

  it('groups entries by relay user', () => {
    const groups = groupHostBookByUser([
      entry({ hostName: 'b' }),
      entry({ hostId: 'DDDDDDDDDDDDDDDDDDDDDD', hostName: 'a' }),
      entry({ userId: 'EEEEEEEEEEEEEEEEEEEEEE', userName: 'Alice' }),
    ]);
    expect(groups.map((group) => group.userName)).toEqual(['Alice', 'Yorick']);
    expect(groups[1]?.entries.map((item) => item.hostName)).toEqual(['a', 'b']);
  });
});

describe('RemoteHostVault', () => {
  it('stores the client key and credential per Host', async () => {
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    const clientKeyPair = generateNoiseKeyPair();
    await vault.write(HOST, { clientKeyPair, credential: { deviceId: 'd', deviceSecret: 's' } });
    const read = await vault.read(HOST);
    expect(read?.clientKeyPair.publicKey).toEqual(clientKeyPair.publicKey);
    expect(read?.credential).toEqual({ deviceId: 'd', deviceSecret: 's' });
    expect(await vault.read('other')).toBeUndefined();
    await vault.clear(HOST);
    expect(await vault.read(HOST)).toBeUndefined();
  });
});

describe('HostDialPlan', () => {
  it('builds connect URLs and starts with the relay', () => {
    const plan = new HostDialPlan(entry());
    expect(plan.next()).toEqual({
      path: 'relay',
      url: `wss://relay.example.com/v1/u/${USER}/connect?hostId=${HOST}`,
    });
  });

  it('falls back to direct after the relay fails before opening, then returns to the relay', () => {
    const plan = new HostDialPlan(entry());
    plan.reportClosed(4404, false);
    expect(plan.next().path).toBe('direct');
    plan.reportClosed(1000, true);
    expect(plan.next().path).toBe('relay');
  });

  it('wraps around and resets on wake', () => {
    const plan = new HostDialPlan(entry());
    plan.reportClosed(1006, false);
    plan.reportClosed(1006, false);
    expect(plan.next().path).toBe('relay');
    plan.reportClosed(1006, false);
    plan.reset();
    expect(plan.next().path).toBe('relay');
  });

  it('uses the only path it has', () => {
    const { relayUrl: _relay, ...directOnly } = entry();
    const plan = new HostDialPlan(directOnly);
    plan.reportClosed(1006, false);
    expect(plan.next().path).toBe('direct');
    expect(() => new HostDialPlan({ userId: USER, hostId: HOST }).next()).toThrow();
  });
});

describe('classifyPairingInput', () => {
  const link = {
    v: 3 as const,
    userId: USER,
    userName: 'Yorick',
    hostId: HOST,
    hostName: 'MacBook',
    hostKey: HOST_KEY,
    relayUrl: 'wss://relay.example.com',
    pairingToken: 't',
    role: 'member' as const,
    expiresAt: 2_000,
  };

  it('prefers a v3 link and refuses an expired one', () => {
    expect(classifyPairingInput(encodePairingLinkV3(link), 1_000)).toMatchObject({
      kind: 'channel',
    });
    expect(() => classifyPairingInput(encodePairingLinkV3(link), 3_000)).toThrow('已过期');
  });

  it('still reads the older formats during the migration window', () => {
    expect(
      classifyPairingInput('piwin://pair?endpoint=ws%3A%2F%2F192.168.1.2%3A8790&pairingToken=abc'),
    ).toMatchObject({ kind: 'legacy', data: { pairingToken: 'abc' } });
  });
});

describe('dialFirstReachable', () => {
  const hello = { type: 'host/hello' } as HostHello;

  it('moves on from an unreachable relay to direct', async () => {
    const dialed: string[] = [];
    const result = await dialFirstReachable(new HostDialPlan(entry()), async (choice) => {
      dialed.push(choice.path);
      if (choice.path === 'relay') throw new Error('closed 4404');
      return { hello, close: async () => undefined };
    });
    expect(dialed).toEqual(['relay', 'direct']);
    expect(result.choice.path).toBe('direct');
  });

  it('stops at a Host refusal instead of trying another path', async () => {
    const dialed: string[] = [];
    await expect(
      dialFirstReachable(new HostDialPlan(entry()), async (choice) => {
        dialed.push(choice.path);
        throw new HostHandshakeError('refused', 4004, 'pairing-token-invalid');
      }),
    ).rejects.toBeInstanceOf(HostHandshakeError);
    expect(dialed).toEqual(['relay']);
  });
});

describe('migrateLegacyHost', () => {
  function connection(overrides: Partial<LegacyHostConnection> = {}): LegacyHostConnection {
    return {
      hello: { type: 'host/hello', endpoints: { userId: USER } } as unknown as HostHello,
      close: async () => undefined,
      request: async () => ({
        type: 'response',
        command: 'host/channel-migrate',
        success: true,
        data: {
          userId: USER,
          userName: 'Yorick',
          hostId: HOST,
          hostName: 'MacBook',
          hostKey: HOST_KEY,
          directUrl: 'ws://192.168.1.20:8790',
          role: 'member',
        },
      }),
      ...overrides,
    };
  }
  const record = {
    endpoint: 'ws://192.168.1.20:8790',
    clientId: 'phone',
    credential: { deviceId: 'd', deviceSecret: 's' },
  };

  it('writes entry and secrets only after the channel hello succeeds', async () => {
    const hostBook = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    const outcome = await migrateLegacyHost({
      record,
      hostBook,
      vault,
      connectLegacy: async () => connection(),
      verifyChannel: async () => undefined,
    });
    expect(outcome).toMatchObject({ status: 'migrated', entry: { hostId: HOST, role: 'member' } });
    expect((await vault.read(HOST))?.credential).toEqual(record.credential);
  });

  it('rolls back when the channel hello fails', async () => {
    const hostBook = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    const outcome = await migrateLegacyHost({
      record,
      hostBook,
      vault,
      connectLegacy: async () => connection(),
      verifyChannel: async () => {
        throw new Error('channel refused');
      },
    });
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(await hostBook.list()).toEqual([]);
    expect(await vault.read(HOST)).toBeUndefined();
  });

  it('reports an older Host as unsupported without migrating', async () => {
    const request = vi.fn();
    const outcome = await migrateLegacyHost({
      record,
      hostBook: new HostBook(createMemoryKeyValueStorage()),
      vault: new RemoteHostVault(createMemoryKeyValueStorage()),
      connectLegacy: async () =>
        connection({ hello: { type: 'host/hello' } as HostHello, request }),
      verifyChannel: async () => undefined,
    });
    expect(outcome).toEqual({ status: 'unsupported' });
    expect(request).not.toHaveBeenCalled();
  });

  it('fails on a refused migration (conflicting key) and keeps nothing', async () => {
    const hostBook = new HostBook(createMemoryKeyValueStorage());
    const outcome = await migrateLegacyHost({
      record,
      hostBook,
      vault: new RemoteHostVault(createMemoryKeyValueStorage()),
      connectLegacy: async () =>
        connection({
          request: async () => ({
            type: 'response',
            command: 'host/channel-migrate',
            success: false,
            error: 'This device already migrated with another key',
          }),
        }),
      verifyChannel: async () => undefined,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('another key') },
    });
    expect(await hostBook.list()).toEqual([]);
  });
});

describe('createNativeSecretStorage', () => {
  it('drives the mobile commands by default and the Desktop ones by prefix', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const invoke = async (command: string, args: Record<string, unknown>) => {
      calls.push([command, args]);
      return command.endsWith('_read') ? '' : undefined;
    };
    const mobile = createNativeSecretStorage(invoke);
    const desktop = createNativeSecretStorage(invoke, 'desktop_secret');
    expect(await mobile.read('k')).toBeUndefined();
    await desktop.write('k', 'v');
    await desktop.remove('k');
    expect(calls).toEqual([
      ['mobile_credential_read', { endpoint: 'k' }],
      ['desktop_secret_write', { endpoint: 'k', payload: 'v' }],
      ['desktop_secret_clear', { endpoint: 'k' }],
    ]);
  });
});

describe('classifyChannelFailure', () => {
  it('names relay and channel close codes and leaves Host reasons alone', async () => {
    const { classifyChannelFailure } = await import('./channel-failure.js');
    const { HostHandshakeError, HostSocketClosedError } = await import('@piwin/host-transport');
    expect(classifyChannelFailure(new HostSocketClosedError('x', 4404))).toBe('host-unavailable');
    expect(classifyChannelFailure(new HostSocketClosedError('x', 4429))).toBe('relay-limited');
    expect(classifyChannelFailure(new HostSocketClosedError('x', 4403))).toBe('relay-forbidden');
    expect(classifyChannelFailure(new HostHandshakeError('x', 4004))).toBe('host-key-mismatch');
    expect(
      classifyChannelFailure(new HostHandshakeError('x', 4004, 'authentication-failed')),
    ).toBeUndefined();
    expect(classifyChannelFailure(new HostSocketClosedError('x', 1006))).toBeUndefined();
    expect(classifyChannelFailure(new Error('x'))).toBeUndefined();
  });
});
