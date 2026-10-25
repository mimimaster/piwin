import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { decodeRelayControlFrame, parseRemoteChannelPath } from '@piwin/contracts';
import {
  createRelayChallengeNonce,
  generateNoiseKeyPair,
  rewriteRelayFramePeer,
  unpackRelayFrame,
  verifyRelayHostAuth,
} from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  channelTransport,
  startRemoteAccessHost,
  type TestHost,
} from './remote-access-harness.fixture.js';

/**
 * Minimal stand-in for apps/gateway (host-server may not depend on an app):
 * challenge + signature check, one Host, peer routing and peer-close.
 */
class StubRelay {
  public readonly hostConnections: Array<{ socket: WebSocket; enrollToken?: string }> = [];
  public url = '';
  public rejectAuth = false;
  private readonly server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  private host: WebSocket | undefined;
  private readonly peers = new Map<number, WebSocket>();
  private nextPeer = 1;

  public async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.once('listening', () => resolve()));
    this.url = `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    this.server.on('connection', (socket, request) => {
      const url = new URL(request.url ?? '/', 'http://relay');
      const path = parseRemoteChannelPath(url.pathname);
      const hostId = url.searchParams.get('hostId') ?? '';
      if (path?.route === 'host') this.acceptHost(socket, path.userId, hostId);
      else this.acceptPeer(socket);
    });
  }

  public dropHost(): void {
    this.host?.terminate();
  }

  public async stop(): Promise<void> {
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private acceptHost(socket: WebSocket, userId: string, hostId: string): void {
    const nonce = createRelayChallengeNonce();
    socket.send(JSON.stringify({ t: 'challenge', nonce }));
    let ready = false;
    socket.on('message', (data: RawData, isBinary: boolean) => {
      const bytes = Buffer.from(data as Buffer);
      if (!ready) {
        const frame = decodeRelayControlFrame(bytes.toString());
        if (
          frame?.t !== 'auth' ||
          !verifyRelayHostAuth(frame, { nonce, userId, hostId }).ok ||
          this.rejectAuth
        ) {
          socket.close(4401, 'host auth failed');
          return;
        }
        this.hostConnections.push({
          socket,
          ...(frame.enrollToken === undefined ? {} : { enrollToken: frame.enrollToken }),
        });
        ready = true;
        this.host = socket;
        socket.send(JSON.stringify({ t: 'ready' }));
        return;
      }
      if (!isBinary) {
        const control = decodeRelayControlFrame(bytes.toString());
        if (control?.t === 'peer-close')
          this.peers.get(control.peer)?.close(control.code, control.reason);
        return;
      }
      const frame = unpackRelayFrame(bytes);
      if (frame !== undefined) this.peers.get(frame.peer)?.send(bytes);
    });
  }

  private acceptPeer(socket: WebSocket): void {
    const peer = this.nextPeer++;
    this.peers.set(peer, socket);
    this.host?.send(JSON.stringify({ t: 'peer-joined', peer }));
    socket.on('message', (data: RawData) =>
      this.host?.send(rewriteRelayFramePeer(Buffer.from(data as Buffer), peer)),
    );
    socket.on('close', () => {
      this.peers.delete(peer);
      this.host?.send(JSON.stringify({ t: 'peer-left', peer }));
    });
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(): Promise<{ relay: StubRelay; host: TestHost; relayConnectUrl: string }> {
  const relay = new StubRelay();
  await relay.start();
  cleanups.push(() => relay.stop());
  const host = await startRemoteAccessHost({ relayUrl: relay.url });
  cleanups.push(() => host.close());
  const target = host.access.migrationTarget();
  return {
    relay,
    host,
    relayConnectUrl: `${relay.url}/v1/u/${target.userId}/connect?hostId=${target.hostId}`,
  };
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('RelayConnector through a relay (golden)', () => {
  it('authenticates to the relay and pairs a shell end to end through it', async () => {
    const { host, relayConnectUrl } = await setup();
    await until(() => host.access.status().relay.state === 'ready');
    const clientKey = generateNoiseKeyPair();
    const { token } = host.pairing.mintToken();
    const transport = channelTransport(
      host,
      { pairingToken: token },
      { clientKey, url: relayConnectUrl },
    );
    const hello = await transport.connect();
    expect(hello.deviceId).toBeDefined();
    await transport.close();
  });

  it('closes a revoked shell at the relay with peer-close', async () => {
    const { host, relayConnectUrl } = await setup();
    await until(() => host.access.status().relay.state === 'ready');
    const clientKey = generateNoiseKeyPair();
    const pairing = channelTransport(
      host,
      { pairingToken: host.pairing.mintToken().token },
      { clientKey, url: relayConnectUrl },
    );
    const { deviceId, deviceSecret } = await pairing.connect();
    await pairing.close();
    if (deviceId === undefined || deviceSecret === undefined) throw new Error('no credential');

    const transport = channelTransport(
      host,
      { deviceCredential: { deviceId, deviceSecret } },
      { clientKey, url: relayConnectUrl },
    );
    await transport.connect();
    const closed = new Promise<string>((resolve) =>
      transport.subscribeState((state) => {
        if (state.kind === 'closed' || state.kind === 'error') resolve(state.kind);
      }),
    );
    host.pairing.revoke(deviceId);
    host.server.disconnectDevice(deviceId, 'device revoked');
    await closed;
    await transport.close();
  });

  it('reconnects after the relay drops it', async () => {
    const { relay, host } = await setup();
    await until(() => relay.hostConnections.length === 1);
    relay.dropHost();
    await until(() => relay.hostConnections.length === 2);
    await until(() => host.access.status().relay.state === 'ready');
  });

  it('reports a rejected auth with its close code and keeps retrying', async () => {
    const relay = new StubRelay();
    relay.rejectAuth = true;
    await relay.start();
    cleanups.push(() => relay.stop());
    const host = await startRemoteAccessHost({ relayUrl: relay.url });
    cleanups.push(() => host.close());
    await until(() => host.access.status().relay.lastCloseCode === 4401);
    expect(host.access.status().relay.state).not.toBe('ready');
    relay.rejectAuth = false;
    await until(() => host.access.status().relay.state === 'ready');
  });

  it('sends the enroll token once and forgets it after the relay admits the Host', async () => {
    const { relay, host } = await setup();
    await until(() => host.access.status().relay.state === 'ready');
    await host.access.configure({
      type: 'host/remote-access-configure',
      relay: { enrollToken: 'enroll-token-0123456789' },
    });
    await until(() =>
      relay.hostConnections.some((connection) => connection.enrollToken !== undefined),
    );
    const settingsPath = join(host.root, 'devices', 'remote-access.json');
    await until(() => !readFileSync(settingsPath, 'utf8').includes('enroll-token'));
    expect(await readFile(settingsPath, 'utf8')).not.toContain('enroll-token');
  });

  it('turns the relay off on configure and reports it', async () => {
    const { host } = await setup();
    await until(() => host.access.status().relay.state === 'ready');
    const status = await host.access.configure({
      type: 'host/remote-access-configure',
      relay: { enabled: false },
    });
    expect(status.relay).toMatchObject({ enabled: false, state: 'off' });
  });
});
