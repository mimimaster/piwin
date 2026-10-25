import type { RemoteDeviceRole, TrustedDevicePublic } from '@piwin/contracts';
import { isRemoteDeviceRole } from '@piwin/contracts';
import { decodeBase64Url } from '@piwin/host-transport';

export type PendingPairingEntry = {
  tokenHash: string;
  expiresAt: number;
  /** ADR 0101: role the enrolling device gets; absent (older files) means member. */
  role?: RemoteDeviceRole;
};

/**
 * On-disk representation of the Host pairing authority.
 *
 * Raw device secrets are absent. Pending token values are SHA-256 digests so a
 * restart can preserve expiry without persisting a usable enrollment secret.
 */
export type HostDevicePairingState = {
  version: 1;
  pending: PendingPairingEntry[];
  devices: TrustedDevicePublic[];
};

const X25519_KEY_BYTES = 32;

/** True for a base64url X25519 public key, the only form a channel key is stored in. */
export function isChannelPublicKey(value: unknown): value is string {
  return typeof value === 'string' && decodeBase64Url(value)?.length === X25519_KEY_BYTES;
}

export function publicDevice(device: TrustedDevicePublic): TrustedDevicePublic {
  return {
    id: device.id,
    name: device.name,
    secretHash: device.secretHash,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    ...(device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt }),
    ...(device.clientId === undefined ? {} : { clientId: device.clientId }),
    ...(device.channelPublicKey === undefined ? {} : { channelPublicKey: device.channelPublicKey }),
    ...(device.role === undefined ? {} : { role: device.role }),
    ...(device.migratedAt === undefined ? {} : { migratedAt: device.migratedAt }),
  };
}

export function parsePairingState(
  value: unknown,
  maxPendingTokens: number,
  maxDevices: number,
): HostDevicePairingState {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Invalid paired-device store version');
  }
  if (!Array.isArray(value.pending) || !Array.isArray(value.devices)) {
    throw new Error('Invalid paired-device store shape');
  }
  if (value.pending.length > maxPendingTokens || value.devices.length > maxDevices) {
    throw new Error('Paired-device store exceeds configured bounds');
  }

  const pending: PendingPairingEntry[] = [];
  const pendingHashes = new Set<string>();
  for (const candidate of value.pending) {
    if (!isRecord(candidate)) {
      throw new Error('Invalid pending pairing entry');
    }
    const { tokenHash, expiresAt, role } = candidate;
    if (
      typeof tokenHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(tokenHash) ||
      pendingHashes.has(tokenHash) ||
      typeof expiresAt !== 'number' ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= 0 ||
      (role !== undefined && !isRemoteDeviceRole(role))
    ) {
      throw new Error('Invalid pending pairing entry');
    }
    pendingHashes.add(tokenHash);
    pending.push({ tokenHash, expiresAt, ...(role === undefined ? {} : { role }) });
  }

  const devices: TrustedDevicePublic[] = [];
  const deviceIds = new Set<string>();
  for (const candidate of value.devices) {
    if (!isRecord(candidate)) {
      throw new Error('Invalid paired-device entry');
    }
    const device = parseDevice(candidate);
    if (device === undefined || deviceIds.has(device.id)) {
      throw new Error('Invalid paired-device entry');
    }
    deviceIds.add(device.id);
    devices.push(device);
  }
  return { version: 1, pending, devices };
}

function parseDevice(candidate: Record<string, unknown>): TrustedDevicePublic | undefined {
  const { id, name, secretHash, createdAt, lastSeenAt, revokedAt, clientId } = candidate;
  const { channelPublicKey, role, migratedAt } = candidate;
  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(name) ||
    typeof secretHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(secretHash) ||
    !isNonEmptyString(createdAt) ||
    !isNonEmptyString(lastSeenAt) ||
    (revokedAt !== undefined && !isNonEmptyString(revokedAt)) ||
    (clientId !== undefined && !isNonEmptyString(clientId)) ||
    (channelPublicKey !== undefined && !isChannelPublicKey(channelPublicKey)) ||
    (role !== undefined && !isRemoteDeviceRole(role)) ||
    (migratedAt !== undefined && !isNonEmptyString(migratedAt))
  ) {
    return undefined;
  }
  return publicDevice({
    id,
    name,
    secretHash,
    createdAt,
    lastSeenAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(channelPublicKey === undefined ? {} : { channelPublicKey }),
    ...(role === undefined ? {} : { role }),
    ...(migratedAt === undefined ? {} : { migratedAt }),
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
