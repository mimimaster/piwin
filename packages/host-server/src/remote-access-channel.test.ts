import {
  generateNoiseKeyPair,
  HostHandshakeError,
  parsePairingLinkV3,
} from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceRoleOf } from './device-pairing.js';
import { mintPairingCode } from './pairing-operations.js';
import {
  channelKeyOf,
  channelTransport,
  DOOR_TOKEN,
  legacyClient,
  request,
  startRemoteAccessHost,
  type TestHost,
} from './remote-access-harness.fixture.js';

const hosts: TestHost[] = [];
async function host(options: Parameters<typeof startRemoteAccessHost>[0] = {}): Promise<TestHost> {
  const started = await startRemoteAccessHost(options);
  hosts.push(started);
  return started;
}
afterEach(async () => {
  for (const started of hosts.splice(0)) await started.close();
});

let installations = 0;

/** Pairs a fresh installation over the direct channel; returns its key and credential. */
async function pairOverChannel(target: TestHost, role: 'member' | 'operator' = 'member') {
  const clientKey = generateNoiseKeyPair();
  const clientId = `client-${role}-${(installations += 1)}`;
  const { token } = target.pairing.mintToken(role);
  const transport = channelTransport(target, { pairingToken: token }, { clientKey, clientId });
  const hostHello = await transport.connect();
  await transport.close();
  if (hostHello.deviceId === undefined || hostHello.deviceSecret === undefined) {
    throw new Error('pairing did not issue a credential');
  }
  return {
    clientKey,
    credential: { deviceId: hostHello.deviceId, deviceSecret: hostHello.deviceSecret },
  };
}

describe('ADR 0101 channel admission (golden)', () => {
  it('pairs over the direct channel and binds the handshake key to the device', async () => {
    const target = await host();
    const { clientKey, credential } = await pairOverChannel(target);
    const device = target.pairing.list().find((entry) => entry.id === credential.deviceId);
    expect(device?.channelPublicKey).toBe(channelKeyOf(clientKey));
    expect(deviceRoleOf(device ?? {})).toBe('member');
  });

  it('mints pairing codes whose v3 link points at this Host', async () => {
    const target = await host();
    const code = await mintPairingCode(
      { pairing: target.pairing, store: undefined },
      {
        advertisedEndpoint: target.url,
        hostInstanceId: 'h',
        channelLinks: target.access.channelLinks,
      },
    );
    const link = parsePairingLinkV3(code.channelUri ?? '');
    expect(link).toMatchObject({
      ...target.access.migrationTarget(),
      directUrl: target.url,
      pairingToken: code.pairingToken,
      role: 'member',
    });
    expect(code.webUri).toBeUndefined();
  });

  it('reconnects with the credential and the same key', async () => {
    const target = await host();
    const { clientKey, credential } = await pairOverChannel(target);
    const transport = channelTransport(
      target,
      { deviceCredential: credential },
      { clientKey: clientKey },
    );
    expect((await transport.connect()).deviceId).toBe(credential.deviceId);
    await transport.close();
  });

  it('refuses the credential under a different key (a stolen credential is not enough)', async () => {
    const target = await host();
    const { credential } = await pairOverChannel(target);
    target.pairing.mintToken(); // a live code makes the Host answer the handshake
    const transport = channelTransport(target, { deviceCredential: credential });
    await expect(transport.connect()).rejects.toMatchObject({
      reason: 'device-credential-revoked',
    });
  });

  it('drops an unknown key before answering when no code is live (early drop)', async () => {
    const target = await host();
    const transport = channelTransport(target, { pairingToken: 'guess' });
    const error = await transport.connect().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HostHandshakeError);
    expect(String(error)).toContain('4404');
  });

  it('never accepts the token door or an anonymous hello on the channel', async () => {
    const target = await host({ authToken: DOOR_TOKEN });
    target.pairing.mintToken();
    await expect(
      channelTransport(target, { authToken: DOOR_TOKEN }).connect(),
    ).rejects.toMatchObject({
      reason: 'authentication-failed',
    });
    await expect(channelTransport(target, {}).connect()).rejects.toMatchObject({
      reason: 'pairing-required',
    });
  });

  it('closes a live channel when its device is revoked', async () => {
    const target = await host();
    const { clientKey, credential } = await pairOverChannel(target);
    const transport = channelTransport(
      target,
      { deviceCredential: credential },
      { clientKey: clientKey },
    );
    await transport.connect();
    const closed = new Promise<void>((resolve) =>
      transport.subscribeState((state) => {
        if (state.kind === 'closed' || state.kind === 'error') resolve();
      }),
    );
    target.pairing.revoke(credential.deviceId);
    target.server.disconnectDevice(credential.deviceId, 'device revoked');
    await closed;
    await transport.close();
  });

  it('serves commands over the channel and gates management by role', async () => {
    const target = await host();
    const member = await pairOverChannel(target, 'member');
    const operator = await pairOverChannel(target, 'operator');

    const memberTransport = channelTransport(
      target,
      { deviceCredential: member.credential },
      { clientKey: member.clientKey },
    );
    await memberTransport.connect();
    expect(await request(memberTransport, { type: 'session/list' } as never)).toMatchObject({
      type: 'response',
      response: { success: true },
    });
    expect(
      await request(memberTransport, { type: 'host/relay-user-enrollment-line' }),
    ).toMatchObject({ response: { success: false, error: expect.stringContaining('operator') } });
    expect(await request(memberTransport, { type: 'host/pairing-create-code' })).toMatchObject({
      response: { success: false },
    });
    await memberTransport.close();

    const operatorTransport = channelTransport(
      target,
      { deviceCredential: operator.credential },
      { clientKey: operator.clientKey },
    );
    await operatorTransport.connect();
    expect(
      await request(operatorTransport, { type: 'host/relay-user-enrollment-line' }),
    ).toMatchObject({
      response: { success: true, data: { line: expect.stringMatching(/^piwin-user:v1:/) } },
    });
    const status = await request(operatorTransport, { type: 'host/pairing-status' });
    expect(status).toMatchObject({
      response: {
        success: true,
        data: { canManage: true, remote: { hostName: 'Test Host', legacyAccess: 'full' } },
      },
    });
    await operatorTransport.close();
  });
});

describe('ADR 0101 legacy access and migration (golden)', () => {
  it('full: a legacy device keeps working unchanged', async () => {
    const target = await host({ legacyAccess: 'full' });
    const { credential } = target.pairing.completePairing(
      target.pairing.mintToken().token,
      'Old phone',
    );
    const client = await legacyClient(target, { deviceCredential: credential });
    expect(await client.hello()).toMatchObject({
      type: 'host/hello',
      deviceId: credential.deviceId,
    });
    expect(await client.request({ type: 'session/list' } as never)).toMatchObject({
      type: 'response',
    });
    client.socket.close();
  });

  it('off: a legacy hello is refused with secure-channel-required', async () => {
    const target = await host({ legacyAccess: 'off' });
    const { credential } = target.pairing.completePairing(target.pairing.mintToken().token);
    const client = await legacyClient(target, { deviceCredential: credential });
    expect(await client.hello()).toMatchObject({
      type: 'error',
      reason: 'secure-channel-required',
    });
    expect((await client.closed).code).toBe(4004);
  });

  it('migrate-only: only migration is served, then the device works on the channel', async () => {
    const target = await host({ legacyAccess: 'migrate-only' });
    const { credential } = target.pairing.completePairing(
      target.pairing.mintToken().token,
      'Old phone',
    );
    const client = await legacyClient(target, { deviceCredential: credential });
    expect(await client.hello()).toMatchObject({ type: 'host/hello' });
    expect(await client.request({ type: 'session/list' } as never)).toMatchObject({
      type: 'error',
      code: 'command-not-allowed',
      message: expect.stringContaining('secure-channel-required'),
    });

    const newKey = generateNoiseKeyPair();
    const migrated = await client.request({
      type: 'host/channel-migrate',
      channelPublicKey: channelKeyOf(newKey),
      clientId: 'legacy-client',
    });
    expect(migrated).toMatchObject({
      type: 'response',
      response: { success: true, data: { ...target.access.migrationTarget(), role: 'member' } },
    });
    // A device-credential caller keeps its credential; none is issued.
    expect(migrated).not.toHaveProperty('response.data.credential');
    client.socket.close();

    const transport = channelTransport(
      target,
      { deviceCredential: credential },
      { clientKey: newKey },
    );
    expect((await transport.connect()).deviceId).toBe(credential.deviceId);
    await transport.close();
    expect(target.runtime.commands.map((command) => command.type)).toEqual([]);
  });

  it('refuses re-binding a migrated device to another key', async () => {
    const target = await host({ legacyAccess: 'full' });
    const { credential } = target.pairing.completePairing(target.pairing.mintToken().token);
    const client = await legacyClient(target, { deviceCredential: credential });
    await client.hello();
    const first = channelKeyOf(generateNoiseKeyPair());
    await client.request({ type: 'host/channel-migrate', channelPublicKey: first, clientId: 'c' });
    expect(
      await client.request({
        type: 'host/channel-migrate',
        channelPublicKey: first,
        clientId: 'c',
      }),
    ).toMatchObject({ response: { success: true } });
    expect(
      await client.request({
        type: 'host/channel-migrate',
        channelPublicKey: channelKeyOf(generateNoiseKeyPair()),
        clientId: 'c',
      }),
    ).toMatchObject({
      response: { success: false, error: expect.stringContaining('another key') },
    });
    client.socket.close();
  });

  it('migrates a token-door caller into an operator device with a one-time credential', async () => {
    const target = await host({ authToken: DOOR_TOKEN });
    const client = await legacyClient(target, { authToken: DOOR_TOKEN });
    expect(await client.hello()).toMatchObject({ type: 'host/hello' });
    const newKey = generateNoiseKeyPair();
    const migrated = await client.request({
      type: 'host/channel-migrate',
      channelPublicKey: channelKeyOf(newKey),
      clientId: 'thin-shell',
      deviceName: 'MacBook',
    });
    client.socket.close();
    if (migrated.type !== 'response') throw new Error('migration failed');
    const response = migrated.response;
    if (!response.success) throw new Error(response.error);
    const data = response.data as {
      credential: { deviceId: string; deviceSecret: string };
      role: string;
    };
    expect(data.role).toBe('operator');

    const transport = channelTransport(
      target,
      { deviceCredential: data.credential },
      { clientKey: newKey },
    );
    await transport.connect();
    expect(
      await request(transport, { type: 'host/pairing-create-code', role: 'operator' }),
    ).toMatchObject({
      response: { success: true },
    });
    await transport.close();
  });

  it('does not migrate a connection that is already on the channel', async () => {
    const target = await host();
    const { clientKey, credential } = await pairOverChannel(target);
    const transport = channelTransport(
      target,
      { deviceCredential: credential },
      { clientKey: clientKey },
    );
    await transport.connect();
    expect(
      await request(transport, {
        type: 'host/channel-migrate',
        channelPublicKey: channelKeyOf(clientKey),
        clientId: 'c',
      }),
    ).toMatchObject({ response: { success: false, error: expect.stringContaining('Already') } });
    await transport.close();
  });
});

describe('ADR 0101 endpoints for host books', () => {
  it('sends endpoints on hello and pushes a change to live channel clients', async () => {
    const target = await host();
    const { clientKey, credential } = await pairOverChannel(target);
    const transport = channelTransport(target, { deviceCredential: credential }, { clientKey });
    const hostHello = await transport.connect();
    expect(hostHello.endpoints).toEqual(target.access.endpoints());
    expect(hostHello.endpoints).not.toHaveProperty('hostKey');

    const pushed = new Promise<unknown>((resolve) =>
      transport.subscribe((message) => {
        if (message.type === 'host/endpoints') resolve(message.endpoints);
      }),
    );
    await target.access.renameUser('Renamed Owner');
    expect(await pushed).toMatchObject({ userName: 'Renamed Owner', hostName: 'Test Host' });
    await transport.close();
  });
});
