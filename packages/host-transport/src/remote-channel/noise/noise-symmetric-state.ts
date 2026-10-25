import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '../concat-bytes.js';
import { NoiseCipherState } from './noise-cipher-state.js';

const HASH_BYTES = 32;
const textEncoder = new TextEncoder();

/** Noise SymmetricState over SHA-256 (spec §5.2). */
export class NoiseSymmetricState {
  private chainingKey: Uint8Array;
  private hash: Uint8Array;
  private readonly cipher = new NoiseCipherState();

  public constructor(protocolName: string) {
    const name = textEncoder.encode(protocolName);
    let initial: Uint8Array;
    if (name.length <= HASH_BYTES) {
      initial = new Uint8Array(HASH_BYTES);
      initial.set(name);
    } else {
      initial = sha256(name);
    }
    this.hash = initial;
    this.chainingKey = initial.slice();
  }

  public get handshakeHash(): Uint8Array {
    return this.hash.slice();
  }

  public mixKey(inputKeyMaterial: Uint8Array): void {
    const [chainingKey, tempKey] = noiseHkdf(this.chainingKey, inputKeyMaterial);
    this.chainingKey = chainingKey;
    this.cipher.initializeKey(tempKey);
  }

  public mixHash(data: Uint8Array): void {
    this.hash = sha256(concatBytes(this.hash, data));
  }

  public encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encryptWithAd(this.hash, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  public decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decryptWithAd(this.hash, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  /** The two transport ciphers: [initiator→responder, responder→initiator]. */
  public split(): [NoiseCipherState, NoiseCipherState] {
    const [first, second] = noiseHkdf(this.chainingKey, new Uint8Array(0));
    return [new NoiseCipherState(first), new NoiseCipherState(second)];
  }
}

/** Noise HKDF with two outputs (spec §4.3), HMAC-SHA256. */
function noiseHkdf(
  chainingKey: Uint8Array,
  inputKeyMaterial: Uint8Array,
): [Uint8Array, Uint8Array] {
  const tempKey = hmac(sha256, chainingKey, inputKeyMaterial);
  const first = hmac(sha256, tempKey, Uint8Array.of(0x01));
  const second = hmac(sha256, tempKey, concatBytes(first, Uint8Array.of(0x02)));
  return [first, second];
}
