import { isLegacyAccessMode, type LegacyAccessMode } from '@piwin/contracts';
import { isLocalHostname } from '@piwin/host-transport';
import { readMobileAccessSettings } from './mobile-access-settings-store.js';
import { OwnerOnlyJsonFile } from './owner-only-json-file.js';
import { assertPairingEndpointIsDialable } from './pairing-qr.js';

/** ADR 0101 §9 `remote-access.json`. */
export type RemoteAccessSettings = {
  relay: {
    enabled: boolean;
    url?: string;
    /** First-connect self-enrollment secret; cleared once the relay admitted us. */
    enrollToken?: string;
  };
  direct: { enabled: boolean; port?: number; advertisedUrl?: string };
  legacyAccess: LegacyAccessMode;
};

/**
 * Release N keeps legacy clients working while upgraded ones migrate
 * (ADR 0101 §10). The default moves to `migrate-only` in N+1.
 */
export const DEFAULT_LEGACY_ACCESS: LegacyAccessMode = 'full';

export function defaultRemoteAccessSettings(): RemoteAccessSettings {
  return {
    relay: { enabled: false },
    direct: { enabled: true },
    legacyAccess: DEFAULT_LEGACY_ACCESS,
  };
}

export class RemoteAccessSettingsStore {
  private readonly file: OwnerOnlyJsonFile;
  private readonly legacyMobileAccess: OwnerOnlyJsonFile | undefined;

  /** `legacyMobileAccessPath`: the ADR 0076 `mobile-access.json` to migrate from. */
  public constructor(filePath: string, options: { legacyMobileAccessPath?: string } = {}) {
    this.file = new OwnerOnlyJsonFile(filePath, 'remote-access settings');
    this.legacyMobileAccess =
      options.legacyMobileAccessPath === undefined
        ? undefined
        : new OwnerOnlyJsonFile(options.legacyMobileAccessPath, 'phone-access settings');
  }

  /**
   * Missing file: migrate `enabled`, `port` and the address override from
   * `mobile-access.json` (defaults when that is absent or damaged). A damaged
   * remote-access.json throws.
   */
  public async load(): Promise<RemoteAccessSettings> {
    const stored = await this.file.read();
    if (stored !== undefined) {
      return parseRemoteAccessSettings(stored);
    }
    let phone: ReturnType<typeof readMobileAccessSettings>;
    try {
      const legacy = await this.legacyMobileAccess?.read();
      if (legacy === undefined) {
        return defaultRemoteAccessSettings();
      }
      phone = readMobileAccessSettings(legacy);
    } catch {
      // The old file is only a migration source; its owner reports the damage.
      return defaultRemoteAccessSettings();
    }
    return {
      ...defaultRemoteAccessSettings(),
      direct: {
        enabled: phone.enabled,
        ...(phone.port === undefined ? {} : { port: phone.port }),
        ...(phone.advertisedEndpoint === undefined
          ? {}
          : { advertisedUrl: phone.advertisedEndpoint }),
      },
    };
  }

  public save(settings: RemoteAccessSettings): Promise<void> {
    return this.file.write({
      version: 1,
      ...parseRemoteAccessSettings({ version: 1, ...settings }),
    });
  }
}

export function parseRemoteAccessSettings(value: unknown): RemoteAccessSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Remote-access settings must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('Unsupported remote-access settings version');
  }
  const relay = asRecord(record.relay);
  const direct = asRecord(record.direct);
  const url =
    typeof relay.url === 'string' && relay.url.trim().length > 0
      ? normalizeRelayUrl(relay.url)
      : undefined;
  const enrollToken =
    typeof relay.enrollToken === 'string' && relay.enrollToken.length > 0
      ? relay.enrollToken
      : undefined;
  const port = direct.port;
  const advertised =
    typeof direct.advertisedUrl === 'string' && direct.advertisedUrl.trim().length > 0
      ? direct.advertisedUrl.trim()
      : undefined;
  return {
    relay: {
      enabled: relay.enabled === true && url !== undefined,
      ...(url === undefined ? {} : { url }),
      ...(enrollToken === undefined ? {} : { enrollToken }),
    },
    direct: {
      enabled: direct.enabled !== false,
      ...(typeof port === 'number' && Number.isSafeInteger(port) && port > 0 && port <= 65_535
        ? { port }
        : {}),
      ...(advertised === undefined ? {} : { advertisedUrl: advertised }),
    },
    legacyAccess: isLegacyAccessMode(record.legacyAccess)
      ? record.legacyAccess
      : DEFAULT_LEGACY_ACCESS,
  };
}

/** A relay must be `wss://`; plain `ws://` only for a relay on this machine. */
export function normalizeRelayUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Relay address is not a valid URL: ${trimmed}`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Relay address must not include a path');
  }
  if (url.protocol === 'wss:') {
    return trimmed;
  }
  if (url.protocol === 'ws:' && isLocalHostname(url.hostname)) {
    return trimmed;
  }
  throw new Error('Relay address must start with wss:// (ws:// only for localhost)');
}

/** A direct override must be a dialable ws:// or wss:// URL (ADR 0076 rule). */
export function normalizeDirectUrl(raw: string): string {
  const trimmed = raw.trim();
  const protocol = new URL(trimmed).protocol;
  if (protocol !== 'ws:' && protocol !== 'wss:') {
    throw new Error('Direct address must start with ws:// or wss://');
  }
  assertPairingEndpointIsDialable(trimmed);
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
