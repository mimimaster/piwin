import { describe, expect, it } from 'vitest';
import vector from './fixtures/noise-ik-25519-chachapoly-sha256.json' with { type: 'json' };
import { NoiseChannel } from './noise-channel.js';
import {
  NOISE_IK_PROTOCOL_NAME,
  NoiseIkHandshake,
  noiseKeyPairFromSecret,
} from './noise-ik-handshake.js';

/**
 * Golden: the published cacophony test vector for
 * Noise_IK_25519_ChaChaPoly_SHA256 (haskell-cryptography/cacophony,
 * vectors/cacophony.txt). Every handshake and transport byte must match.
 */
const hex = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'hex'));
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('Noise IK test vector', () => {
  it('names the vector protocol', () => {
    expect(vector.protocol_name).toBe(NOISE_IK_PROTOCOL_NAME);
  });

  it('reproduces every message and the handshake hash', () => {
    const responderStatic = noiseKeyPairFromSecret(hex(vector.resp_static));
    expect(toHex(responderStatic.publicKey)).toBe(vector.init_remote_static);

    const initiator = NoiseIkHandshake.initiator({
      prologue: hex(vector.init_prologue),
      staticKeyPair: noiseKeyPairFromSecret(hex(vector.init_static)),
      remoteStaticPublicKey: hex(vector.init_remote_static),
      ephemeralKeyPair: noiseKeyPairFromSecret(hex(vector.init_ephemeral)),
    });
    const responder = NoiseIkHandshake.responder({
      prologue: hex(vector.resp_prologue),
      staticKeyPair: responderStatic,
      ephemeralKeyPair: noiseKeyPairFromSecret(hex(vector.resp_ephemeral)),
    });

    const [first, second, ...transport] = vector.messages;
    if (first === undefined || second === undefined) throw new Error('vector has no handshake');

    const message1 = initiator.writeMessage(hex(first.payload));
    expect(toHex(message1)).toBe(first.ciphertext);
    expect(toHex(responder.readMessage(message1))).toBe(first.payload);
    expect(toHex(responder.remoteStaticPublicKey ?? new Uint8Array())).toBe(
      toHex(noiseKeyPairFromSecret(hex(vector.init_static)).publicKey),
    );

    const message2 = responder.writeMessage(hex(second.payload));
    expect(toHex(message2)).toBe(second.ciphertext);
    expect(toHex(initiator.readMessage(message2))).toBe(second.payload);

    expect(toHex(initiator.handshakeHash)).toBe(vector.handshake_hash);
    expect(toHex(responder.handshakeHash)).toBe(vector.handshake_hash);

    const initiatorChannel = new NoiseChannel(initiator.split());
    const responderChannel = new NoiseChannel(responder.split());
    transport.forEach((message, index) => {
      // After the handshake the vector keeps alternating, initiator first.
      const [sender, receiver] =
        index % 2 === 0
          ? [initiatorChannel, responderChannel]
          : [responderChannel, initiatorChannel];
      const ciphertext = sender.encrypt(hex(message.payload));
      expect(toHex(ciphertext)).toBe(message.ciphertext);
      expect(toHex(receiver.decrypt(ciphertext))).toBe(message.payload);
    });
  });
});
