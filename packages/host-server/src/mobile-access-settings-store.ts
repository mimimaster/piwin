import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Phone-access preference that must survive sidecar restarts.
 *
 * `port` is the port the listener last bound. Reusing it keeps the endpoint a
 * paired phone saved from its QR valid across app restarts.
 */
export type MobileAccessSettings = {
  enabled: boolean;
  port?: number;
  /** Operator override; absent means "advertise the best detected address". */
  advertisedEndpoint?: string;
};

/** The bundled app accepts phones out of the box; the operator can turn it off. */
export const DEFAULT_MOBILE_ACCESS_SETTINGS: MobileAccessSettings = { enabled: true };

export class MobileAccessSettingsFileStore {
  private readonly filePath: string;
  private writeTail: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      throw new Error('Phone-access settings path is required');
    }
    this.filePath = normalized;
  }

  /** Missing file → defaults. Unreadable/corrupt file throws so the caller can report it. */
  public async load(): Promise<MobileAccessSettings> {
    await this.writeTail;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { ...DEFAULT_MOBILE_ACCESS_SETTINGS };
      }
      throw new Error(`Unable to read phone-access settings: ${toMessage(error)}`);
    }
    try {
      return readMobileAccessSettings(JSON.parse(raw) as unknown);
    } catch (error) {
      throw new Error(`Unable to parse phone-access settings: ${toMessage(error)}`);
    }
  }

  public save(settings: MobileAccessSettings): Promise<void> {
    const operation = this.writeTail.then(() => this.write(settings));
    this.writeTail = operation.catch(() => undefined);
    return operation;
  }

  private async write(settings: MobileAccessSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ version: 1, ...settings }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

export function readMobileAccessSettings(value: unknown): MobileAccessSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('settings must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  const settings: MobileAccessSettings = {
    enabled:
      typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_MOBILE_ACCESS_SETTINGS.enabled,
  };
  const port = record.port;
  if (typeof port === 'number' && Number.isSafeInteger(port) && port > 0 && port <= 65_535) {
    settings.port = port;
  }
  const advertised = record.advertisedEndpoint;
  if (typeof advertised === 'string' && advertised.trim().length > 0) {
    settings.advertisedEndpoint = advertised.trim();
  }
  return settings;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
