import {
  decodeBase64Url,
  deriveUserId,
  encodeBase64Url,
  formatRelayEnrollmentLine,
  generateRelaySigningSecretKey,
  normalizeRemoteDisplayName,
  openRelayUserBundle,
  relaySigningPublicKey,
  sealRelayUserBundle,
  type ScryptParams,
} from '@piwin/host-transport';
import { OwnerOnlyJsonFile } from './owner-only-json-file.js';

/** The relay user this Host belongs to (ADR 0101 §3) — the account stand-in. */
export type HostRelayUser = {
  userId: string;
  name: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
};

type StoredUser = { version: 1; secretKey: string; name: string; createdAt: string };

export class RelayUserStoreError extends Error {
  public readonly name = 'RelayUserStoreError';
}

/** `~/.piwin/devices/relay-user.json`; the same user key may live on several of one person's Hosts. */
export class RelayUserStore {
  private readonly file: OwnerOnlyJsonFile;
  private readonly now: () => Date;

  public constructor(filePath: string, options: { now?: () => Date } = {}) {
    this.file = new OwnerOnlyJsonFile(filePath, 'relay user');
    this.now = options.now ?? (() => new Date());
  }

  public async load(): Promise<HostRelayUser | undefined> {
    const stored = await this.file.read();
    return stored === undefined ? undefined : toUser(parseStoredUser(stored));
  }

  public async create(name: string): Promise<HostRelayUser> {
    if ((await this.load()) !== undefined) {
      throw new RelayUserStoreError('This Host already has a relay user; rename or import instead');
    }
    return this.write(generateRelaySigningSecretKey(), name);
  }

  public async rename(name: string): Promise<HostRelayUser> {
    const user = await this.requireUser();
    return this.write(user.secretKey, name);
  }

  public async exportBundle(passphrase: string, params?: ScryptParams): Promise<string> {
    const user = await this.requireUser();
    return sealRelayUserBundle(
      { userSecretKey: user.secretKey, name: user.name },
      passphrase,
      params,
    );
  }

  /** Replaces this Host's relay user with the bundled one (moving a Host to its owner's user). */
  public async importBundle(bundle: string, passphrase: string): Promise<HostRelayUser> {
    const contents = await openRelayUserBundle(bundle, passphrase);
    return this.write(contents.userSecretKey, contents.name);
  }

  public async enrollmentLine(): Promise<string> {
    const user = await this.requireUser();
    return formatRelayEnrollmentLine({ publicKey: user.publicKey, name: user.name });
  }

  private async requireUser(): Promise<HostRelayUser> {
    const user = await this.load();
    if (user === undefined) {
      throw new RelayUserStoreError('This Host has no relay user yet');
    }
    return user;
  }

  private async write(secretKey: Uint8Array, rawName: string): Promise<HostRelayUser> {
    const name = normalizeRemoteDisplayName(rawName);
    if (name === undefined) {
      throw new RelayUserStoreError('Relay user name is empty');
    }
    const stored: StoredUser = {
      version: 1,
      secretKey: encodeBase64Url(secretKey),
      name,
      createdAt: this.now().toISOString(),
    };
    await this.file.write(stored);
    return toUser(stored);
  }
}

function parseStoredUser(value: unknown): StoredUser {
  const record = value as Partial<StoredUser> | null;
  if (
    typeof record !== 'object' ||
    record === null ||
    record.version !== 1 ||
    decodeBase64Url(record.secretKey ?? '')?.length !== 32 ||
    typeof record.name !== 'string' ||
    normalizeRemoteDisplayName(record.name) === undefined
  ) {
    throw new RelayUserStoreError('Relay user file is damaged');
  }
  return record as StoredUser;
}

function toUser(stored: StoredUser): HostRelayUser {
  const secretKey = decodeBase64Url(stored.secretKey) ?? new Uint8Array();
  const publicKey = relaySigningPublicKey(secretKey);
  return { userId: deriveUserId(publicKey), name: stored.name, secretKey, publicKey };
}
