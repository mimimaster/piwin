import { isRemoteDeviceRole, isRemoteId, type PairingLinkV3 } from '@piwin/contracts';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { normalizeRemoteDisplayName } from './remote-identity.js';

const NATIVE_PREFIX = 'piwin://pair?';
const WEB_FRAGMENT_KEY = 'pair=';
const X25519_KEY_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_URL_LENGTH = 2_048;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** `piwin://pair?v=3&…` for QR codes and `piwin pair '<link>'` (ADR 0101 §6). */
export function encodePairingLinkV3(link: PairingLinkV3): string {
  const params = new URLSearchParams();
  params.set('v', '3');
  params.set('userId', link.userId);
  params.set('userName', link.userName);
  params.set('hostId', link.hostId);
  params.set('hostName', link.hostName);
  params.set('hostKey', link.hostKey);
  if (link.relayUrl !== undefined) params.set('relay', link.relayUrl);
  if (link.directUrl !== undefined) params.set('direct', link.directUrl);
  params.set('pairingToken', link.pairingToken);
  params.set('role', link.role);
  params.set('expiresAt', String(link.expiresAt));
  return `${NATIVE_PREFIX}${params.toString()}`;
}

/**
 * The same payload for the relay-served browser shell: the link rides in the
 * URL fragment, which browsers never send to the server.
 */
export function encodePairingWebLink(relayUrl: string, link: PairingLinkV3): string {
  const url = new URL(relayUrl);
  const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  const json = JSON.stringify(link);
  return `${protocol}//${url.host}/#${WEB_FRAGMENT_KEY}${encodeBase64Url(textEncoder.encode(json))}`;
}

/** Parses either spelling; undefined for anything that is not a valid v3 link. */
export function parsePairingLinkV3(text: string): PairingLinkV3 | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith(NATIVE_PREFIX)) {
    const params = new URLSearchParams(trimmed.slice(NATIVE_PREFIX.length));
    if (params.get('v') !== '3') return undefined;
    return validate({
      userId: params.get('userId'),
      userName: params.get('userName'),
      hostId: params.get('hostId'),
      hostName: params.get('hostName'),
      hostKey: params.get('hostKey'),
      relayUrl: params.get('relay') ?? undefined,
      directUrl: params.get('direct') ?? undefined,
      pairingToken: params.get('pairingToken'),
      role: params.get('role'),
      expiresAt: Number(params.get('expiresAt')),
    });
  }
  const fragmentAt = trimmed.indexOf(`#${WEB_FRAGMENT_KEY}`);
  if (fragmentAt === -1) return undefined;
  const bytes = decodeBase64Url(trimmed.slice(fragmentAt + 1 + WEB_FRAGMENT_KEY.length));
  if (bytes === undefined) return undefined;
  try {
    const value = JSON.parse(textDecoder.decode(bytes)) as Record<string, unknown>;
    return value.v === 3 ? validate(value) : undefined;
  } catch {
    return undefined;
  }
}

function validate(value: Record<string, unknown>): PairingLinkV3 | undefined {
  const { userId, hostId, hostKey, pairingToken, role, expiresAt, relayUrl, directUrl } = value;
  const userName =
    typeof value.userName === 'string' ? normalizeRemoteDisplayName(value.userName) : undefined;
  const hostName =
    typeof value.hostName === 'string' ? normalizeRemoteDisplayName(value.hostName) : undefined;
  const key = typeof hostKey === 'string' ? decodeBase64Url(hostKey) : undefined;
  if (
    !isRemoteId(userId) ||
    !isRemoteId(hostId) ||
    userName === undefined ||
    hostName === undefined ||
    typeof hostKey !== 'string' ||
    key?.length !== X25519_KEY_BYTES ||
    typeof pairingToken !== 'string' ||
    pairingToken.length === 0 ||
    pairingToken.length > MAX_TOKEN_LENGTH ||
    !isRemoteDeviceRole(role) ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0
  ) {
    return undefined;
  }
  const relay = relayUrl === undefined ? undefined : channelUrl(relayUrl, true);
  const direct = directUrl === undefined ? undefined : channelUrl(directUrl, false);
  if (relay === null || direct === null || (relay === undefined && direct === undefined)) {
    return undefined;
  }
  return {
    v: 3,
    userId,
    userName,
    hostId,
    hostName,
    hostKey,
    ...(relay === undefined ? {} : { relayUrl: relay }),
    ...(direct === undefined ? {} : { directUrl: direct }),
    pairingToken,
    role,
    expiresAt,
  };
}

/**
 * A relay must be `wss://` (plain `ws://` only for localhost development); a
 * direct address may be `ws://` because the channel itself is encrypted.
 * Returns null for an invalid URL.
 */
export function normalizeChannelUrl(value: unknown, requireTls: boolean): string | undefined {
  const normalized = channelUrl(value, requireTls);
  return normalized === null ? undefined : normalized;
}

function channelUrl(value: unknown, requireTls: boolean): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'wss:') return value;
  if (url.protocol !== 'ws:') return null;
  if (!requireTls) return value;
  return isLocalHostname(url.hostname) ? value : null;
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
