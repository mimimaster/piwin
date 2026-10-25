import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { normalizeRemoteDisplayName } from './remote-identity.js';

const PREFIX = 'piwin-user-bundle:v1:';
const SALT_BYTES = 16;
const NONCE_BYTES = 24;
const KEY_BYTES = 32;
const ED25519_SECRET_BYTES = 32;

export type ScryptParams = { N: number; r: number; p: number };

/** ADR 0101 §3: scrypt N=2^17, r=8, p=1. */
export const RELAY_USER_BUNDLE_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

/** Bounds a bundle may claim, so opening one cannot be turned into a memory bomb. */
const MIN_LOG_N = 14;
const MAX_LOG_N = 20;

export type RelayUserBundleContents = { userSecretKey: Uint8Array; name: string };

export type RelayUserBundleErrorReason = 'malformed' | 'wrong-passphrase';

export class RelayUserBundleError extends Error {
  public readonly name = 'RelayUserBundleError';
  public constructor(
    public readonly reason: RelayUserBundleErrorReason,
    message: string,
  ) {
    super(message);
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Seals a relay user key with a passphrase so its owner can copy it to another
 * of their Hosts (`piwin relay user export`). The prefix is bound as AAD.
 */
export async function sealRelayUserBundle(
  contents: RelayUserBundleContents,
  passphrase: string,
  params: ScryptParams = RELAY_USER_BUNDLE_SCRYPT,
): Promise<string> {
  if (contents.userSecretKey.length !== ED25519_SECRET_BYTES) {
    throw new Error('Relay user secret key must be 32 bytes');
  }
  const name = normalizeRemoteDisplayName(contents.name);
  if (name === undefined) {
    throw new Error('Relay user name is empty');
  }
  assertParams(params);
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = await deriveKey(passphrase, salt, params);
  const plaintext = textEncoder.encode(
    JSON.stringify({ k: encodeBase64Url(contents.userSecretKey), n: name }),
  );
  const ciphertext = xchacha20poly1305(key, nonce, textEncoder.encode(PREFIX)).encrypt(plaintext);
  const envelope = {
    v: 1,
    kdf: 'scrypt',
    ...params,
    salt: encodeBase64Url(salt),
    nonce: encodeBase64Url(nonce),
    ct: encodeBase64Url(ciphertext),
  };
  return `${PREFIX}${encodeBase64Url(textEncoder.encode(JSON.stringify(envelope)))}`;
}

export async function openRelayUserBundle(
  bundle: string,
  passphrase: string,
): Promise<RelayUserBundleContents> {
  const envelope = parseEnvelope(bundle.trim());
  const key = await deriveKey(passphrase, envelope.salt, envelope.params);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, envelope.nonce, textEncoder.encode(PREFIX)).decrypt(
      envelope.ciphertext,
    );
  } catch {
    throw new RelayUserBundleError('wrong-passphrase', 'Wrong passphrase or damaged bundle');
  }
  let contents: unknown;
  try {
    contents = JSON.parse(textDecoder.decode(plaintext));
  } catch {
    throw new RelayUserBundleError('malformed', 'Bundle contents are not valid');
  }
  const record = contents as { k?: unknown; n?: unknown };
  const userSecretKey = typeof record.k === 'string' ? decodeBase64Url(record.k) : undefined;
  const name = typeof record.n === 'string' ? normalizeRemoteDisplayName(record.n) : undefined;
  if (userSecretKey?.length !== ED25519_SECRET_BYTES || name === undefined) {
    throw new RelayUserBundleError('malformed', 'Bundle contents are not valid');
  }
  return { userSecretKey, name };
}

function parseEnvelope(bundle: string): {
  params: ScryptParams;
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
} {
  const malformed = (): RelayUserBundleError =>
    new RelayUserBundleError('malformed', 'Not a piwin user bundle');
  if (!bundle.startsWith(PREFIX)) throw malformed();
  const json = decodeBase64Url(bundle.slice(PREFIX.length));
  if (json === undefined) throw malformed();
  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(json));
  } catch {
    throw malformed();
  }
  const record = value as Record<string, unknown>;
  const params = { N: record.N, r: record.r, p: record.p };
  const salt = typeof record.salt === 'string' ? decodeBase64Url(record.salt) : undefined;
  const nonce = typeof record.nonce === 'string' ? decodeBase64Url(record.nonce) : undefined;
  const ciphertext = typeof record.ct === 'string' ? decodeBase64Url(record.ct) : undefined;
  if (
    record.v !== 1 ||
    record.kdf !== 'scrypt' ||
    !isScryptParams(params) ||
    salt?.length !== SALT_BYTES ||
    nonce?.length !== NONCE_BYTES ||
    ciphertext === undefined
  ) {
    throw malformed();
  }
  return { params, salt, nonce, ciphertext };
}

function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: ScryptParams,
): Promise<Uint8Array> {
  if (passphrase.length === 0) {
    throw new RelayUserBundleError('wrong-passphrase', 'A passphrase is required');
  }
  return scryptAsync(textEncoder.encode(passphrase.normalize('NFC')), salt, {
    ...params,
    dkLen: KEY_BYTES,
    maxmem: 2 ** 31,
  });
}

function isScryptParams(value: { N: unknown; r: unknown; p: unknown }): value is ScryptParams {
  if (typeof value.N !== 'number' || value.r !== 8 || value.p !== 1) return false;
  const logN = Math.log2(value.N);
  return Number.isInteger(logN) && logN >= MIN_LOG_N && logN <= MAX_LOG_N;
}

function assertParams(params: ScryptParams): void {
  if (!isScryptParams(params)) {
    throw new Error(
      `scrypt N must be a power of two between 2^${MIN_LOG_N} and 2^${MAX_LOG_N}, r=8, p=1`,
    );
  }
}
