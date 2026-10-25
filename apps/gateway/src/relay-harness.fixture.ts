import {
  decodeRelayControlFrame,
  remoteChannelPath,
  type RelayControlFrame,
} from '@piwin/contracts';
import {
  deriveHostId,
  deriveUserId,
  encodeBase64Url,
  generateRelaySigningSecretKey,
  relaySigningPublicKey,
  signRelayHostAuth,
} from '@piwin/host-transport';
import { WebSocket, type RawData } from 'ws';
import { RelayEnrollToken } from './relay-enroll-token.js';
import type { RelayLimits } from './relay-limits.js';
import type { RelayLogEvent } from './relay-log.js';
import { createRelayServer, type RelayServer } from './relay-server.js';
import { RelayUserRegistry } from './relay-user-registry.js';

export const ENROLL_TOKEN = 'enroll-token-0123456789';

export type TestIdentity = {
  userSecretKey: Uint8Array;
  hostSigningSecretKey: Uint8Array;
  userId: string;
  hostId: string;
  userPublicKey: string;
};

/** A user and one Host of theirs; pass `userSecretKey` for a second Host of the same user. */
export function createTestIdentity(userSecretKey = generateRelaySigningSecretKey()): TestIdentity {
  const hostSigningSecretKey = generateRelaySigningSecretKey();
  const userPublicKey = relaySigningPublicKey(userSecretKey);
  return {
    userSecretKey,
    hostSigningSecretKey,
    userId: deriveUserId(userPublicKey),
    hostId: deriveHostId(relaySigningPublicKey(hostSigningSecretKey)),
    userPublicKey: encodeBase64Url(userPublicKey),
  };
}

export type TestRelay = {
  url: string;
  server: RelayServer;
  registry: RelayUserRegistry;
  events: RelayLogEvent[];
  saves: () => number;
  close: () => Promise<void>;
};

export async function startTestRelay(
  options: {
    registered?: TestIdentity[];
    limits?: Partial<RelayLimits>;
    enroll?: boolean;
    webRoot?: string;
    failSave?: boolean;
  } = {},
): Promise<TestRelay> {
  const registry = new RelayUserRegistry();
  for (const identity of options.registered ?? []) {
    registry.addUser({ userId: identity.userId, publicKey: identity.userPublicKey, name: 'test' });
  }
  const events: RelayLogEvent[] = [];
  let saves = 0;
  const enrollToken = options.enroll ? RelayEnrollToken.fromEnvironment(ENROLL_TOKEN) : undefined;
  const server = createRelayServer({
    registry,
    persistRegistry: async () => {
      if (options.failSave) throw new Error('disk full');
      saves += 1;
    },
    ...(enrollToken === undefined ? {} : { enrollToken }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
    log: (event) => events.push(event),
  });
  const { url } = await server.listen(0, '127.0.0.1');
  return { url, server, registry, events, saves: () => saves, close: () => server.close() };
}

/** A client-side socket that records everything it receives. */
export type Probe = {
  socket: WebSocket;
  texts: RelayControlFrame[];
  binaries: Uint8Array[];
  opened: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
};

export function openProbe(url: string): Probe {
  const socket = new WebSocket(url);
  const texts: RelayControlFrame[] = [];
  const binaries: Uint8Array[] = [];
  socket.on('message', (data: RawData, isBinary: boolean) => {
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
    if (isBinary) {
      binaries.push(new Uint8Array(bytes));
      return;
    }
    const frame = decodeRelayControlFrame(bytes.toString());
    if (frame !== undefined) texts.push(frame);
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('unexpected-response', (_request, response) =>
      reject(new Error(`HTTP ${response.statusCode ?? 0}`)),
    );
    socket.once('error', reject);
  });
  opened.catch(() => undefined);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  return { socket, texts, binaries, opened, closed };
}

export function hostUrl(relayUrl: string, identity: { userId: string; hostId: string }): string {
  return `${relayUrl}${remoteChannelPath(identity.userId, 'host')}?hostId=${identity.hostId}`;
}

export function connectUrl(relayUrl: string, identity: { userId: string; hostId: string }): string {
  return `${relayUrl}${remoteChannelPath(identity.userId, 'connect')}?hostId=${identity.hostId}`;
}

/** Dials as a Host and answers the challenge; resolves once the relay says `ready`. */
export async function connectHost(
  relayUrl: string,
  identity: TestIdentity,
  options: { enrollToken?: string; userName?: string; signAs?: TestIdentity } = {},
): Promise<Probe> {
  const probe = openProbe(hostUrl(relayUrl, identity));
  await probe.opened;
  const challenge = await waitFor(
    () => probe.texts.find((frame) => frame.t === 'challenge'),
    probe,
  );
  if (challenge?.t !== 'challenge') throw new Error('no challenge');
  const signer = options.signAs ?? identity;
  probe.socket.send(
    JSON.stringify(
      signRelayHostAuth({
        nonce: challenge.nonce,
        hostSigningSecretKey: signer.hostSigningSecretKey,
        userSecretKey: signer.userSecretKey,
        ...(options.enrollToken === undefined ? {} : { enrollToken: options.enrollToken }),
        ...(options.userName === undefined ? {} : { userName: options.userName }),
      }),
    ),
  );
  return probe;
}

export async function connectReadyHost(relayUrl: string, identity: TestIdentity): Promise<Probe> {
  const probe = await connectHost(relayUrl, identity);
  await waitFor(() => probe.texts.find((frame) => frame.t === 'ready'), probe);
  return probe;
}

/** Polls `read` until it returns a value, or fails when the probe closes first. */
export async function waitFor<T>(
  read: () => T | undefined,
  probe?: Probe,
  timeoutMs = 2_000,
): Promise<T> {
  const startedAt = Date.now();
  let closed: { code: number; reason: string } | undefined;
  void probe?.closed.then((event) => {
    closed = event;
  });
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (closed !== undefined) throw new Error(`socket closed ${closed.code} ${closed.reason}`);
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
