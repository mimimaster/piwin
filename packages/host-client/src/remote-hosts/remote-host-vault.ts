import { isTrustedDeviceCredential, type TrustedDeviceCredential } from '@piwin/contracts';
import {
  decodeBase64Url,
  encodeBase64Url,
  generateNoiseKeyPair,
  noiseKeyPairFromSecret,
  type NoiseKeyPair,
} from '@piwin/host-transport';
import type { KeyValueStorage } from './key-value-storage.js';

/** What a shell must keep secret per paired Host (ADR 0101 §2). */
export type RemoteHostSecrets = {
  /** X25519 client static key proven in every handshake with this Host. */
  clientKeyPair: NoiseKeyPair;
  credential: TrustedDeviceCredential;
};

type StoredSecrets = { version: 1; clientSecretKey: string; credential: TrustedDeviceCredential };

/**
 * Per-Host secrets in the shell's secret storage (Keychain on phone and
 * Desktop, a 0600 file for the CLI). A key per Host, so forgetting one Host
 * never touches another.
 */
export class RemoteHostVault {
  public constructor(private readonly storage: KeyValueStorage) {}

  /** A fresh client key for pairing or migrating to one Host. */
  public static generateClientKeyPair(): NoiseKeyPair {
    return generateNoiseKeyPair();
  }

  public async read(hostId: string): Promise<RemoteHostSecrets | undefined> {
    const raw = await this.storage.read(storageKey(hostId));
    if (raw === undefined) return undefined;
    try {
      const stored = JSON.parse(raw) as Partial<StoredSecrets>;
      const secret = decodeBase64Url(stored.clientSecretKey ?? '');
      if (
        stored.version !== 1 ||
        secret?.length !== 32 ||
        !isTrustedDeviceCredential(stored.credential)
      ) {
        return undefined;
      }
      return { clientKeyPair: noiseKeyPairFromSecret(secret), credential: stored.credential };
    } catch {
      return undefined;
    }
  }

  public async write(hostId: string, secrets: RemoteHostSecrets): Promise<void> {
    if (!isTrustedDeviceCredential(secrets.credential)) {
      throw new Error('Device credential is invalid');
    }
    const stored: StoredSecrets = {
      version: 1,
      clientSecretKey: encodeBase64Url(secrets.clientKeyPair.secretKey),
      credential: secrets.credential,
    };
    await this.storage.write(storageKey(hostId), JSON.stringify(stored));
  }

  public clear(hostId: string): Promise<void> {
    return this.storage.remove(storageKey(hostId));
  }
}

function storageKey(hostId: string): string {
  return `piwin.remote-host.v1.${hostId}`;
}
