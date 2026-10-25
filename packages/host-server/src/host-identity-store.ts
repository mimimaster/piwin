import {
  decodeBase64Url,
  deriveHostId,
  encodeBase64Url,
  generateNoiseKeyPair,
  generateRelaySigningSecretKey,
  noiseKeyPairFromSecret,
  relaySigningPublicKey,
  type NoiseKeyPair,
} from '@piwin/host-transport';
import { OwnerOnlyJsonFile } from './owner-only-json-file.js';

/** The Host's ADR 0101 identity: who it is to relays and to paired shells. */
export type HostIdentity = {
  hostId: string;
  /** Ed25519; proves `hostId` to the relay. */
  hostSigningSecretKey: Uint8Array;
  /** X25519; the Noise responder key every shell pins. */
  staticKeyPair: NoiseKeyPair;
  /** Base64url of the static public key, as it appears in pairing links. */
  hostKey: string;
};

type StoredIdentity = {
  version: 1;
  signingSecretKey: string;
  staticSecretKey: string;
  createdAt: string;
};

/**
 * `~/.piwin/devices/host-identity.json`. Created once; a damaged file is an
 * error, never silently regenerated, because a new identity orphans every
 * paired shell and relay registration.
 */
export class HostIdentityStore {
  private readonly file: OwnerOnlyJsonFile;

  public constructor(filePath: string) {
    this.file = new OwnerOnlyJsonFile(filePath, 'host identity');
  }

  public async loadOrCreate(now: () => Date = () => new Date()): Promise<HostIdentity> {
    const stored = await this.file.read();
    if (stored !== undefined) {
      return toIdentity(parseStoredIdentity(stored));
    }
    const created: StoredIdentity = {
      version: 1,
      signingSecretKey: encodeBase64Url(generateRelaySigningSecretKey()),
      staticSecretKey: encodeBase64Url(generateNoiseKeyPair().secretKey),
      createdAt: now().toISOString(),
    };
    await this.file.write(created);
    return toIdentity(created);
  }
}

function parseStoredIdentity(value: unknown): StoredIdentity {
  const record = value as Partial<StoredIdentity> | null;
  if (
    typeof record !== 'object' ||
    record === null ||
    record.version !== 1 ||
    decodeBase64Url(record.signingSecretKey ?? '')?.length !== 32 ||
    decodeBase64Url(record.staticSecretKey ?? '')?.length !== 32 ||
    typeof record.createdAt !== 'string'
  ) {
    throw new Error(
      'Host identity file is damaged; restore it or remove it to re-pair every shell',
    );
  }
  return record as StoredIdentity;
}

function toIdentity(stored: StoredIdentity): HostIdentity {
  const hostSigningSecretKey = decodeBase64Url(stored.signingSecretKey) ?? new Uint8Array();
  const staticKeyPair = noiseKeyPairFromSecret(
    decodeBase64Url(stored.staticSecretKey) ?? new Uint8Array(),
  );
  return {
    hostId: deriveHostId(relaySigningPublicKey(hostSigningSecretKey)),
    hostSigningSecretKey,
    staticKeyPair,
    hostKey: encodeBase64Url(staticKeyPair.publicKey),
  };
}
