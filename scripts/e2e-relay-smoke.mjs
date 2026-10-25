#!/usr/bin/env node
/**
 * ADR 0101 relay smoke: a real relay process (`apps/gateway`) and a real
 * mock Host process (`apps/host`), with a shell that only knows the relay.
 *
 * Covers: operator pairing over the relay → prompt and resume → relay
 * restart with automatic reconnect → member pairing and revoke → a second
 * relay user cannot reach the Host (4404).
 *
 * No network beyond 127.0.0.1; all state lives in a temp directory.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createChannelDialer,
  createMemoryKeyValueStorage,
  createRemoteHostTransport,
  dialPairedHost,
  HostBook,
  HostClient,
  pairRemoteHost,
  RemoteHostVault,
} from '../packages/host-client/src/index.ts';
import {
  encodeBase64Url,
  formatRelayEnrollmentLine,
  generateRelaySigningSecretKey,
  deriveUserId,
  HostHandshakeError,
  HostSocketClosedError,
  parsePairingLinkV3,
  relaySigningPublicKey,
} from '../packages/host-transport/src/index.ts';

const ENROLL_TOKEN = 'e2e-relay-enroll-token-0123456789';
const STEP_TIMEOUT_MS = 30_000;
const root = await mkdtemp(join(tmpdir(), 'piwin-e2e-relay-'));
const children = new Set();
const clients = [];
let requestCount = 0;

// Node's built-in WebSocket (Node >= 22), the same one a browser shell uses.
const innerSocket = (url) => new globalThis.WebSocket(url);
const dial = createChannelDialer(innerSocket);

try {
  const relayPort = await freePort();
  const hostPort = await freePort();
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const usersPath = join(root, 'relay-users.json');

  let relay = await startRelay({ relayPort, usersPath });
  const host = startProcess('host', 'apps/host/src/index.ts', [], {
    PIWIN_ROOT: join(root, 'host-root'),
    PIWIN_MOCK: '1',
    PIWIN_HOST_PORT: String(hostPort),
    PIWIN_HOST_BIND: '127.0.0.1',
    PIWIN_HOST_USER_NAME: 'e2e',
    PIWIN_HOST_RELAY_URL: relayUrl,
    PIWIN_RELAY_ENROLL_TOKEN: ENROLL_TOKEN,
  });
  const operatorLine = await host.waitForLine(
    (line) => line.startsWith('piwin://pair?v=3') && line.includes('role=operator'),
  );
  const operatorLink = relayOnly(parsePairingLinkV3(operatorLine));
  step('Host printed an operator link with the relay');

  // 1. Operator pairs through the relay only; 4404 until the Host has enrolled.
  const operator = await retry('operator pairing over the relay', () =>
    pairShell(operatorLink, 'e2e-operator'),
  );
  assert(operator.entry.role === 'operator', 'operator entry has the wrong role');
  const operatorClient = await connectClient(operator, 'e2e-operator');
  step('operator paired and connected over the relay');

  // 2. A prompt round trip through the channel.
  // Remote shells create general or remote-project sessions, never by path.
  const created = await ok(operatorClient, {
    type: 'session/create',
    input: { scope: { kind: 'general' } },
  });
  const sessionId = created.data.sessionId;
  await ok(operatorClient, {
    type: 'session/prompt',
    sessionId,
    input: { text: 'hello relay' },
    foreground: { kind: 'if-idle' },
  });
  const resumed = await ok(operatorClient, { type: 'session/resume', sessionId });
  assert(
    (resumed.data?.messages ?? []).some((message) =>
      String(message.text ?? '').includes('hello relay'),
    ),
    'resume over the relay is missing the prompt',
  );
  step('prompt and resume over the relay');

  // 3. Relay restart: Host connector and shell both come back on their own.
  await relay.stop();
  relay = await startRelay({ relayPort, usersPath });
  await retry('request after relay restart', () =>
    ok(operatorClient, { type: 'host/status' }, 5_000),
  );
  step('reconnected after a relay restart');

  // 4. Member pairing, then revoke from the operator.
  const memberCode = await ok(operatorClient, { type: 'host/pairing-create-code', role: 'member' });
  const memberLink = relayOnly(parsePairingLinkV3(memberCode.data.channelUri ?? ''));
  const member = await pairShell(memberLink, 'e2e-member');
  assert(member.entry.role === 'member', 'member entry has the wrong role');
  const memberProbe = await dialAs(member, 'e2e-member');
  await memberProbe.close();
  const memberDeviceId = member.secrets.credential.deviceId;
  await ok(operatorClient, { type: 'host/pairing-revoke-device', deviceId: memberDeviceId });
  const revoked = await dialAs(member, 'e2e-member').then(
    async (connection) => {
      await connection.close();
      return undefined;
    },
    (error) => error,
  );
  // ADR 0101 §5 early drop: a revoked key matches no active device, so the
  // Host aborts without a reply and the relay answers the ambiguous 4404.
  assert(
    revoked instanceof HostSocketClosedError && revoked.closeCode === 4404,
    `revoked member was not dropped: ${String(revoked)}`,
  );
  step('member paired, then dropped after revoke');

  // 5. Another relay user, registered on the same relay, gets the same 4404.
  const otherKey = generateRelaySigningSecretKey();
  const otherPublic = relaySigningPublicKey(otherKey);
  await runRelayAdmin(
    ['user', 'add', formatRelayEnrollmentLine({ publicKey: otherPublic, name: 'other' })],
    usersPath,
  );
  const otherUserId = deriveUserId(otherPublic);
  const listed = await runRelayAdmin(['user', 'list'], usersPath);
  assert(listed.includes(otherUserId), 'second relay user was not registered');
  // The running relay picks up registry edits within a few seconds.
  await delay(3_000);
  const crossUser = await dialAs(
    { ...operator, entry: { ...operator.entry, userId: otherUserId } },
    'e2e-operator',
  ).then(
    async (connection) => {
      await connection.close();
      return undefined;
    },
    (error) => error,
  );
  assert(
    crossUser instanceof HostSocketClosedError && crossUser.closeCode === 4404,
    `another user's dial was not 4404: ${String(crossUser)}`,
  );
  step(`another relay user (${encodeBase64Url(otherPublic).slice(0, 6)}…) gets 4404`);

  console.log('e2e-relay-smoke: ok');
} finally {
  for (const client of clients) await client.close().catch(() => undefined);
  // Wait for the processes to exit so nothing writes while the root is removed.
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          child.once('exit', resolve);
          child.kill('SIGTERM');
        }),
    ),
  );
  await rm(root, { recursive: true, force: true });
}

/** Pair a fresh shell from a v3 link into in-memory host book + vault. */
async function pairShell(link, clientId) {
  const hostBook = new HostBook(createMemoryKeyValueStorage());
  const vault = new RemoteHostVault(createMemoryKeyValueStorage());
  const entry = await pairRemoteHost({
    link,
    hostBook,
    vault,
    dial,
    hello: {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'cli',
      clientVersion: 'e2e',
      clientId,
    },
  });
  const secrets = await vault.read(entry.hostId);
  assert(secrets !== undefined, 'pairing kept no secrets');
  return { entry: relayOnly(entry), secrets };
}

function dialAs(shell, clientId) {
  return dialPairedHost({
    ...shell,
    dial,
    hello: {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'cli',
      clientVersion: 'e2e',
      clientId,
    },
  });
}

async function connectClient(shell, clientId) {
  const remote = createRemoteHostTransport({
    entry: shell.entry,
    clientKeyPair: shell.secrets.clientKeyPair,
    createInnerSocket: innerSocket,
    createHello: (lastSeq) => ({
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'cli',
      clientVersion: 'e2e',
      clientId,
      lastSeq,
    }),
    transportOptions: { autoReconnect: true, heartbeatIntervalMs: 2_000 },
  });
  const client = new HostClient({
    transport: remote.transport,
    clientId,
    clientType: 'cli',
    clientVersion: 'e2e',
    deviceCredential: shell.secrets.credential,
  });
  clients.push(client);
  await client.connect();
  return client;
}

async function ok(client, command, timeoutMs = STEP_TIMEOUT_MS) {
  // Remote mutations need an idempotency key; one per call is enough here.
  const idempotencyKey = `e2e-${command.type}-${(requestCount += 1)}`;
  const response = await withTimeout(
    client.request(command, { idempotencyKey, timeoutMs }),
    timeoutMs,
    command.type,
  );
  assert(response.success, `${command.type} failed: ${response.error}`);
  return response;
}

/** The smoke proves the relay path, so the direct address is dropped. */
function relayOnly(link) {
  assert(link !== undefined, 'no v3 link');
  assert(link.relayUrl !== undefined, 'link has no relay address');
  const { directUrl: _direct, ...rest } = link;
  return rest;
}

async function startRelay({ relayPort, usersPath }) {
  const relay = startProcess(
    'relay',
    'apps/gateway/src/main.ts',
    ['serve', '--host', '127.0.0.1', '--port', String(relayPort), '--users', usersPath],
    { PIWIN_RELAY_ENROLL_TOKEN: ENROLL_TOKEN },
  );
  await relay.waitForLine((line) => line.startsWith('piwin-gateway:'));
  return relay;
}

async function runRelayAdmin(args, usersPath) {
  const admin = startProcess(
    'relay-admin',
    'apps/gateway/src/main.ts',
    [...args, '--users', usersPath],
    {},
  );
  const code = await admin.exited;
  assert(code === 0, `relay admin ${args.join(' ')} exited ${code}`);
  return admin.output();
}

function startProcess(name, entry, args, env) {
  const childEnv = { ...process.env, ...env };
  // Loopback only: a developer proxy must not intercept the relay socket.
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ]) {
    delete childEnv[key];
  }
  const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const lines = [];
  const waiters = new Set();
  const onData = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      lines.push(trimmed);
      if (process.env.PIWIN_E2E_VERBOSE === '1') console.log(`[${name}] ${trimmed}`);
      for (const waiter of waiters) waiter(trimmed);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exited = new Promise((resolve) =>
    child.once('exit', (code) => {
      children.delete(child);
      resolve(code);
    }),
  );
  return {
    exited,
    output: () => lines.join('\n'),
    waitForLine: (match) =>
      withTimeout(
        new Promise((resolve) => {
          const found = lines.find(match);
          if (found !== undefined) return resolve(found);
          const waiter = (line) => {
            if (!match(line)) return;
            waiters.delete(waiter);
            resolve(line);
          };
          waiters.add(waiter);
        }),
        STEP_TIMEOUT_MS,
        `${name} output\n${lines.slice(-20).join('\n')}`,
      ),
    stop: async () => {
      child.kill('SIGTERM');
      await exited;
    },
  };
}

async function retry(label, action) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HostHandshakeError) throw error;
      lastError = error;
      await delay(500);
    }
  }
  throw new Error(`${label} did not succeed: ${String(lastError)}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function step(message) {
  console.log(`e2e-relay-smoke: ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
