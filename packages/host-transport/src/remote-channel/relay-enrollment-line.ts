import type { RelayUserPublic } from '@piwin/contracts';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { deriveUserId, normalizeRemoteDisplayName } from './remote-identity.js';

const PREFIX = 'piwin-user:v1:';
const ED25519_KEY_BYTES = 32;

/**
 * The line a Host shows so a relay admin can register its user
 * (ADR 0101 §3): `piwin-user:v1:<publicKey>:<name>`. The name is last and may
 * itself contain colons.
 */
export function formatRelayEnrollmentLine(user: { publicKey: Uint8Array; name: string }): string {
  const name = normalizeRemoteDisplayName(user.name);
  if (name === undefined) {
    throw new Error('Relay user name is empty');
  }
  if (user.publicKey.length !== ED25519_KEY_BYTES) {
    throw new Error('Relay user key must be 32 bytes');
  }
  return `${PREFIX}${encodeBase64Url(user.publicKey)}:${name}`;
}

/** Undefined for anything that is not a well-formed v1 line. */
export function parseRelayEnrollmentLine(line: string): RelayUserPublic | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PREFIX)) {
    return undefined;
  }
  const rest = trimmed.slice(PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) {
    return undefined;
  }
  const publicKeyText = rest.slice(0, separator);
  const publicKey = decodeBase64Url(publicKeyText);
  const name = normalizeRemoteDisplayName(rest.slice(separator + 1));
  if (publicKey === undefined || publicKey.length !== ED25519_KEY_BYTES || name === undefined) {
    return undefined;
  }
  return { userId: deriveUserId(publicKey), publicKey: publicKeyText, name };
}
