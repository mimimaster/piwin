import { isRemoteId, type RelayUserPublic } from '@piwin/contracts';
import { decodeBase64Url, deriveUserId, normalizeRemoteDisplayName } from '@piwin/host-transport';

export type RelayUserLimits = { maxHosts: number; maxPeersPerHost: number };

export type RelayUserRecord = {
  userId: string;
  /** Base64url Ed25519 public key; `userId` must derive from it. */
  publicKey: string;
  name: string;
  disabled: boolean;
  limits?: Partial<RelayUserLimits>;
};

/** On-disk `users.json` (ADR 0101 §3). */
export type RelayRegistryState = {
  version: 1;
  users: RelayUserRecord[];
  deniedHosts: string[];
};

export class RelayRegistryError extends Error {
  public readonly name = 'RelayRegistryError';
}

const MAX_USERS = 1_000;
const MAX_DENIED_HOSTS = 10_000;
const MAX_LIMIT = 1_000;

export function emptyRelayRegistry(): RelayRegistryState {
  return { version: 1, users: [], deniedHosts: [] };
}

/**
 * Validates a registry document. Every `userId` is re-derived from its key, so
 * a hand-edited file cannot route one user's traffic under another's id.
 */
export function parseRelayRegistry(value: unknown): RelayRegistryState {
  if (!isRecord(value) || value.version !== 1) {
    throw new RelayRegistryError('users.json must be an object with "version": 1');
  }
  const users = value.users ?? [];
  const deniedHosts = value.deniedHosts ?? [];
  if (!Array.isArray(users) || users.length > MAX_USERS) {
    throw new RelayRegistryError('users.json "users" must be an array');
  }
  if (!Array.isArray(deniedHosts) || deniedHosts.length > MAX_DENIED_HOSTS) {
    throw new RelayRegistryError('users.json "deniedHosts" must be an array');
  }
  const seen = new Set<string>();
  const parsedUsers = users.map((entry, index) => {
    const user = parseUser(entry, index);
    if (seen.has(user.userId)) {
      throw new RelayRegistryError(`users[${index}] repeats user ${user.userId}`);
    }
    seen.add(user.userId);
    return user;
  });
  const parsedDenied = deniedHosts.map((hostId, index) => {
    if (!isRemoteId(hostId)) {
      throw new RelayRegistryError(`deniedHosts[${index}] is not a host id`);
    }
    return hostId;
  });
  return { version: 1, users: parsedUsers, deniedHosts: [...new Set(parsedDenied)] };
}

/** In-memory registry the relay consults on every Host auth and client connect. */
export class RelayUserRegistry {
  private users = new Map<string, RelayUserRecord>();
  private deniedHosts = new Set<string>();

  public constructor(state: RelayRegistryState = emptyRelayRegistry()) {
    this.replace(state);
  }

  public replace(state: RelayRegistryState): void {
    this.users = new Map(state.users.map((user) => [user.userId, { ...user }]));
    this.deniedHosts = new Set(state.deniedHosts);
  }

  public find(userId: string): RelayUserRecord | undefined {
    const user = this.users.get(userId);
    return user === undefined ? undefined : { ...user };
  }

  public list(): RelayUserRecord[] {
    return [...this.users.values()].map((user) => ({ ...user }));
  }

  public isHostDenied(hostId: string): boolean {
    return this.deniedHosts.has(hostId);
  }

  /** Adds a user; an existing user keeps its record (its key cannot change under one id). */
  public addUser(user: RelayUserPublic, limits?: Partial<RelayUserLimits>): 'added' | 'exists' {
    const record = parseUser({ ...user, disabled: false, ...(limits ? { limits } : {}) }, 0);
    if (this.users.has(record.userId)) {
      return 'exists';
    }
    if (this.users.size >= MAX_USERS) {
      throw new RelayRegistryError('Relay user registry is full');
    }
    this.users.set(record.userId, record);
    return 'added';
  }

  public setDisabled(userId: string, disabled: boolean): boolean {
    const user = this.users.get(userId);
    if (user === undefined) return false;
    user.disabled = disabled;
    return true;
  }

  public removeUser(userId: string): boolean {
    return this.users.delete(userId);
  }

  public setHostDenied(hostId: string, denied: boolean): boolean {
    if (!isRemoteId(hostId)) {
      throw new RelayRegistryError('Not a host id');
    }
    const had = this.deniedHosts.has(hostId);
    if (denied) this.deniedHosts.add(hostId);
    else this.deniedHosts.delete(hostId);
    return had !== denied;
  }

  public snapshot(): RelayRegistryState {
    return {
      version: 1,
      users: this.list().sort((left, right) => left.name.localeCompare(right.name)),
      deniedHosts: [...this.deniedHosts].sort(),
    };
  }
}

function parseUser(entry: unknown, index: number): RelayUserRecord {
  if (!isRecord(entry)) {
    throw new RelayRegistryError(`users[${index}] must be an object`);
  }
  const { userId, publicKey, name, disabled, limits } = entry;
  const key = typeof publicKey === 'string' ? decodeBase64Url(publicKey) : undefined;
  if (typeof publicKey !== 'string' || key === undefined || key.length !== 32) {
    throw new RelayRegistryError(`users[${index}].publicKey is not an Ed25519 key`);
  }
  if (typeof userId !== 'string' || deriveUserId(key) !== userId) {
    throw new RelayRegistryError(`users[${index}].userId does not match its public key`);
  }
  const normalizedName = typeof name === 'string' ? normalizeRemoteDisplayName(name) : undefined;
  if (normalizedName === undefined) {
    throw new RelayRegistryError(`users[${index}].name is empty`);
  }
  if (disabled !== undefined && typeof disabled !== 'boolean') {
    throw new RelayRegistryError(`users[${index}].disabled must be a boolean`);
  }
  const parsedLimits = parseLimits(limits, index);
  return {
    userId,
    publicKey,
    name: normalizedName,
    disabled: disabled ?? false,
    ...(parsedLimits === undefined ? {} : { limits: parsedLimits }),
  };
}

function parseLimits(value: unknown, index: number): Partial<RelayUserLimits> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new RelayRegistryError(`users[${index}].limits must be an object`);
  }
  const limits: Partial<RelayUserLimits> = {};
  for (const field of ['maxHosts', 'maxPeersPerHost'] as const) {
    const limit = value[field];
    if (limit === undefined) continue;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new RelayRegistryError(`users[${index}].limits.${field} must be 1..${MAX_LIMIT}`);
    }
    limits[field] = limit;
  }
  return limits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
