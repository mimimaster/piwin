import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HostClientHello,
  HostCommand,
  HostHello,
  HostResponse,
  HostWireMessage,
  LegacyAccessMode,
  PushSink,
} from '@piwin/contracts';
import {
  createRelaySecureWebSocketFactory,
  decodeBase64Url,
  decodeHostWireMessage,
  encodeBase64Url,
  encodeHostWireMessage,
  generateNoiseKeyPair,
  WebSocketHostTransport,
  type NoiseKeyPair,
  type RelayInnerSocket,
} from '@piwin/host-transport';
import { WebSocket } from 'ws';
import { HostDevicePairing } from './device-pairing.js';
import { HostDevicePairingFileStore } from './device-pairing-store.js';
import { HostIdentityStore } from './host-identity-store.js';
import { HostRemoteAccess } from './host-remote-access.js';
import type { HostRuntimePort } from './host-runtime-port.js';
import { HostServer } from './host-server.js';
import { RelayUserStore } from './relay-user-store.js';
import { RemoteAccessSettingsStore } from './remote-access-settings-store.js';

export const DOOR_TOKEN = 'door-token-for-tests';

export class FakeRuntime implements HostRuntimePort {
  public readonly commands: HostCommand[] = [];
  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    this.commands.push(command);
    return { type: 'response', command: command.type, success: true, data: { ok: true } };
  }
  public attachPushSink(_sink: PushSink): () => void {
    return () => undefined;
  }
  public attachBrowserFrameSink(_sink: unknown): () => void {
    return () => undefined;
  }
}

export type TestHost = {
  url: string;
  server: HostServer;
  access: HostRemoteAccess;
  pairing: HostDevicePairing;
  runtime: FakeRuntime;
  root: string;
  connectUrl: string;
  close: () => Promise<void>;
};

export async function startRemoteAccessHost(
  options: {
    legacyAccess?: LegacyAccessMode;
    authToken?: string;
    relayUrl?: string;
    createRelaySocket?: (url: string) => WebSocket;
  } = {},
): Promise<TestHost> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-remote-host-'));
  const devices = join(root, 'devices');
  const settingsStore = new RemoteAccessSettingsStore(join(devices, 'remote-access.json'));
  await settingsStore.save({
    relay:
      options.relayUrl === undefined
        ? { enabled: false }
        : { enabled: true, url: options.relayUrl },
    direct: { enabled: true },
    legacyAccess: options.legacyAccess ?? 'full',
  });
  const pairing = new HostDevicePairing();
  const pairingStore = new HostDevicePairingFileStore(join(devices, 'pairing.json'));
  const access = await HostRemoteAccess.open({
    identityStore: new HostIdentityStore(join(devices, 'host-identity.json')),
    userStore: new RelayUserStore(join(devices, 'relay-user.json')),
    settingsStore,
    pairing,
    hostName: 'Test Host',
    defaultUserName: 'tester',
    ...(options.createRelaySocket === undefined
      ? {}
      : { createRelaySocket: options.createRelaySocket }),
    relayBackoffMs: { min: 20, max: 40 },
  });
  const runtime = new FakeRuntime();
  const server = new HostServer({
    runtime,
    host: '127.0.0.1',
    port: 0,
    devicePairing: pairing,
    devicePairingStore: pairingStore,
    remoteAccess: access,
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
  });
  const { url } = await server.start();
  access.start();
  const target = access.migrationTarget();
  return {
    url,
    server,
    access,
    pairing,
    runtime,
    root,
    connectUrl: `${url}/v1/u/${target.userId}/connect?hostId=${target.hostId}`,
    close: async () => {
      access.dispose();
      await server.stop();
      // Hello persists lastSeen in the background; let it land before cleanup.
      await pairingStore.flush();
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

export type HelloKeys = Pick<HostClientHello, 'pairingToken' | 'deviceCredential' | 'authToken'>;

export function hello(keys: HelloKeys, clientId = 'client-1'): HostClientHello {
  return {
    type: 'client/hello',
    protocolVersion: 1,
    clientType: 'mobile',
    clientVersion: 'test',
    clientId,
    lastSeq: 0,
    ...keys,
  };
}

/** A shell on the ADR 0101 channel: WebSocketHostTransport over RelaySecureSocket. */
export function channelTransport(
  host: TestHost,
  keys: HelloKeys,
  options: { clientKey?: NoiseKeyPair; clientId?: string; url?: string } = {},
): WebSocketHostTransport {
  const clientStaticKeyPair = options.clientKey ?? generateNoiseKeyPair();
  const clientId = options.clientId ?? 'client-1';
  const target = host.access.migrationTarget();
  return new WebSocketHostTransport({
    endpoint: options.url ?? host.connectUrl,
    autoReconnect: false,
    connectTimeoutMs: 2_000,
    createHello: () => hello(keys, clientId),
    webSocketFactory: createRelaySecureWebSocketFactory({
      userId: target.userId,
      hostId: target.hostId,
      hostKey: decodeBase64Url(target.hostKey) ?? new Uint8Array(),
      clientStaticKeyPair,
      createInnerSocket: (inner) => new WebSocket(inner) as unknown as RelayInnerSocket,
    }),
  });
}

export function channelKeyOf(pair: NoiseKeyPair): string {
  return encodeBase64Url(pair.publicKey);
}

let requestCounter = 0;

/** Sends one command and resolves with its response (or the error frame). */
export function request(
  transport: WebSocketHostTransport,
  command: HostCommand,
): Promise<Extract<HostWireMessage, { type: 'response' | 'error' }>> {
  const requestId = `req-${(requestCounter += 1)}`;
  return new Promise((resolve) => {
    const unsubscribe = transport.subscribe((message) => {
      if (
        (message.type === 'response' || message.type === 'error') &&
        message.requestId === requestId
      ) {
        unsubscribe();
        resolve(message);
      }
    });
    transport.send({ type: 'command', requestId, command });
  });
}

/** A legacy (pre-ADR 0101) client: plain JSON over ws, looking remote via a proxy header. */
export type LegacyClient = {
  socket: WebSocket;
  messages: HostWireMessage[];
  closed: Promise<{ code: number; reason: string }>;
  hello: () => Promise<HostHello | Extract<HostWireMessage, { type: 'error' }>>;
  request: (
    command: HostCommand,
  ) => Promise<Extract<HostWireMessage, { type: 'response' | 'error' }>>;
};

export async function legacyClient(host: TestHost, keys: HelloKeys): Promise<LegacyClient> {
  const socket = new WebSocket(host.url, { headers: { 'x-forwarded-for': '203.0.113.5' } });
  const messages: HostWireMessage[] = [];
  socket.on('message', (data: Buffer) => messages.push(decodeHostWireMessage(data.toString())));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const waitMessage = <T extends HostWireMessage>(match: (message: HostWireMessage) => boolean) =>
    new Promise<T>((resolve, reject) => {
      const startedAt = Date.now();
      const poll = (): void => {
        const found = messages.find(match);
        if (found !== undefined) return resolve(found as T);
        if (Date.now() - startedAt > 2_000) return reject(new Error('timed out'));
        setTimeout(poll, 5);
      };
      poll();
    });
  return {
    socket,
    messages,
    closed,
    hello: () => {
      socket.send(encodeHostWireMessage(hello(keys, 'legacy-client')));
      return waitMessage((message) => message.type === 'host/hello' || message.type === 'error');
    },
    request: (command) => {
      const requestId = `legacy-${(requestCounter += 1)}`;
      socket.send(encodeHostWireMessage({ type: 'command', requestId, command }));
      return waitMessage(
        (message) =>
          (message.type === 'response' || message.type === 'error') &&
          'requestId' in message &&
          message.requestId === requestId,
      );
    },
  };
}
