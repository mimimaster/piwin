import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { RemoteChannelError } from '../remote-channel-error.js';

export const NOISE_KEY_BYTES = 32;
export const NOISE_TAG_BYTES = 16;
/** Noise caps every message (handshake or transport) at 65535 bytes. */
export const NOISE_MAX_MESSAGE_BYTES = 65_535;
export const NOISE_MAX_PLAINTEXT_BYTES = NOISE_MAX_MESSAGE_BYTES - NOISE_TAG_BYTES;

const NONCE_BYTES = 12;
/**
 * Noise allows nonces up to 2^64 - 2. JavaScript numbers count exactly to
 * 2^53 - 1, far beyond any connection's life, so that is the enforced ceiling.
 */
const MAX_NONCE = Number.MAX_SAFE_INTEGER;
const EMPTY = new Uint8Array(0);

/**
 * Noise CipherState for ChaChaPoly (spec §5.1). Without a key it passes data
 * through, which the handshake relies on before the first DH.
 */
export class NoiseCipherState {
  private key: Uint8Array | undefined;
  private nonce = 0;

  public constructor(key?: Uint8Array) {
    if (key !== undefined) {
      this.initializeKey(key);
    }
  }

  public hasKey(): boolean {
    return this.key !== undefined;
  }

  /** Messages processed so far with the current key schedule (rekey keeps counting). */
  public get messageCount(): number {
    return this.nonce;
  }

  public initializeKey(key: Uint8Array): void {
    if (key.length !== NOISE_KEY_BYTES) {
      throw new RemoteChannelError('handshake-failed', 'Noise cipher key must be 32 bytes');
    }
    this.key = key.slice();
    this.nonce = 0;
  }

  public encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    const key = this.key;
    if (key === undefined) {
      return plaintext.slice();
    }
    const nonce = this.takeNonce();
    return chacha20poly1305(key, encodeNonce(nonce), ad).encrypt(plaintext);
  }

  public decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const key = this.key;
    if (key === undefined) {
      return ciphertext.slice();
    }
    const nonce = this.takeNonce();
    try {
      return chacha20poly1305(key, encodeNonce(nonce), ad).decrypt(ciphertext);
    } catch {
      throw new RemoteChannelError('decrypt-failed', 'Noise message failed authentication');
    }
  }

  /** Spec §11.3: k = first 32 bytes of ENCRYPT(k, 2^64 - 1, empty, zeros). */
  public rekey(): void {
    const key = this.key;
    if (key === undefined) {
      throw new RemoteChannelError('channel-closed', 'Cannot rekey a cipher without a key');
    }
    const nonce = new Uint8Array(NONCE_BYTES);
    nonce.fill(0xff, 4);
    const next = chacha20poly1305(key, nonce, EMPTY).encrypt(new Uint8Array(NOISE_KEY_BYTES));
    this.key = next.slice(0, NOISE_KEY_BYTES);
  }

  private takeNonce(): number {
    if (this.nonce >= MAX_NONCE) {
      throw new RemoteChannelError('nonce-exhausted', 'Noise nonce space exhausted');
    }
    return this.nonce++;
  }
}

/** ChaChaPoly nonce: 32 zero bits then the counter as 64-bit little-endian. */
function encodeNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, counter % 0x1_0000_0000, true);
  view.setUint32(8, Math.floor(counter / 0x1_0000_0000), true);
  return nonce;
}
