/**
 * ADR 0101: relay-first remote access over one end-to-end channel.
 *
 * Wire shapes shared by the Host, every remote shell and the self-hosted relay
 * (`apps/gateway`). Types, constants and pure validators only — framing,
 * Noise and routing live in `@piwin/host-transport`, `@piwin/host-server` and
 * the relay.
 */

/** Bumped only when old and new peers must refuse each other. */
export const REMOTE_CHANNEL_PROTOCOL = 1;

/** Every channel route is scoped by a relay user: `/v1/u/<userId>/…`. */
export const REMOTE_CHANNEL_PATH_PREFIX = '/v1/u/';

/** One relay frame: 4-byte peer prefix plus one Noise transport message. */
export const REMOTE_CHANNEL_MAX_FRAME_BYTES = 70 * 1024;

/** Base64url of the first 16 bytes of a domain-separated SHA-256 (ADR 0101 §2). */
export const REMOTE_ID_LENGTH = 22;

/** Display labels for users and Hosts; never used for routing. */
export const REMOTE_DISPLAY_NAME_MAX_LENGTH = 64;

/**
 * Close codes on relay and direct channel sockets. `unavailable` is
 * deliberately ambiguous (unknown user, unknown Host, offline Host, or IDs
 * that do not belong together) so one user cannot probe another's Hosts.
 */
export const REMOTE_CHANNEL_CLOSE = {
  badRequest: 4400,
  hostAuthFailed: 4401,
  forbidden: 4403,
  unavailable: 4404,
  replaced: 4409,
  frameTooLarge: 4413,
  limited: 4429,
} as const;

export type RemoteChannelCloseCode =
  (typeof REMOTE_CHANNEL_CLOSE)[keyof typeof REMOTE_CHANNEL_CLOSE];

export type RemoteChannelRoute = 'host' | 'connect';

export type RemoteChannelPath = {
  userId: string;
  route: RemoteChannelRoute;
};

export type RemoteDeviceRole = 'member' | 'operator';

const REMOTE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isRemoteId(value: unknown): value is string {
  return typeof value === 'string' && REMOTE_ID_PATTERN.test(value);
}

export function isRemoteDeviceRole(value: unknown): value is RemoteDeviceRole {
  return value === 'member' || value === 'operator';
}

export function remoteChannelPath(userId: string, route: RemoteChannelRoute): string {
  if (!isRemoteId(userId)) {
    throw new Error('Remote channel path requires a valid user id');
  }
  return `${REMOTE_CHANNEL_PATH_PREFIX}${userId}/${route}`;
}

/** Parses a request pathname (no query); anything else under the prefix is not a route. */
export function parseRemoteChannelPath(pathname: string): RemoteChannelPath | undefined {
  if (!pathname.startsWith(REMOTE_CHANNEL_PATH_PREFIX)) {
    return undefined;
  }
  const [userId, route, ...rest] = pathname.slice(REMOTE_CHANNEL_PATH_PREFIX.length).split('/');
  if (rest.length > 0 || !isRemoteId(userId)) {
    return undefined;
  }
  return route === 'host' || route === 'connect' ? { userId, route } : undefined;
}

/** True for any upgrade path the channel owns, valid or not; it never falls back to the legacy route. */
export function isRemoteChannelPathname(pathname: string): boolean {
  return pathname.startsWith(REMOTE_CHANNEL_PATH_PREFIX);
}

// ---------------------------------------------------------------------------
// Relay control frames (TEXT). Host auth runs before any binary frame; after
// auth only the relay sends text.
// ---------------------------------------------------------------------------

export type RelayHostChallengeFrame = { t: 'challenge'; nonce: string };

export type RelayHostAuthFrame = {
  t: 'auth';
  /** Base64url Ed25519 Host signing key; `hostId` must derive from it. */
  hostPub: string;
  /** Base64url Ed25519 relay user key; `userId` must derive from it. */
  userPub: string;
  hostSig: string;
  userSig: string;
  /** First-auth self-enrollment against the relay's enroll token. */
  enrollToken?: string;
};

export type RelayHostReadyFrame = { t: 'ready' };
export type RelayPeerJoinedFrame = { t: 'peer-joined'; peer: number };
export type RelayPeerLeftFrame = { t: 'peer-left'; peer: number };
export type RelayHostReplacedFrame = { t: 'host-replaced' };

export type RelayControlFrame =
  | RelayHostChallengeFrame
  | RelayHostAuthFrame
  | RelayHostReadyFrame
  | RelayPeerJoinedFrame
  | RelayPeerLeftFrame
  | RelayHostReplacedFrame;

const MAX_PEER_ID = 0xffff_ffff;
const MAX_CONTROL_FIELD_LENGTH = 512;

/** Returns undefined for anything that is not a well-formed control frame. */
export function decodeRelayControlFrame(text: string): RelayControlFrame | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  switch (record.t) {
    case 'challenge':
      return isBoundedString(record.nonce) ? { t: 'challenge', nonce: record.nonce } : undefined;
    case 'auth': {
      const { hostPub, userPub, hostSig, userSig, enrollToken } = record;
      if (
        !isBoundedString(hostPub) ||
        !isBoundedString(userPub) ||
        !isBoundedString(hostSig) ||
        !isBoundedString(userSig) ||
        (enrollToken !== undefined && !isBoundedString(enrollToken))
      ) {
        return undefined;
      }
      return {
        t: 'auth',
        hostPub,
        userPub,
        hostSig,
        userSig,
        ...(enrollToken === undefined ? {} : { enrollToken }),
      };
    }
    case 'ready':
      return { t: 'ready' };
    case 'host-replaced':
      return { t: 'host-replaced' };
    case 'peer-joined':
    case 'peer-left':
      return isPeerId(record.peer) ? { t: record.t, peer: record.peer } : undefined;
    default:
      return undefined;
  }
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CONTROL_FIELD_LENGTH;
}

function isPeerId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PEER_ID;
}

// ---------------------------------------------------------------------------
// Pairing, host book, relay users, migration (data shapes).
// ---------------------------------------------------------------------------

/** Pairing link v3 payload (ADR 0101 §6); at least one of `relayUrl` / `directUrl`. */
export type PairingLinkV3 = {
  v: 3;
  userId: string;
  userName: string;
  hostId: string;
  hostName: string;
  /** Base64url X25519 Host static key; pinned by the client. */
  hostKey: string;
  relayUrl?: string;
  directUrl?: string;
  pairingToken: string;
  role: RemoteDeviceRole;
  expiresAt: number;
};

/** Public identity of a relay user; the private key never leaves its owner. */
export type RelayUserPublic = {
  userId: string;
  /** Base64url Ed25519 public key. */
  publicKey: string;
  name: string;
};

/** One paired Host as a remote shell remembers it. One entry = one connection target. */
export type HostBookEntry = {
  userId: string;
  userName: string;
  hostId: string;
  hostName: string;
  hostKey: string;
  relayUrl?: string;
  directUrl?: string;
  role: RemoteDeviceRole;
  /** Shell-chosen local alias (`piwin hosts use <alias>`). */
  alias?: string;
  pairedAt: string;
};

/** `host/channel-migrate` request: sent once over the legacy path (ADR 0101 §10). */
export type ChannelMigrateRequest = {
  /** Base64url X25519 client static key to bind to the device record. */
  channelPublicKey: string;
  clientId: string;
  deviceName?: string;
};

export type ChannelMigrateResult = {
  userId: string;
  userName: string;
  hostId: string;
  hostName: string;
  hostKey: string;
  relayUrl?: string;
  directUrl?: string;
  /** Only when the Host created a new record (token callers). */
  credential?: { deviceId: string; deviceSecret: string };
  role: RemoteDeviceRole;
};
