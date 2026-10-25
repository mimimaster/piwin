import { OwnerOnlyJsonFile } from './owner-only-json-file.js';

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
  private readonly file: OwnerOnlyJsonFile;

  public constructor(filePath: string) {
    this.file = new OwnerOnlyJsonFile(filePath, 'phone-access settings');
  }

  /** Missing file → defaults. Unreadable/corrupt file throws so the caller can report it. */
  public async load(): Promise<MobileAccessSettings> {
    const parsed = await this.file.read();
    if (parsed === undefined) {
      return { ...DEFAULT_MOBILE_ACCESS_SETTINGS };
    }
    try {
      return readMobileAccessSettings(parsed);
    } catch (error) {
      throw new Error(`Unable to parse phone-access settings: ${toMessage(error)}`);
    }
  }

  public save(settings: MobileAccessSettings): Promise<void> {
    return this.file.write({ version: 1, ...settings });
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
