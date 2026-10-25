import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { RelayHostAuthFrame } from '@piwin/contracts';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { concatBytes } from './byte-arrays.js';
import { deriveHostId, deriveUserId } from './remote-identity.js';

const AUTH_DOMAIN = 'piwin-relay-v1\0host\0';
const NONCE_BYTES = 32;
const ED25519_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const textEncoder = new TextEncoder();

export type RelayHostAuthFailure =
  | 'malformed'
  | 'user-id-mismatch'
  | 'host-id-mismatch'
  | 'bad-host-signature'
  | 'bad-user-signature';

export type RelayHostAuthVerdict =
  | { ok: true; hostPublicKey: Uint8Array; userPublicKey: Uint8Array }
  | { ok: false; reason: RelayHostAuthFailure };

/** A new Ed25519 secret key for a Host signing key or a relay user key. */
export function generateRelaySigningSecretKey(): Uint8Array {
  return ed25519.utils.randomSecretKey();
}

export function relaySigningPublicKey(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

/** A fresh challenge nonce, base64url (ADR 0101 §7). */
export function createRelayChallengeNonce(): string {
  return encodeBase64Url(randomBytes(NONCE_BYTES));
}

/** Bytes both signatures cover: domain ‖ nonce ‖ userId ‖ hostId. */
export function relayHostAuthMessage(nonce: string, userId: string, hostId: string): Uint8Array {
  const nonceBytes = decodeBase64Url(nonce);
  if (nonceBytes === undefined || nonceBytes.length !== NONCE_BYTES) {
    throw new Error('Relay challenge nonce must be 32 bytes of base64url');
  }
  return concatBytes(
    textEncoder.encode(AUTH_DOMAIN),
    nonceBytes,
    textEncoder.encode(userId),
    textEncoder.encode(hostId),
  );
}

/**
 * Host side: answer a relay challenge. The Host proves both `hostId` (its
 * signing key) and membership of `userId` (the user key it holds).
 */
export function signRelayHostAuth(input: {
  nonce: string;
  hostSigningSecretKey: Uint8Array;
  userSecretKey: Uint8Array;
  enrollToken?: string;
  userName?: string;
}): RelayHostAuthFrame {
  const hostPublicKey = ed25519.getPublicKey(input.hostSigningSecretKey);
  const userPublicKey = ed25519.getPublicKey(input.userSecretKey);
  const message = relayHostAuthMessage(
    input.nonce,
    deriveUserId(userPublicKey),
    deriveHostId(hostPublicKey),
  );
  return {
    t: 'auth',
    hostPub: encodeBase64Url(hostPublicKey),
    userPub: encodeBase64Url(userPublicKey),
    hostSig: encodeBase64Url(ed25519.sign(message, input.hostSigningSecretKey)),
    userSig: encodeBase64Url(ed25519.sign(message, input.userSecretKey)),
    ...(input.enrollToken === undefined ? {} : { enrollToken: input.enrollToken }),
    ...(input.userName === undefined ? {} : { userName: input.userName }),
  };
}

/**
 * Relay side: check an auth frame against the nonce it issued and the ids in
 * the request path. Registration (is this user allowed?) is the caller's job.
 */
export function verifyRelayHostAuth(
  frame: RelayHostAuthFrame,
  expected: { nonce: string; userId: string; hostId: string },
): RelayHostAuthVerdict {
  const hostPublicKey = decodeKey(frame.hostPub, ED25519_KEY_BYTES);
  const userPublicKey = decodeKey(frame.userPub, ED25519_KEY_BYTES);
  const hostSignature = decodeKey(frame.hostSig, ED25519_SIGNATURE_BYTES);
  const userSignature = decodeKey(frame.userSig, ED25519_SIGNATURE_BYTES);
  if (!hostPublicKey || !userPublicKey || !hostSignature || !userSignature) {
    return { ok: false, reason: 'malformed' };
  }
  if (deriveUserId(userPublicKey) !== expected.userId) {
    return { ok: false, reason: 'user-id-mismatch' };
  }
  if (deriveHostId(hostPublicKey) !== expected.hostId) {
    return { ok: false, reason: 'host-id-mismatch' };
  }
  let message: Uint8Array;
  try {
    message = relayHostAuthMessage(expected.nonce, expected.userId, expected.hostId);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!safeVerify(hostSignature, message, hostPublicKey)) {
    return { ok: false, reason: 'bad-host-signature' };
  }
  if (!safeVerify(userSignature, message, userPublicKey)) {
    return { ok: false, reason: 'bad-user-signature' };
  }
  return { ok: true, hostPublicKey, userPublicKey };
}

function decodeKey(text: string, length: number): Uint8Array | undefined {
  const bytes = decodeBase64Url(text);
  return bytes !== undefined && bytes.length === length ? bytes : undefined;
}

/** noble throws on non-canonical points; any throw is a failed verification. */
function safeVerify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
