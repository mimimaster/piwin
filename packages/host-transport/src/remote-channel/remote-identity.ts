import { sha256 } from '@noble/hashes/sha2.js';
import { REMOTE_DISPLAY_NAME_MAX_LENGTH, REMOTE_ID_LENGTH } from '@piwin/contracts';
import { encodeBase64Url } from './base64url.js';
import { concatBytes } from './concat-bytes.js';

const ID_DIGEST_BYTES = 16;
const textEncoder = new TextEncoder();

/** Domain tags keep a user key and a Host key from ever deriving the same id. */
const USER_ID_DOMAIN = 'piwin-user-v1\0';
const HOST_ID_DOMAIN = 'piwin-host-v1\0';
const CHANNEL_PROLOGUE_DOMAIN = 'piwin-channel-v1\0';

const ED25519_PUBLIC_KEY_BYTES = 32;

/** `userId` from the relay user's Ed25519 public key (ADR 0101 §2). */
export function deriveUserId(userPublicKey: Uint8Array): string {
  return deriveId(USER_ID_DOMAIN, userPublicKey);
}

/** `hostId` from the Host's Ed25519 signing public key (ADR 0101 §2). */
export function deriveHostId(hostSigningPublicKey: Uint8Array): string {
  return deriveId(HOST_ID_DOMAIN, hostSigningPublicKey);
}

/**
 * Noise prologue binding a handshake to one user and one Host, so a handshake
 * captured under one pair of ids cannot be replayed under another.
 */
export function remoteChannelPrologue(userId: string, hostId: string): Uint8Array {
  return concatBytes(
    textEncoder.encode(CHANNEL_PROLOGUE_DOMAIN),
    textEncoder.encode(userId),
    textEncoder.encode(hostId),
  );
}

/**
 * Display labels (user and Host names): NFC, control characters removed,
 * whitespace collapsed, at most {@link REMOTE_DISPLAY_NAME_MAX_LENGTH} code
 * points. Returns undefined when nothing printable is left.
 */
export function normalizeRemoteDisplayName(raw: string): string | undefined {
  const cleaned = raw
    .normalize('NFC')
    .replace(/\p{Cc}|\p{Cf}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned.length === 0) {
    return undefined;
  }
  return Array.from(cleaned).slice(0, REMOTE_DISPLAY_NAME_MAX_LENGTH).join('').trimEnd();
}

function deriveId(domain: string, publicKey: Uint8Array): string {
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(`Remote identity key must be ${ED25519_PUBLIC_KEY_BYTES} bytes`);
  }
  const digest = sha256(concatBytes(textEncoder.encode(domain), publicKey));
  const id = encodeBase64Url(digest.subarray(0, ID_DIGEST_BYTES));
  // 16 bytes always encode to 22 characters; guard the contract anyway.
  if (id.length !== REMOTE_ID_LENGTH) {
    throw new Error('Remote id derivation produced an unexpected length');
  }
  return id;
}
