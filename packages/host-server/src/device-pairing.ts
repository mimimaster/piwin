import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import type { PairingCompletion, PairingToken, TrustedDeviceCredential, TrustedDevicePublic } from '@piwin/contracts';

type PendingPairing = {
  expiresAt: number;
};

type StoredDevice = TrustedDevicePublic;

export type DevicePairingOptions = {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  tokenTtlMs?: number;
  maxPendingTokens?: number;
  maxDevices?: number;
};

/**
 * On-disk representation of the Host pairing authority.
 *
 * Raw device secrets are absent. Pending token values are SHA-256 digests so a
 * restart can preserve expiry without persisting a usable enrollment secret.
 */
export type HostDevicePairingState = {
  version: 1;
  pending: Array<{
    tokenHash: string;
    expiresAt: number;
  }>;
  devices: TrustedDevicePublic[];
};

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PENDING_TOKENS = 32;
const DEFAULT_MAX_DEVICES = 32;
const DEVICE_SECRET_BYTES = 32;
const PAIRING_TOKEN_BYTES = 24;
const MAX_DEVICE_NAME_LENGTH = 128;
const MAX_CLIENT_ID_LENGTH = 128;

/**
 * Host-owned, bounded enrollment store. Raw device secrets only exist in the
 * return value of completePairing and are never retained by this class.
 */
export class HostDevicePairing {
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly tokenTtlMs: number;
  private readonly maxPendingTokens: number;
  private readonly maxDevices: number;
  private readonly pending = new Map<string, PendingPairing>();
  private readonly devices = new Map<string, StoredDevice>();

  public constructor(options: DevicePairingOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? ((size) => nodeRandomBytes(size));
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.maxPendingTokens = options.maxPendingTokens ?? DEFAULT_MAX_PENDING_TOKENS;
    this.maxDevices = options.maxDevices ?? DEFAULT_MAX_DEVICES;
    if (this.tokenTtlMs <= 0) throw new Error('Pairing token TTL must be positive');
    if (this.maxPendingTokens <= 0) throw new Error('Pairing pending-token cap must be positive');
    if (this.maxDevices <= 0) throw new Error('Paired-device cap must be positive');
  }

  public mintToken(): PairingToken {
    this.pruneExpiredTokens();
    while (this.pending.size >= this.maxPendingTokens) {
      const oldest = this.pending.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.pending.delete(oldest);
    }

    const token = this.encodeRandom(PAIRING_TOKEN_BYTES);
    const expiresAt = this.now() + this.tokenTtlMs;
    this.pending.set(hashSecret(token), { expiresAt });
    return { token, expiresAt };
  }

  /**
   * Consume a one-time token. A `clientId` identifies the installation: its
   * earlier enrollments are dropped so re-pairing the same phone (for example
   * after it lost its credential) keeps one device record.
   */
  public completePairing(token: string, deviceName?: string, clientId?: string): PairingCompletion {
    this.pruneExpiredTokens();
    const normalizedToken = token.trim();
    const tokenHash = hashSecret(normalizedToken);
    const pending = this.pending.get(tokenHash);
    if (pending === undefined || pending.expiresAt <= this.now()) {
      this.pending.delete(tokenHash);
      throw new Error('Pairing token is invalid or expired');
    }
    const normalizedClientId = normalizeClientId(clientId);
    if (normalizedClientId !== undefined) {
      for (const [existingId, existing] of this.devices) {
        if (existing.clientId === normalizedClientId) this.devices.delete(existingId);
      }
    }
    this.ensureDeviceCapacity();
    this.pending.delete(tokenHash);

    const deviceId = `device-${this.encodeRandom(18)}`;
    const deviceSecret = this.encodeRandom(DEVICE_SECRET_BYTES);
    const createdAt = new Date(this.now()).toISOString();
    const device: StoredDevice = {
      id: deviceId,
      name: normalizeDeviceName(deviceName),
      secretHash: hashSecret(deviceSecret),
      createdAt,
      lastSeenAt: createdAt,
      ...(normalizedClientId === undefined ? {} : { clientId: normalizedClientId }),
    };
    this.devices.set(deviceId, device);

    return {
      credential: { deviceId, deviceSecret },
      device: publicDevice(device),
    };
  }

  /**
   * `clientId` backfills enrollments made before installations were recorded,
   * so their next re-pair also replaces them.
   */
  public authenticate(
    credential: TrustedDeviceCredential,
    clientId?: string,
  ): TrustedDevicePublic | undefined {
    const device = this.devices.get(credential.deviceId);
    if (device === undefined || device.revokedAt !== undefined) return undefined;
    const expected = Buffer.from(device.secretHash, 'utf8');
    const actual = Buffer.from(hashSecret(credential.deviceSecret), 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return undefined;
    }
    device.lastSeenAt = new Date(this.now()).toISOString();
    const normalizedClientId = normalizeClientId(clientId);
    if (device.clientId === undefined && normalizedClientId !== undefined) {
      device.clientId = normalizedClientId;
    }
    return publicDevice(device);
  }

  public revoke(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (device === undefined || device.revokedAt !== undefined) return false;
    device.revokedAt = new Date(this.now()).toISOString();
    return true;
  }

  /** Drop unused enrollment tokens. Already paired devices are unchanged. */
  public invalidatePendingTokens(): void {
    this.pending.clear();
  }

  public list(): TrustedDevicePublic[] {
    return [...this.devices.values()].map(publicDevice);
  }

  public exportState(): HostDevicePairingState {
    this.pruneExpiredTokens();
    return {
      version: 1,
      pending: [...this.pending.entries()].map(([tokenHash, pending]) => ({
        tokenHash,
        expiresAt: pending.expiresAt,
      })),
      devices: this.list(),
    };
  }

  public restoreState(value: unknown): void {
    const parsed = parsePairingState(value, this.maxPendingTokens, this.maxDevices);
    this.pending.clear();
    this.devices.clear();
    for (const pending of parsed.pending) {
      this.pending.set(pending.tokenHash, { expiresAt: pending.expiresAt });
    }
    for (const device of parsed.devices) {
      this.devices.set(device.id, { ...device });
    }
    this.pruneExpiredTokens();
  }

  private ensureDeviceCapacity(): void {
    for (const [deviceId, device] of this.devices) {
      if (device.revokedAt !== undefined) this.devices.delete(deviceId);
    }
    if (this.devices.size >= this.maxDevices) {
      throw new Error('Paired-device capacity is full');
    }
  }

  private pruneExpiredTokens(): void {
    const now = this.now();
    for (const [tokenHash, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(tokenHash);
    }
  }

  private encodeRandom(size: number): string {
    return Buffer.from(this.randomBytes(size)).toString('base64url');
  }
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function normalizeDeviceName(value: string | undefined): string {
  const normalized = value?.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return normalized === undefined || normalized.length === 0 ? 'Piwin mobile' : normalized;
}

function normalizeClientId(value: string | undefined): string | undefined {
  const normalized = value?.trim().slice(0, MAX_CLIENT_ID_LENGTH);
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function publicDevice(device: StoredDevice): TrustedDevicePublic {
  return {
    id: device.id,
    name: device.name,
    secretHash: device.secretHash,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    ...(device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt }),
    ...(device.clientId === undefined ? {} : { clientId: device.clientId }),
  };
}

function parsePairingState(
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

  const pending: HostDevicePairingState['pending'] = [];
  const pendingHashes = new Set<string>();
  for (const candidate of value.pending) {
    if (!isRecord(candidate)) {
      throw new Error('Invalid pending pairing entry');
    }
    const tokenHash = candidate.tokenHash;
    const expiresAt = candidate.expiresAt;
    if (
      typeof tokenHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(tokenHash) ||
      pendingHashes.has(tokenHash) ||
      typeof expiresAt !== 'number' ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= 0
    ) {
      throw new Error('Invalid pending pairing entry');
    }
    pendingHashes.add(tokenHash);
    pending.push({ tokenHash, expiresAt });
  }

  const devices: TrustedDevicePublic[] = [];
  const deviceIds = new Set<string>();
  for (const candidate of value.devices) {
    if (!isRecord(candidate)) {
      throw new Error('Invalid paired-device entry');
    }
    const id = candidate.id;
    const name = candidate.name;
    const secretHash = candidate.secretHash;
    const createdAt = candidate.createdAt;
    const lastSeenAt = candidate.lastSeenAt;
    const revokedAt = candidate.revokedAt;
    const clientId = candidate.clientId;
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      deviceIds.has(id) ||
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof secretHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(secretHash) ||
      typeof createdAt !== 'string' ||
      createdAt.length === 0 ||
      typeof lastSeenAt !== 'string' ||
      lastSeenAt.length === 0 ||
      (revokedAt !== undefined && (typeof revokedAt !== 'string' || revokedAt.length === 0)) ||
      (clientId !== undefined && (typeof clientId !== 'string' || clientId.length === 0))
    ) {
      throw new Error('Invalid paired-device entry');
    }
    deviceIds.add(id);
    devices.push({
      id,
      name,
      secretHash,
      createdAt,
      lastSeenAt,
      ...(revokedAt === undefined ? {} : { revokedAt }),
      ...(clientId === undefined ? {} : { clientId }),
    });
  }
  return { version: 1, pending, devices };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
