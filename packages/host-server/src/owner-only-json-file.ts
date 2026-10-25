import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * One owner-only JSON document under `~/.piwin`. Writes are atomic (temp file
 * + rename) and serialized, so a later save never loses to an earlier one and
 * readers see either the previous or the next complete document.
 *
 * `label` names the file in errors ("paired-device store", …).
 */
export class OwnerOnlyJsonFile {
  public readonly filePath: string;
  private readonly label: string;
  private writeTail: Promise<void> = Promise.resolve();

  public constructor(filePath: string, label: string) {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      throw new Error(`${label} path is required`);
    }
    this.filePath = normalized;
    this.label = label;
  }

  /** Undefined when the file does not exist; throws when it exists but cannot be read or parsed. */
  public async read(): Promise<unknown> {
    await this.writeTail;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return undefined;
      }
      throw new Error(`Unable to read ${this.label}: ${toErrorMessage(error)}`);
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Unable to parse ${this.label}: ${toErrorMessage(error)}`);
    }
  }

  public write(value: unknown): Promise<void> {
    const operation = this.writeTail.then(() => this.writeNow(value));
    this.writeTail = operation.catch(() => undefined);
    return operation;
  }

  public async flush(): Promise<void> {
    await this.writeTail;
  }

  private async writeNow(value: unknown): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
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
      throw new Error(`Unable to persist ${this.label}: ${toErrorMessage(error)}`);
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
