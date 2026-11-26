// @vitest-environment happy-dom
import type { HostBookEntry, HostHello, PairingLinkV3 } from '@piwin/contracts';
import {
  createMemoryKeyValueStorage,
  HostBook,
  RemoteHostVault,
  type ChannelDialer,
} from '@piwin/host-client';
import { encodeBase64Url, generateNoiseKeyPair } from '@piwin/host-transport';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMobileChannelHost,
  displayEndpointForHostEntry,
  mobileChannelInnerSocketFactory,
  MOBILE_LAST_CHANNEL_HOST_ID_KEY,
  mobileHostBook,
  pairMobileChannelHost,
  readLastMobileChannelHostId,
  resolveSavedChannelHost,
  writeLastMobileChannelHostId,
} from './mobile-channel-host.js';

const USER = 'AbCdEfGhIjKlMnOpQrSt_-';
const HOST = 'ZyXwVuTsRqPoNmLkJiHg-_';
const HOST_KEY = encodeBase64Url(new Uint8Array(32).fill(7));

const LINK: PairingLinkV3 = {
  v: 3,
  userId: USER,
  userName: 'Yorick',
  hostId: HOST,
  hostName: 'MacBook',
  hostKey: HOST_KEY,
  relayUrl: 'wss://relay.example.com',
  directUrl: 'ws://192.168.1.20:8790',
  pairingToken: 'scan-me',
  role: 'member',
  expiresAt: 1_900_000_000_000,
};

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

function fakeDial(hello: HostHello): ChannelDialer & { hellos: unknown[] } {
  const hellos: unknown[] = [];
  const dial = Object.assign(
    ({ hello: clientHello }: { hello: unknown }) => {
      hellos.push(clientHello);
      return Promise.resolve({ hello, close: async () => undefined });
    },
    { hellos },
  ) as ChannelDialer & { hellos: unknown[] };
  return dial;
}

function pairedHello(): HostHello {
  return {
    type: 'host/hello',
    protocolVersion: 1,
    hostInstanceId: 'inst-1',
    currentSeq: 0,
    authRequired: false,
    authenticated: true,
    capabilities: {
      pushSequencing: true,
      replay: true,
      snapshot: true,
      sessionRead: true,
      sessionControl: true,
      permissionResolve: true,
      mediaUpload: true,
    },
    deviceId: 'device-1',
    deviceSecret: 'secret-1',
  };
}

describe('mobile channel Host persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('remembers and forgets the last channel Host id', () => {
    expect(readLastMobileChannelHostId()).toBeUndefined();
    writeLastMobileChannelHostId(HOST);
    expect(localStorage.getItem(MOBILE_LAST_CHANNEL_HOST_ID_KEY)).toBe(HOST);
    expect(readLastMobileChannelHostId()).toBe(HOST);
    localStorage.removeItem(MOBILE_LAST_CHANNEL_HOST_ID_KEY);
    expect(readLastMobileChannelHostId()).toBeUndefined();
  });

  it('pairs a v3 link, writes book, vault and last-host memory', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    const dial = fakeDial(pairedHello());
    const { entry: paired, secrets } = await pairMobileChannelHost({
      link: LINK,
      clientId: 'mobile-test',
      clientVersion: '0.0.0',
      book,
      vault,
      dial,
    });
    expect(paired.hostId).toBe(HOST);
    expect(paired.relayUrl).toBe('wss://relay.example.com');
    expect(secrets.credential).toEqual({ deviceId: 'device-1', deviceSecret: 'secret-1' });
    expect((await book.get(HOST))?.hostName).toBe('MacBook');
    expect(await vault.read(HOST)).toEqual(secrets);
    expect(readLastMobileChannelHostId()).toBe(HOST);
    // The one-time pairing token must be the admission material of the hello.
    expect(dial.hellos).toHaveLength(1);
    expect(dial.hellos[0]).toMatchObject({
      type: 'client/hello',
      clientType: 'mobile',
      clientId: 'mobile-test',
      pairingToken: 'scan-me',
      deviceName: 'Piwin mobile',
    });
  });

  it('resolves a saved channel Host from book and vault', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    const secrets = {
      clientKeyPair: generateNoiseKeyPair(),
      credential: { deviceId: 'device-1', deviceSecret: 'secret-1' },
    };
    await book.upsert(entry());
    await vault.write(HOST, secrets);
    writeLastMobileChannelHostId(HOST);

    const resolved = await resolveSavedChannelHost({ book, vault });
    expect(resolved?.entry.hostId).toBe(HOST);
    expect(resolved?.secrets.credential).toEqual(secrets.credential);
  });

  it('returns undefined with no remembered Host and forgets a vanished entry', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    expect(await resolveSavedChannelHost({ book, vault })).toBeUndefined();

    writeLastMobileChannelHostId(HOST);
    expect(await resolveSavedChannelHost({ book, vault })).toBeUndefined();
    expect(readLastMobileChannelHostId()).toBeUndefined();
  });

  it('throws a localized error when the entry exists but secrets are gone', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    await book.upsert(entry());
    writeLastMobileChannelHostId(HOST);
    await expect(resolveSavedChannelHost({ book, vault })).rejects.toThrow(
      '此设备授权已失效，请断开后重新扫码配对。',
    );
  });

  it('clears a channel Host: remembered id, secrets and book entry', async () => {
    const book = new HostBook(createMemoryKeyValueStorage());
    const vault = new RemoteHostVault(createMemoryKeyValueStorage());
    await book.upsert(entry());
    await vault.write(HOST, {
      clientKeyPair: generateNoiseKeyPair(),
      credential: { deviceId: 'device-1', deviceSecret: 'secret-1' },
    });
    writeLastMobileChannelHostId(HOST);

    await clearMobileChannelHost({ hostId: HOST, book, vault });
    expect(readLastMobileChannelHostId()).toBeUndefined();
    expect(await book.get(HOST)).toBeUndefined();
    expect(await vault.read(HOST)).toBeUndefined();
  });
});

describe('displayEndpointForHostEntry', () => {
  it('prefers relay, then direct, then the Host id', () => {
    expect(displayEndpointForHostEntry(entry())).toBe('wss://relay.example.com');
    const { relayUrl: _relay, ...directOnly } = entry();
    expect(displayEndpointForHostEntry(directOnly)).toBe('ws://192.168.1.20:8790');
    const { relayUrl: _r, directUrl: _d, ...hostOnly } = entry();
    expect(displayEndpointForHostEntry(hostOnly)).toBe(HOST);
  });
});

describe('mobileChannelInnerSocketFactory', () => {
  it('uses the browser WebSocket when the native plugin is off', () => {
    const factory = mobileChannelInnerSocketFactory(false);
    const socket = factory('wss://relay.example.com/v1/u/x/connect?hostId=y');
    expect(socket).toBeInstanceOf(WebSocket);
    socket.close();
  });

  it('uses the browser WebSocket for wss even with the plugin on', () => {
    const connect = vi.fn();
    const factory = mobileChannelInnerSocketFactory(true, connect);
    const socket = factory('wss://relay.example.com');
    expect(socket).toBeInstanceOf(WebSocket);
    expect(connect).not.toHaveBeenCalled();
    socket.close();
  });

  it('routes cleartext ws dials through the native plugin socket', () => {
    const connect = vi.fn();
    const factory = mobileChannelInnerSocketFactory(true, connect);
    const socket = factory('ws://192.168.1.20:8790/v1/u/x/connect?hostId=y');
    expect(socket).not.toBeInstanceOf(WebSocket);
    expect(socket.readyState).toBe(0);
    socket.close();
  });
});

describe('mobileHostBook storage', () => {
  it('persists entries through localStorage', async () => {
    const book = mobileHostBook();
    await book.upsert(entry());
    const fresh = mobileHostBook();
    expect((await fresh.get(HOST))?.hostName).toBe('MacBook');
    await fresh.remove(HOST);
  });
});
