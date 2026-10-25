import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import type {
  HostHelloRejectReason,
  PairingCompletion,
  PairingToken,
  RemoteDeviceRole,
  TrustedDeviceCredential,
  TrustedDevicePublic,
} from '@piwin/contracts';
import {
  isChannelPublicKey,
  parsePairingState,
  publicDevice,
  type HostDevicePairingState,
} from './device-pairing-state.js';

export type { HostDevicePairingState } from './device-pairing-state.js';

type PendingPairing = {
  expiresAt: number;
  role: RemoteDeviceRole;
};

type StoredDevice = TrustedDevicePublic;

export type DevicePairingOptions = {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  tokenTtlMs?: number;
  maxPendingTokens?: number;
  maxDevices?: number;
};

/** ADR 0101 result of binding a channel key to an existing (legacy) device. */
export type ChannelBindResult = 'bound' | 'already-bound' | 'conflict' | 'unknown';

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PENDING_TOKENS = 32;
const DEFAULT_MAX_DEVICES = 32;
const DEVICE_SECRET_BYTES = 32;
const PAIRING_TOKEN_BYTES = 24;
const MAX_DEVICE_NAME_LENGTH = 128;
const MAX_CLIENT_ID_LENGTH = 128;

/** Enrollment refusal the hello path reports to the client as a reject reason. */
export class DevicePairingError extends Error {
  public readonly name = 'DevicePairingError';
  public readonly reason: Extract<
    HostHelloRejectReason,
    'pairing-token-invalid' | 'device-capacity-full'
  >;

  public constructor(reason: DevicePairingError['reason'], message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Host-owned, bounded enrollment store. Raw device secrets only exist in the
 * return value of an enrollment and are never retained by this class.
 *
 * ADR 0101: a device may carry a channel key (the X25519 static key it proved
 * in its Noise handshake) and a role. A channel connection authenticates only
 * when its handshake key matches the bound one.
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

  /** `role` is what the enrolling device becomes; only operators may mint `operator` codes. */
  public mintToken(role: RemoteDeviceRole = 'member'): PairingToken {
    this.pruneExpiredTokens();
    while (this.pending.size >= this.maxPendingTokens) {
      const oldest = this.pending.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.pending.delete(oldest);
    }

    const token = this.encodeRandom(PAIRING_TOKEN_BYTES);
    const expiresAt = this.now() + this.tokenTtlMs;
    this.pending.set(hashSecret(token), { expiresAt, role });
    return { token, expiresAt };
  }

  /** ADR 0101 early drop: an unknown channel key is only worth answering while a code is live. */
  public hasPendingTokens(): boolean {
    this.pruneExpiredTokens();
    return this.pending.size > 0;
  }

  /**
   * Consume a one-time token. A `clientId` identifies the installation: its
   * earlier enrollments are dropped so re-pairing the same phone (for example
   * after it lost its credential) keeps one device record.
   *
   * `channelPublicKey` comes from the Noise handshake of the connection that
   * presented the token, never from a message field.
   */
  public completePairing(
    token: string,
    deviceName?: string,
    clientId?: string,
    channelPublicKey?: string,
  ): PairingCompletion {
    this.pruneExpiredTokens();
    const tokenHash = hashSecret(token.trim());
    const pending = this.pending.get(tokenHash);
    if (pending === undefined || pending.expiresAt <= this.now()) {
      this.pending.delete(tokenHash);
      throw new DevicePairingError('pairing-token-invalid', 'Pairing token is invalid or expired');
    }
    const completion = this.enroll({
      deviceName,
      clientId,
      role: pending.role,
      channelPublicKey,
    });
    this.pending.delete(tokenHash);
    return completion;
  }

  /**
   * ADR 0101 §10: a token-door caller (thin shell, CLI) migrating to the
   * channel becomes an operator device. Its credential is returned once.
   */
  public enrollMigratedOperator(input: {
    deviceName?: string;
    clientId: string;
    channelPublicKey: string;
  }): PairingCompletion {
    const completion = this.enroll({
      deviceName: input.deviceName,
      clientId: input.clientId,
      role: 'operator',
      channelPublicKey: input.channelPublicKey,
    });
    const device = this.devices.get(completion.device.id);
    if (device === undefined) {
      return completion;
    }
    device.migratedAt = device.createdAt;
    return { ...completion, device: publicDevice(device) };
  }

  /**
   * `clientId` backfills enrollments made before installations were recorded,
   * so their next re-pair also replaces them. `channelPublicKey` is set for
   * channel connections: it must equal the device's bound key.
   */
  public authenticate(
    credential: TrustedDeviceCredential,
    clientId?: string,
    channelPublicKey?: string,
  ): TrustedDevicePublic | undefined {
    const device = this.devices.get(credential.deviceId);
    if (device === undefined || device.revokedAt !== undefined) return undefined;
    const expected = Buffer.from(device.secretHash, 'utf8');
    const actual = Buffer.from(hashSecret(credential.deviceSecret), 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return undefined;
    }
    if (channelPublicKey !== undefined && device.channelPublicKey !== channelPublicKey) {
      return undefined;
    }
    device.lastSeenAt = new Date(this.now()).toISOString();
    const normalizedClientId = normalizeClientId(clientId);
    if (device.clientId === undefined && normalizedClientId !== undefined) {
      device.clientId = normalizedClientId;
    }
    return publicDevice(device);
  }

  /** Active device bound to this channel key, if any (ADR 0101 early drop). */
  public findByChannelKey(channelPublicKey: string): TrustedDevicePublic | undefined {
    for (const device of this.devices.values()) {
      if (device.revokedAt === undefined && device.channelPublicKey === channelPublicKey) {
        return publicDevice(device);
      }
    }
    return undefined;
  }

  /**
   * ADR 0101 §10 migration of a legacy device. Idempotent for the same key;
   * a different key on an already bound device is a conflict, so a stolen
   * legacy credential cannot take over a migrated device.
   */
  public bindChannelKey(deviceId: string, channelPublicKey: string): ChannelBindResult {
    if (!isChannelPublicKey(channelPublicKey)) {
      throw new Error('Channel key must be a base64url X25519 public key');
    }
    const device = this.devices.get(deviceId);
    if (device === undefined || device.revokedAt !== undefined) return 'unknown';
    if (device.channelPublicKey === channelPublicKey) return 'already-bound';
    if (device.channelPublicKey !== undefined) return 'conflict';
    device.channelPublicKey = channelPublicKey;
    device.migratedAt = new Date(this.now()).toISOString();
    return 'bound';
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
        ...(pending.role === 'member' ? {} : { role: pending.role }),
      })),
      devices: this.list(),
    };
  }

  public restoreState(value: unknown): void {
    const parsed = parsePairingState(value, this.maxPendingTokens, this.maxDevices);
    this.pending.clear();
    this.devices.clear();
    for (const pending of parsed.pending) {
      this.pending.set(pending.tokenHash, {
        expiresAt: pending.expiresAt,
        role: pending.role ?? 'member',
      });
    }
    for (const device of parsed.devices) {
      this.devices.set(device.id, { ...device });
    }
    this.pruneExpiredTokens();
  }

  private enroll(input: {
    deviceName: string | undefined;
    clientId: string | undefined;
    role: RemoteDeviceRole;
    channelPublicKey: string | undefined;
  }): PairingCompletion {
    if (input.channelPublicKey !== undefined && !isChannelPublicKey(input.channelPublicKey)) {
      throw new Error('Channel key must be a base64url X25519 public key');
    }
    const normalizedClientId = normalizeClientId(input.clientId);
    if (normalizedClientId !== undefined) {
      for (const [existingId, existing] of this.devices) {
        if (existing.clientId === normalizedClientId) this.devices.delete(existingId);
      }
    }
    this.ensureDeviceCapacity();

    const deviceId = `device-${this.encodeRandom(18)}`;
    const deviceSecret = this.encodeRandom(DEVICE_SECRET_BYTES);
    const createdAt = new Date(this.now()).toISOString();
    const device: StoredDevice = {
      id: deviceId,
      name: normalizeDeviceName(input.deviceName),
      secretHash: hashSecret(deviceSecret),
      createdAt,
      lastSeenAt: createdAt,
      ...(normalizedClientId === undefined ? {} : { clientId: normalizedClientId }),
      ...(input.channelPublicKey === undefined ? {} : { channelPublicKey: input.channelPublicKey }),
      ...(input.role === 'member' ? {} : { role: input.role }),
    };
    this.devices.set(deviceId, device);
    return { credential: { deviceId, deviceSecret }, device: publicDevice(device) };
  }

  private ensureDeviceCapacity(): void {
    for (const [deviceId, device] of this.devices) {
      if (device.revokedAt !== undefined) this.devices.delete(deviceId);
    }
    if (this.devices.size >= this.maxDevices) {
      throw new DevicePairingError('device-capacity-full', 'Paired-device capacity is full');
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

/** The device's role; records predating ADR 0101 are members. */
export function deviceRoleOf(device: Pick<TrustedDevicePublic, 'role'>): RemoteDeviceRole {
  return device.role ?? 'member';
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
