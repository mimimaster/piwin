import {
  decodeBase64Url,
  generateNoiseKeyPair,
  NoiseIkHandshake,
  packRelayFrame,
  remoteChannelPrologue,
} from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startRemoteAccessHost, type TestHost } from './remote-access-harness.fixture.js';

const hosts: TestHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
});

async function dial(url: string): Promise<{ socket: WebSocket; closed: Promise<number> }> {
  const socket = new WebSocket(url);
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, closed };
}

describe('direct channel endpoint (golden)', () => {
  it('closes 4404 for ids that are not this Host', async () => {
    const host = await startRemoteAccessHost();
    hosts.push(host);
    const target = host.access.migrationTarget();
    const wrongHost = `${host.url}/v1/u/${target.userId}/connect?hostId=${'A'.repeat(22)}`;
    const wrongUser = `${host.url}/v1/u/${'B'.repeat(22)}/connect?hostId=${target.hostId}`;
    const hostRoute = `${host.url}/v1/u/${target.userId}/host?hostId=${target.hostId}`;
    for (const url of [wrongHost, wrongUser, hostRoute]) {
      expect(await (await dial(url)).closed).toBe(4404);
    }
  });

  it('closes 4400 on a text frame', async () => {
    const host = await startRemoteAccessHost();
    hosts.push(host);
    const { socket, closed } = await dial(host.connectUrl);
    socket.send('hello');
    expect(await closed).toBe(4400);
  });

  it('closes 4007 when message 1 carries application data', async () => {
    const host = await startRemoteAccessHost();
    hosts.push(host);
    host.pairing.mintToken();
    const target = host.access.migrationTarget();
    const initiator = NoiseIkHandshake.initiator({
      prologue: remoteChannelPrologue(target.userId, target.hostId),
      staticKeyPair: generateNoiseKeyPair(),
      remoteStaticPublicKey: decodeBase64Url(target.hostKey) ?? new Uint8Array(),
    });
    const { socket, closed } = await dial(host.connectUrl);
    socket.send(packRelayFrame(0, initiator.writeMessage(Uint8Array.of(1, 2, 3))));
    expect(await closed).toBe(4007);
  });

  it('answers nothing and closes 4404 for an unknown key without a live code', async () => {
    const host = await startRemoteAccessHost();
    hosts.push(host);
    const target = host.access.migrationTarget();
    const initiator = NoiseIkHandshake.initiator({
      prologue: remoteChannelPrologue(target.userId, target.hostId),
      staticKeyPair: generateNoiseKeyPair(),
      remoteStaticPublicKey: decodeBase64Url(target.hostKey) ?? new Uint8Array(),
    });
    const { socket, closed } = await dial(host.connectUrl);
    const received: Buffer[] = [];
    socket.on('message', (data: Buffer) => received.push(data));
    socket.send(packRelayFrame(0, initiator.writeMessage()));
    expect(await closed).toBe(4404);
    expect(received).toEqual([]);
  });
});
