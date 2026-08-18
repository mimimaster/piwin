import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HostDevicePairing } from './device-pairing.js';

/**
 * Owner-only, atomic persistence for the Host pairing authority.
 *
 * Writes are serialized so a token mint racing enrollment cannot publish an
 * older snapshot after a newer one. Readers see either the previous complete
 * document or the next complete document.
 */
export class HostDevicePairingFileStore {
  private readonly filePath: string;
  private writeTail: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      throw new Error('Paired-device store path is required');
    }
    this.filePath = normalized;
  }

  public async load(pairing: HostDevicePairing): Promise<void> {
    await this.writeTail;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return;
      }
      throw new Error(`Unable to read paired-device store: ${toErrorMessage(error)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Unable to parse paired-device store: ${toErrorMessage(error)}`);
    }
    pairing.restoreState(parsed);
  }

  public save(pairing: HostDevicePairing): Promise<void> {
    const snapshot = pairing.exportState();
    const operation = this.writeTail.then(() => this.writeSnapshot(snapshot));
    this.writeTail = operation.catch(() => undefined);
    return operation;
  }

  public async flush(): Promise<void> {
    await this.writeTail;
  }

  private async writeSnapshot(snapshot: unknown): Promise<void> {
    const parentDirectory = dirname(this.filePath);
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original write/rename error; cleanup is best effort.
      }
      throw new Error(`Unable to persist paired-device store: ${toErrorMessage(error)}`);
    }
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown filesystem error';
}
