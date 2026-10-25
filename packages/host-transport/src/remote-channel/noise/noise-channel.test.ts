import { describe, expect, it } from 'vitest';
import { RemoteChannelError, type RemoteChannelErrorReason } from '../remote-channel-error.js';
import { NOISE_MAX_PLAINTEXT_BYTES } from './noise-cipher-state.js';
import { NoiseChannel } from './noise-channel.js';
import { generateNoiseKeyPair, NoiseIkHandshake } from './noise-ik-handshake.js';

function channels(options: { clientRekey?: number; hostRekey?: number } = {}) {
  const hostStatic = generateNoiseKeyPair();
  const prologue = Uint8Array.of(1);
  const initiator = NoiseIkHandshake.initiator({
    prologue,
    staticKeyPair: generateNoiseKeyPair(),
    remoteStaticPublicKey: hostStatic.publicKey,
  });
  const responder = NoiseIkHandshake.responder({ prologue, staticKeyPair: hostStatic });
  responder.readMessage(initiator.writeMessage());
  initiator.readMessage(responder.writeMessage());
  return {
    client: new NoiseChannel(
      initiator.split(),
      options.clientRekey === undefined ? {} : { rekeyInterval: options.clientRekey },
    ),
    host: new NoiseChannel(
      responder.split(),
      options.hostRekey === undefined ? {} : { rekeyInterval: options.hostRekey },
    ),
  };
}

function expectReason(operation: () => unknown, reason: RemoteChannelErrorReason): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteChannelError);
    expect((error as RemoteChannelError).reason).toBe(reason);
    return;
  }
  throw new Error(`expected ${reason}`);
}

describe('NoiseChannel', () => {
  it('carries messages in both directions, up to the Noise plaintext limit', () => {
    const { client, host } = channels();
    const big = new Uint8Array(NOISE_MAX_PLAINTEXT_BYTES).fill(7);
    expect(host.decrypt(client.encrypt(big))).toEqual(big);
    expect(client.decrypt(host.encrypt(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('rejects an oversized plaintext and closes', () => {
    const { client } = channels();
    expectReason(
      () => client.encrypt(new Uint8Array(NOISE_MAX_PLAINTEXT_BYTES + 1)),
      'frame-too-large',
    );
    expect(client.isClosed).toBe(true);
  });

  it('fails and closes on a tampered message', () => {
    const { client, host } = channels();
    const ciphertext = client.encrypt(Uint8Array.of(1, 2, 3));
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    expectReason(() => host.decrypt(ciphertext), 'decrypt-failed');
    expect(host.isClosed).toBe(true);
    expectReason(() => host.decrypt(client.encrypt(Uint8Array.of(4))), 'channel-closed');
  });

  it('fails on a replayed message', () => {
    const { client, host } = channels();
    const ciphertext = client.encrypt(Uint8Array.of(1));
    host.decrypt(ciphertext);
    expectReason(() => host.decrypt(ciphertext), 'decrypt-failed');
  });

  it('fails on reordered messages', () => {
    const { client, host } = channels();
    client.encrypt(Uint8Array.of(1));
    const second = client.encrypt(Uint8Array.of(2));
    expectReason(() => host.decrypt(second), 'decrypt-failed');
  });

  it('fails on a truncated message', () => {
    const { client, host } = channels();
    expectReason(
      () => host.decrypt(client.encrypt(Uint8Array.of(1, 2)).subarray(0, 10)),
      'decrypt-failed',
    );
  });

  it('cannot decrypt its own direction (keys are split per direction)', () => {
    const { client } = channels();
    expectReason(() => client.decrypt(client.encrypt(Uint8Array.of(1))), 'decrypt-failed');
  });

  it('stays in sync across rekeys when both sides share the interval', () => {
    const { client, host } = channels({ clientRekey: 3, hostRekey: 3 });
    for (let index = 0; index < 20; index += 1) {
      expect(host.decrypt(client.encrypt(Uint8Array.of(index)))).toEqual(Uint8Array.of(index));
      expect(client.decrypt(host.encrypt(Uint8Array.of(index)))).toEqual(Uint8Array.of(index));
    }
  });

  it('desynchronizes when rekey schedules differ, proving rekey changes the key', () => {
    const { client, host } = channels({ clientRekey: 2, hostRekey: 3 });
    host.decrypt(client.encrypt(Uint8Array.of(1)));
    host.decrypt(client.encrypt(Uint8Array.of(2)));
    expectReason(() => host.decrypt(client.encrypt(Uint8Array.of(3))), 'decrypt-failed');
  });

  it('rejects a non-positive rekey interval', () => {
    expect(() => channels({ clientRekey: 0 })).toThrow(RangeError);
  });
});
