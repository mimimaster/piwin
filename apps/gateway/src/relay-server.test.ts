import { REMOTE_CHANNEL_CLOSE, REMOTE_CHANNEL_MAX_FRAME_BYTES } from '@piwin/contracts';
import { packRelayFrame, unpackRelayFrame } from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectHost,
  connectReadyHost,
  connectUrl,
  createTestIdentity,
  ENROLL_TOKEN,
  hostUrl,
  openProbe,
  startTestRelay,
  waitFor,
  type TestRelay,
} from './relay-harness.fixture.js';

const relays: TestRelay[] = [];

async function relay(options: Parameters<typeof startTestRelay>[0] = {}): Promise<TestRelay> {
  const started = await startTestRelay(options);
  relays.push(started);
  return started;
}

afterEach(async () => {
  for (const started of relays.splice(0)) {
    await started.close();
  }
});

describe('relay HTTP surface', () => {
  it('answers /healthz and 404s / without a web root', async () => {
    const { url } = await relay();
    const base = url.replace('ws://', 'http://');
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('refuses upgrades on malformed channel paths with 400', async () => {
    const { url } = await relay();
    const identity = createTestIdentity();
    for (const path of ['/v1/u/short/connect?hostId=x', `/v1/u/${identity.userId}/connect`, '/']) {
      await expect(openProbe(`${url}${path}`).opened).rejects.toThrow('HTTP 400');
    }
  });

  it('rate-limits upgrades per client IP with 429', async () => {
    const { url } = await relay({ limits: { connectionsPerIpPerWindow: 1 } });
    const identity = createTestIdentity();
    const first = openProbe(connectUrl(url, identity));
    await first.opened;
    await expect(openProbe(connectUrl(url, identity)).opened).rejects.toThrow('HTTP 429');
  });
});

describe('Host authentication', () => {
  it('admits a registered user whose Host signs the challenge', async () => {
    const identity = createTestIdentity();
    const { url, events } = await relay({ registered: [identity] });
    await connectReadyHost(url, identity);
    expect(events.some((event) => event.kind === 'host-ready')).toBe(true);
  });

  it('closes 4401 for an unregistered user without a valid enroll token', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ enroll: true });
    const host = await connectHost(url, identity, { enrollToken: 'wrong-token-0123456789' });
    expect((await host.closed).code).toBe(REMOTE_CHANNEL_CLOSE.hostAuthFailed);
  });

  it('self-enrolls with the enroll token, records the name and persists', async () => {
    const identity = createTestIdentity();
    const { url, registry, saves } = await relay({ enroll: true });
    const host = await connectHost(url, identity, {
      enrollToken: ENROLL_TOKEN,
      userName: ' Yorick ',
    });
    await waitFor(() => host.texts.find((frame) => frame.t === 'ready'), host);
    expect(registry.find(identity.userId)).toMatchObject({ name: 'Yorick', disabled: false });
    expect(saves()).toBe(1);
  });

  it('does not admit the user when the enrollment cannot be saved', async () => {
    const identity = createTestIdentity();
    const { url, registry } = await relay({ enroll: true, failSave: true });
    const host = await connectHost(url, identity, { enrollToken: ENROLL_TOKEN });
    expect((await host.closed).code).toBe(REMOTE_CHANNEL_CLOSE.hostAuthFailed);
    expect(registry.find(identity.userId)).toBeUndefined();
  });

  it('closes 4401 when the signature does not come from the claimed keys', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    const host = await connectHost(url, identity, {
      signAs: createTestIdentity(identity.userSecretKey),
    });
    expect((await host.closed).code).toBe(REMOTE_CHANNEL_CLOSE.hostAuthFailed);
  });

  it('closes 4403 for a disabled user or a denied Host', async () => {
    const disabled = createTestIdentity();
    const denied = createTestIdentity();
    const { url, registry } = await relay({ registered: [disabled, denied] });
    registry.setDisabled(disabled.userId, true);
    registry.setHostDenied(denied.hostId, true);
    expect((await (await connectHost(url, disabled)).closed).code).toBe(
      REMOTE_CHANNEL_CLOSE.forbidden,
    );
    expect((await (await connectHost(url, denied)).closed).code).toBe(
      REMOTE_CHANNEL_CLOSE.forbidden,
    );
  });

  it('closes 4429 past the per-user Host limit, but still lets a Host replace itself', async () => {
    const first = createTestIdentity();
    const second = createTestIdentity(first.userSecretKey);
    const { url } = await relay({ registered: [first], limits: { defaultMaxHosts: 1 } });
    await connectReadyHost(url, first);
    expect((await (await connectHost(url, second)).closed).code).toBe(REMOTE_CHANNEL_CLOSE.limited);
    await connectReadyHost(url, first);
  });

  it('closes 4401 when the Host never answers the challenge', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity], limits: { hostAuthTimeoutMs: 50 } });
    const probe = openProbe(hostUrl(url, identity));
    expect((await probe.closed).code).toBe(REMOTE_CHANNEL_CLOSE.hostAuthFailed);
  });

  it('closes 4400 on a second message before ready', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    const host = await connectHost(url, identity);
    host.socket.send('{"t":"ready"}');
    const closed = await host.closed;
    expect([REMOTE_CHANNEL_CLOSE.badRequest, 1000]).toContain(closed.code);
  });
});

describe('peer routing', () => {
  it('rejects a client with the same 4404 whether the user, Host or match is wrong', async () => {
    const identity = createTestIdentity();
    const otherUser = createTestIdentity();
    const { url } = await relay({ registered: [identity, otherUser] });
    await connectReadyHost(url, identity);
    const cases = [
      { userId: createTestIdentity().userId, hostId: identity.hostId },
      { userId: identity.userId, hostId: createTestIdentity().hostId },
      { userId: otherUser.userId, hostId: identity.hostId },
    ];
    const results = await Promise.all(
      cases.map(async (ids) => await openProbe(connectUrl(url, ids)).closed),
    );
    for (const result of results) {
      expect(result).toEqual({ code: REMOTE_CHANNEL_CLOSE.unavailable, reason: 'unavailable' });
    }
  });

  it('announces peers, routes both ways and stamps the assigned peer id', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    const host = await connectReadyHost(url, identity);
    const client = openProbe(connectUrl(url, identity));
    await client.opened;
    const joined = await waitFor(() => host.texts.find((frame) => frame.t === 'peer-joined'), host);
    if (joined.t !== 'peer-joined') throw new Error('unexpected frame');

    client.socket.send(packRelayFrame(999, Uint8Array.of(1, 2, 3)));
    const atHost = await waitFor(() => host.binaries[0], host);
    expect(unpackRelayFrame(atHost)).toEqual({
      peer: joined.peer,
      payload: Uint8Array.of(1, 2, 3),
    });

    host.socket.send(packRelayFrame(joined.peer, Uint8Array.of(9)));
    const atClient = await waitFor(() => client.binaries[0], client);
    expect(unpackRelayFrame(atClient)).toEqual({ peer: joined.peer, payload: Uint8Array.of(9) });

    client.socket.close();
    const left = await waitFor(() => host.texts.find((frame) => frame.t === 'peer-left'), host);
    expect(left).toEqual({ t: 'peer-left', peer: joined.peer });
  });

  it('lets a Host close one of its peers with peer-close, and only its own', async () => {
    const identity = createTestIdentity();
    const other = createTestIdentity();
    const { url } = await relay({ registered: [identity, other] });
    const host = await connectReadyHost(url, identity);
    const otherHost = await connectReadyHost(url, other);
    const client = openProbe(connectUrl(url, identity));
    await client.opened;
    const otherClient = openProbe(connectUrl(url, other));
    await otherClient.opened;
    const joined = await waitFor(() => host.texts.find((frame) => frame.t === 'peer-joined'), host);
    if (joined.t !== 'peer-joined') throw new Error('unexpected frame');
    // Same peer number in another room must not be reachable.
    otherHost.socket.send(JSON.stringify({ t: 'peer-close', peer: 999, code: 4004 }));
    host.socket.send(
      JSON.stringify({ t: 'peer-close', peer: joined.peer, code: 4004, reason: 'revoked' }),
    );
    expect(await client.closed).toEqual({ code: 4004, reason: 'revoked' });
    expect(otherClient.socket.readyState).toBe(otherClient.socket.OPEN);
    host.socket.send('{"t":"ready"}');
    expect((await host.closed).code).toBe(REMOTE_CHANNEL_CLOSE.badRequest);
  });

  it('closes a Host that tries to broadcast to peer 0', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    const host = await connectReadyHost(url, identity);
    host.socket.send(packRelayFrame(0, Uint8Array.of(1)));
    expect((await host.closed).code).toBe(REMOTE_CHANNEL_CLOSE.badRequest);
  });

  it('closes 4400 for client text and 4413 for oversized frames', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    await connectReadyHost(url, identity);
    const talker = openProbe(connectUrl(url, identity));
    await talker.opened;
    talker.socket.send('hello');
    expect((await talker.closed).code).toBe(REMOTE_CHANNEL_CLOSE.badRequest);
    const big = openProbe(connectUrl(url, identity));
    await big.opened;
    big.socket.send(new Uint8Array(REMOTE_CHANNEL_MAX_FRAME_BYTES + 1));
    expect((await big.closed).code).toBe(REMOTE_CHANNEL_CLOSE.frameTooLarge);
  });

  it('closes 4429 when a Host has too many peers', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity], limits: { defaultMaxPeersPerHost: 1 } });
    await connectReadyHost(url, identity);
    await openProbe(connectUrl(url, identity)).opened;
    expect((await openProbe(connectUrl(url, identity)).closed).code).toBe(
      REMOTE_CHANNEL_CLOSE.limited,
    );
  });

  it('closes peers with 4404 when their Host goes away', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    const host = await connectReadyHost(url, identity);
    const client = openProbe(connectUrl(url, identity));
    await client.opened;
    host.socket.close();
    expect((await client.closed).code).toBe(REMOTE_CHANNEL_CLOSE.unavailable);
  });

  it('replaces a reconnecting Host: old socket 4409, its peers 4404', async () => {
    const identity = createTestIdentity();
    const { url } = await relay({ registered: [identity] });
    const oldHost = await connectReadyHost(url, identity);
    const client = openProbe(connectUrl(url, identity));
    await client.opened;
    await connectReadyHost(url, identity);
    expect((await oldHost.closed).code).toBe(REMOTE_CHANNEL_CLOSE.replaced);
    expect(oldHost.texts.some((frame) => frame.t === 'host-replaced')).toBe(true);
    expect((await client.closed).code).toBe(REMOTE_CHANNEL_CLOSE.unavailable);
  });
});

describe('registry reconcile', () => {
  it('closes a live Host and its peers after its user is disabled', async () => {
    const identity = createTestIdentity();
    const { url, registry, server } = await relay({ registered: [identity] });
    const host = await connectReadyHost(url, identity);
    const client = openProbe(connectUrl(url, identity));
    await client.opened;
    registry.setDisabled(identity.userId, true);
    server.reconcileRegistry();
    expect((await host.closed).code).toBe(REMOTE_CHANNEL_CLOSE.forbidden);
    expect((await client.closed).code).toBe(REMOTE_CHANNEL_CLOSE.unavailable);
  });
});
