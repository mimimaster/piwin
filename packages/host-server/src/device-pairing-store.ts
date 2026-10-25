import type { HostDevicePairing } from './device-pairing.js';
import { OwnerOnlyJsonFile } from './owner-only-json-file.js';

/**
 * Owner-only, atomic persistence for the Host pairing authority.
 *
 * Writes are serialized so a token mint racing enrollment cannot publish an
 * older snapshot after a newer one. Readers see either the previous complete
 * document or the next complete document.
 */
export class HostDevicePairingFileStore {
  private readonly file: OwnerOnlyJsonFile;

  public constructor(filePath: string) {
    this.file = new OwnerOnlyJsonFile(filePath, 'paired-device store');
  }

  public async load(pairing: HostDevicePairing): Promise<void> {
    const parsed = await this.file.read();
    if (parsed !== undefined) {
      pairing.restoreState(parsed);
    }
  }

  public save(pairing: HostDevicePairing): Promise<void> {
    return this.file.write(pairing.exportState());
  }

  public flush(): Promise<void> {
    return this.file.flush();
  }
}
