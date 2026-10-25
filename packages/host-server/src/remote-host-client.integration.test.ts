import type { HostBookEntry, HostClientHello } from '@piwin/contracts';
import {
  createChannelDialer,
  createLegacyConnector,
  createMemoryKeyValueStorage,
  createRemoteHostTransport,
  HostBook,
  HostDialPlan,
  migrateLegacyHost,
  pairRemoteHost,
  RemoteHostVault,
} from '@piwin/host-client';
import { parsePairingLinkV3, type RelayInnerSocket } from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mintPairingCode } from './pairing-operations.js';
import {
  DOOR_TOKEN,
  startRemoteAccessHost,
  type TestHost,
} from './remote-access-harness.fixture.js';

const hosts: TestHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
});

const innerSocket = (url: string): RelayInnerSocket =>
  new WebSocket(url) as unknown as RelayInnerSocket;
const HELLO_BASE = {
  type: 'client/hello' as const,
  protocolVersion: 1 as const,
  clientType: 'mobile' as const,
  clientVersion: 'test',
  clientId: 'phone-1',
};

function shellState() {
  return {
    hostBook: new HostBook(createMemoryKeyValueStorage()),
    vault: new RemoteHostVault(createMemoryKeyValueStorage()),
  };
}

async function pairShell(target: TestHost, state = shellState()) {
  const code = await mintPairingCode(
    { pairing: target.pairing, store: undefined },
    {
      advertisedEndpoint: target.url,
      hostInstanceId: 'h',
      channelLinks: target.access.channelLinks,
    },
  );
  const link = parsePairingLinkV3(code.channelUri ?? '');
  if (link === undefined) throw new Error('no v3 link');
  const entry = await pairRemoteHost({
    link,
    ...state,
    dial: createChannelDialer(innerSocket),
    hello: HELLO_BASE,
  });
  return { ...state, entry };
}

function helloWith(credential: { deviceId: string; deviceSecret: string }) {
  return (lastSeq: number): HostClientHello => ({
    ...HELLO_BASE,
    lastSeq,
    deviceCredential: credential,
  });
}

describe('host-client remote hosts against a real Host (ADR 0101 P4)', () => {
  it('pairs from a v3 link into the host book and vault, then reconnects from them', async () => {
    const target = await startRemoteAccessHost();
    hosts.push(target);
    const { hostBook, vault, entry } = await pairShell(target);
    expect(entry).toMatchObject({
      hostId: target.access.endpoints().hostId,
      directUrl: target.url,
    });
    const secrets = await vault.read(entry.hostId);
    if (secrets === undefined) throw new Error('no secrets');

    const paths: Array<string | undefined> = [];
    const remote = createRemoteHostTransport({
      entry: (await hostBook.get(entry.hostId)) ?? entry,
      clientKeyPair: secrets.clientKeyPair,
      createInnerSocket: innerSocket,
      createHello: helloWith(secrets.credential),
      onPath: (path) => paths.push(path),
    });
    expect((await remote.transport.connect()).deviceId).toBe(secrets.credential.deviceId);
    expect(paths).toContain('direct');
    await remote.transport.close();
  });

  it('falls back from an unreachable relay to direct', async () => {
    const target = await startRemoteAccessHost();
    hosts.push(target);
    const { vault, entry } = await pairShell(target);
    const secrets = await vault.read(entry.hostId);
    if (secrets === undefined) throw new Error('no secrets');
    const withDeadRelay: HostBookEntry = { ...entry, relayUrl: 'ws://127.0.0.1:1' };
    const paths: Array<string | undefined> = [];
    const remote = createRemoteHostTransport({
      entry: withDeadRelay,
      clientKeyPair: secrets.clientKeyPair,
      createInnerSocket: innerSocket,
      createHello: helloWith(secrets.credential),
      onPath: (path) => paths.push(path),
      transportOptions: { autoReconnect: true, reconnectMinDelayMs: 5, reconnectMaxDelayMs: 10 },
    });
    await remote.transport.connect();
    expect(paths.filter((path) => path !== undefined)).toEqual(['direct']);
    expect(new HostDialPlan(withDeadRelay).next().path).toBe('relay');
    await remote.transport.close();
  });

  it('keeps the host book current from host/endpoints pushes', async () => {
    const target = await startRemoteAccessHost();
    hosts.push(target);
    const { hostBook, vault, entry } = await pairShell(target);
    const secrets = await vault.read(entry.hostId);
    if (secrets === undefined) throw new Error('no secrets');
    let applied = Promise.resolve<HostBookEntry | undefined>(undefined);
    const remote = createRemoteHostTransport({
      entry,
      clientKeyPair: secrets.clientKeyPair,
      createInnerSocket: innerSocket,
      createHello: helloWith(secrets.credential),
      onEndpoints: (endpoints) => {
        applied = hostBook.applyEndpoints(entry.hostId, endpoints);
      },
    });
    await remote.transport.connect();
    await target.access.renameUser('New Owner Name');
    await expect
      .poll(async () => (await hostBook.get(entry.hostId))?.userName)
      .toBe('New Owner Name');
    await applied;
    await remote.transport.close();
  });

  it('migrates a legacy device without re-pairing', async () => {
    const target = await startRemoteAccessHost();
    hosts.push(target);
    const { credential } = target.pairing.completePairing(
      target.pairing.mintToken().token,
      'Old phone',
    );
    const { hostBook, vault } = shellState();
    const outcome = await migrateLegacyHost({
      record: { endpoint: target.url, credential, clientId: 'phone-1' },
      hostBook,
      vault,
      connectLegacy: createLegacyConnector(
        { type: 'client/hello', protocolVersion: 1, clientType: 'mobile', clientVersion: 'test' },
        (url) => new WebSocket(url, { headers: { 'x-forwarded-for': '203.0.113.5' } }) as never,
      ),
      verifyChannel: async (entry, secrets) => {
        const dial = createChannelDialer(innerSocket);
        const plan = new HostDialPlan(entry);
        const result = await dial({
          choice: plan.next(),
          target: entry,
          clientKeyPair: secrets.clientKeyPair,
          hello: { ...HELLO_BASE, lastSeq: 0, deviceCredential: secrets.credential },
        });
        await result.close();
      },
    });
    expect(outcome).toMatchObject({ status: 'migrated', entry: { role: 'member' } });
    expect(target.pairing.list()[0]?.migratedAt).toBeDefined();
    expect((await vault.read(target.access.endpoints().hostId))?.credential).toEqual(credential);
  });

  it('migrates a token-door shell into an operator device', async () => {
    const target = await startRemoteAccessHost({ authToken: DOOR_TOKEN });
    hosts.push(target);
    const { hostBook, vault } = shellState();
    const outcome = await migrateLegacyHost({
      record: {
        endpoint: target.url,
        authToken: DOOR_TOKEN,
        clientId: 'thin-shell',
        deviceName: 'Mac',
      },
      hostBook,
      vault,
      connectLegacy: createLegacyConnector(
        { type: 'client/hello', protocolVersion: 1, clientType: 'desktop', clientVersion: 'test' },
        (url) => new WebSocket(url, { headers: { 'x-forwarded-for': '203.0.113.5' } }) as never,
      ),
      verifyChannel: async () => undefined,
    });
    expect(outcome).toMatchObject({ status: 'migrated', entry: { role: 'operator' } });
    const secrets = await vault.read(target.access.endpoints().hostId);
    expect(secrets?.credential.deviceId).toMatch(/^device-/);
  });
});
