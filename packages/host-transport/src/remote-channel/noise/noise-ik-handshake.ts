import { x25519 } from '@noble/curves/ed25519.js';
import { concatBytes, copyBytes } from '../byte-arrays.js';
import { RemoteChannelError } from '../remote-channel-error.js';
import type { NoiseCipherState } from './noise-cipher-state.js';
import { NOISE_MAX_MESSAGE_BYTES, NOISE_TAG_BYTES } from './noise-cipher-state.js';
import { NoiseSymmetricState } from './noise-symmetric-state.js';

export const NOISE_IK_PROTOCOL_NAME = 'Noise_IK_25519_ChaChaPoly_SHA256';
export const NOISE_DH_BYTES = 32;

export type NoiseKeyPair = { secretKey: Uint8Array; publicKey: Uint8Array };

export type NoiseTransportCiphers = { send: NoiseCipherState; receive: NoiseCipherState };

type Role = 'initiator' | 'responder';
/** 0: message 1 pending, 1: message 2 pending, 2: complete, -1: failed. */
type Step = 0 | 1 | 2 | -1;

const ENCRYPTED_STATIC_BYTES = NOISE_DH_BYTES + NOISE_TAG_BYTES;

export function generateNoiseKeyPair(): NoiseKeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function noiseKeyPairFromSecret(secretKey: Uint8Array): NoiseKeyPair {
  if (secretKey.length !== NOISE_DH_BYTES) {
    throw new RemoteChannelError('handshake-failed', 'X25519 secret key must be 32 bytes');
  }
  return { secretKey: copyBytes(secretKey), publicKey: x25519.getPublicKey(secretKey) };
}

/**
 * `Noise_IK_25519_ChaChaPoly_SHA256` (spec §7.5):
 *
 * ```text
 *   <- s
 *   ...
 *   -> e, es, s, ss
 *   <- e, ee, se
 * ```
 *
 * The initiator (client) knows the responder's (Host's) static key in
 * advance. The responder learns the initiator's static key while reading
 * message 1 and can refuse before answering. Any failure poisons the
 * handshake; callers close the transport.
 *
 * `ephemeralKeyPair` exists for test vectors only; production generates one.
 */
export class NoiseIkHandshake {
  private readonly role: Role;
  private readonly state: NoiseSymmetricState;
  private readonly localStatic: NoiseKeyPair;
  private readonly localEphemeral: NoiseKeyPair;
  private remoteStatic: Uint8Array | undefined;
  private remoteEphemeral: Uint8Array | undefined;
  private step: Step = 0;

  private constructor(input: {
    role: Role;
    prologue: Uint8Array;
    staticKeyPair: NoiseKeyPair;
    remoteStaticPublicKey?: Uint8Array;
    ephemeralKeyPair?: NoiseKeyPair;
  }) {
    this.role = input.role;
    this.localStatic = input.staticKeyPair;
    this.localEphemeral = input.ephemeralKeyPair ?? generateNoiseKeyPair();
    this.remoteStatic =
      input.remoteStaticPublicKey === undefined
        ? undefined
        : copyBytes(input.remoteStaticPublicKey);
    this.state = new NoiseSymmetricState(NOISE_IK_PROTOCOL_NAME);
    this.state.mixHash(input.prologue);
    // Pre-message pattern `<- s`: both sides hash the responder's static key.
    const responderStatic =
      input.role === 'initiator' ? this.remoteStatic : this.localStatic.publicKey;
    if (responderStatic === undefined || responderStatic.length !== NOISE_DH_BYTES) {
      throw new RemoteChannelError('handshake-failed', 'IK requires the responder static key');
    }
    this.state.mixHash(responderStatic);
  }

  public static initiator(input: {
    prologue: Uint8Array;
    staticKeyPair: NoiseKeyPair;
    remoteStaticPublicKey: Uint8Array;
    ephemeralKeyPair?: NoiseKeyPair;
  }): NoiseIkHandshake {
    return new NoiseIkHandshake({ role: 'initiator', ...input });
  }

  public static responder(input: {
    prologue: Uint8Array;
    staticKeyPair: NoiseKeyPair;
    ephemeralKeyPair?: NoiseKeyPair;
  }): NoiseIkHandshake {
    return new NoiseIkHandshake({ role: 'responder', ...input });
  }

  public get isComplete(): boolean {
    return this.step === 2;
  }

  /** Initiator: known from the start. Responder: known after reading message 1. */
  public get remoteStaticPublicKey(): Uint8Array | undefined {
    return this.remoteStatic === undefined ? undefined : copyBytes(this.remoteStatic);
  }

  public get handshakeHash(): Uint8Array {
    return this.state.handshakeHash;
  }

  public writeMessage(payload: Uint8Array = new Uint8Array(0)): Uint8Array {
    return this.guard(() => {
      if (this.role === 'initiator' && this.step === 0) return this.writeInitiatorMessage(payload);
      if (this.role === 'responder' && this.step === 1) return this.writeResponderMessage(payload);
      throw new RemoteChannelError('handshake-failed', 'Noise handshake message out of order');
    });
  }

  public readMessage(message: Uint8Array): Uint8Array {
    return this.guard(() => {
      if (message.length > NOISE_MAX_MESSAGE_BYTES) {
        throw new RemoteChannelError('frame-too-large', 'Noise handshake message too large');
      }
      if (this.role === 'responder' && this.step === 0) return this.readInitiatorMessage(message);
      if (this.role === 'initiator' && this.step === 1) return this.readResponderMessage(message);
      throw new RemoteChannelError('handshake-failed', 'Noise handshake message out of order');
    });
  }

  /** Transport ciphers, available once the handshake completed. */
  public split(): NoiseTransportCiphers {
    if (this.step !== 2) {
      throw new RemoteChannelError('handshake-failed', 'Noise handshake is not complete');
    }
    const [initiatorToResponder, responderToInitiator] = this.state.split();
    return this.role === 'initiator'
      ? { send: initiatorToResponder, receive: responderToInitiator }
      : { send: responderToInitiator, receive: initiatorToResponder };
  }

  // -> e, es, s, ss
  private writeInitiatorMessage(payload: Uint8Array): Uint8Array {
    const remoteStatic = this.requireRemoteStatic();
    this.state.mixHash(this.localEphemeral.publicKey);
    this.state.mixKey(dh(this.localEphemeral.secretKey, remoteStatic));
    const encryptedStatic = this.state.encryptAndHash(this.localStatic.publicKey);
    this.state.mixKey(dh(this.localStatic.secretKey, remoteStatic));
    const encryptedPayload = this.state.encryptAndHash(payload);
    this.step = 1;
    return checkedMessage(
      concatBytes(this.localEphemeral.publicKey, encryptedStatic, encryptedPayload),
    );
  }

  private readInitiatorMessage(message: Uint8Array): Uint8Array {
    if (message.length < NOISE_DH_BYTES + ENCRYPTED_STATIC_BYTES + NOISE_TAG_BYTES) {
      throw new RemoteChannelError('handshake-failed', 'Noise message 1 is truncated');
    }
    const remoteEphemeral = message.subarray(0, NOISE_DH_BYTES);
    this.remoteEphemeral = copyBytes(remoteEphemeral);
    this.state.mixHash(remoteEphemeral);
    this.state.mixKey(dh(this.localStatic.secretKey, remoteEphemeral));
    const remoteStatic = this.state.decryptAndHash(
      message.subarray(NOISE_DH_BYTES, NOISE_DH_BYTES + ENCRYPTED_STATIC_BYTES),
    );
    this.remoteStatic = remoteStatic;
    this.state.mixKey(dh(this.localStatic.secretKey, remoteStatic));
    const payload = this.state.decryptAndHash(
      message.subarray(NOISE_DH_BYTES + ENCRYPTED_STATIC_BYTES),
    );
    this.step = 1;
    return payload;
  }

  // <- e, ee, se
  private writeResponderMessage(payload: Uint8Array): Uint8Array {
    const remoteEphemeral = this.requireRemoteEphemeral();
    this.state.mixHash(this.localEphemeral.publicKey);
    this.state.mixKey(dh(this.localEphemeral.secretKey, remoteEphemeral));
    this.state.mixKey(dh(this.localEphemeral.secretKey, this.requireRemoteStatic()));
    const encryptedPayload = this.state.encryptAndHash(payload);
    this.step = 2;
    return checkedMessage(concatBytes(this.localEphemeral.publicKey, encryptedPayload));
  }

  private readResponderMessage(message: Uint8Array): Uint8Array {
    if (message.length < NOISE_DH_BYTES + NOISE_TAG_BYTES) {
      throw new RemoteChannelError('handshake-failed', 'Noise message 2 is truncated');
    }
    const remoteEphemeral = message.subarray(0, NOISE_DH_BYTES);
    this.remoteEphemeral = copyBytes(remoteEphemeral);
    this.state.mixHash(remoteEphemeral);
    this.state.mixKey(dh(this.localEphemeral.secretKey, remoteEphemeral));
    this.state.mixKey(dh(this.localStatic.secretKey, remoteEphemeral));
    const payload = this.state.decryptAndHash(message.subarray(NOISE_DH_BYTES));
    this.step = 2;
    return payload;
  }

  private requireRemoteStatic(): Uint8Array {
    if (this.remoteStatic === undefined) {
      throw new RemoteChannelError('handshake-failed', 'Remote static key unknown');
    }
    return this.remoteStatic;
  }

  private requireRemoteEphemeral(): Uint8Array {
    if (this.remoteEphemeral === undefined) {
      throw new RemoteChannelError('handshake-failed', 'Remote ephemeral key unknown');
    }
    return this.remoteEphemeral;
  }

  private guard<T>(operation: () => T): T {
    if (this.step === -1) {
      throw new RemoteChannelError('handshake-failed', 'Noise handshake already failed');
    }
    try {
      return operation();
    } catch (error) {
      this.step = -1;
      if (error instanceof RemoteChannelError) {
        throw error.reason === 'decrypt-failed'
          ? new RemoteChannelError('handshake-failed', 'Noise handshake authentication failed')
          : error;
      }
      throw new RemoteChannelError('handshake-failed', 'Noise handshake failed');
    }
  }
}

/** X25519; noble rejects low-order points (all-zero shared secret) by throwing. */
function dh(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secretKey, publicKey);
}

function checkedMessage(message: Uint8Array): Uint8Array {
  if (message.length > NOISE_MAX_MESSAGE_BYTES) {
    throw new RemoteChannelError('frame-too-large', 'Noise handshake message too large');
  }
  return message;
}
