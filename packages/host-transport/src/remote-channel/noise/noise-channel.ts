import { RemoteChannelError } from '../remote-channel-error.js';
import type { NoiseCipherState } from './noise-cipher-state.js';
import { NOISE_MAX_MESSAGE_BYTES, NOISE_MAX_PLAINTEXT_BYTES } from './noise-cipher-state.js';
import type { NoiseTransportCiphers } from './noise-ik-handshake.js';

/** ADR 0101 §4: both directions rekey every 2^20 messages. */
export const NOISE_REKEY_INTERVAL = 2 ** 20;

const EMPTY_AD = new Uint8Array(0);

/**
 * Post-handshake transport. Both peers rekey after the same message index, so
 * the schedule needs no signalling. The first failure closes the channel for
 * good: Noise nonces cannot skip, so a lost or forged message ends it.
 */
export class NoiseChannel {
  private readonly send: NoiseCipherState;
  private readonly receive: NoiseCipherState;
  private readonly rekeyInterval: number;
  private closed = false;

  public constructor(ciphers: NoiseTransportCiphers, options: { rekeyInterval?: number } = {}) {
    this.send = ciphers.send;
    this.receive = ciphers.receive;
    this.rekeyInterval = options.rekeyInterval ?? NOISE_REKEY_INTERVAL;
    if (!Number.isInteger(this.rekeyInterval) || this.rekeyInterval <= 0) {
      throw new RangeError('Noise rekey interval must be a positive integer');
    }
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  public encrypt(plaintext: Uint8Array): Uint8Array {
    this.assertOpen();
    if (plaintext.length > NOISE_MAX_PLAINTEXT_BYTES) {
      throw this.fail(new RemoteChannelError('frame-too-large', 'Noise plaintext too large'));
    }
    try {
      const ciphertext = this.send.encryptWithAd(EMPTY_AD, plaintext);
      this.maybeRekey(this.send);
      return ciphertext;
    } catch (error) {
      throw this.fail(error);
    }
  }

  public decrypt(ciphertext: Uint8Array): Uint8Array {
    this.assertOpen();
    if (ciphertext.length > NOISE_MAX_MESSAGE_BYTES) {
      throw this.fail(new RemoteChannelError('frame-too-large', 'Noise message too large'));
    }
    try {
      const plaintext = this.receive.decryptWithAd(EMPTY_AD, ciphertext);
      this.maybeRekey(this.receive);
      return plaintext;
    } catch (error) {
      throw this.fail(error);
    }
  }

  public close(): void {
    this.closed = true;
  }

  private maybeRekey(cipher: NoiseCipherState): void {
    if (cipher.messageCount % this.rekeyInterval === 0) {
      cipher.rekey();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new RemoteChannelError('channel-closed', 'Noise channel is closed');
    }
  }

  private fail(error: unknown): RemoteChannelError {
    this.closed = true;
    return error instanceof RemoteChannelError
      ? error
      : new RemoteChannelError('decrypt-failed', 'Noise channel failed');
  }
}
