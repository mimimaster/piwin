/**
 * ADR 0101 remote access, Host-server owned commands. Like `host/pairing-*`
 * (ADR 0075) the Host server answers these itself; they never reach
 * HostRuntime. Management commands are operator-only; `host/channel-migrate`
 * is the one command a legacy connection may still run in `migrate-only`.
 */
import type {
  ChannelMigrateRequest,
  ChannelMigrateResult,
  RemoteDeviceRole,
} from './remote-channel.js';
import { isRemoteDeviceRole, isRemoteId } from './remote-channel.js';

export type LegacyAccessMode = 'full' | 'migrate-only' | 'off';
export const LEGACY_ACCESS_MODES: readonly LegacyAccessMode[] = ['full', 'migrate-only', 'off'];

export type RelayConnectionState = 'off' | 'connecting' | 'ready' | 'error';

/** What `host/pairing-status` reports about ADR 0101 access. */
export type RemoteAccessStatusData = {
  hostId: string;
  hostName: string;
  /** Absent until a relay user exists on this Host. */
  user?: { userId: string; name: string };
  relay: {
    enabled: boolean;
    url?: string;
    state: RelayConnectionState;
    /** Last close code from the relay (4401 auth, 4403 revoked, 4429 limit…). */
    lastCloseCode?: number;
  };
  direct: { enabled: boolean; url?: string };
  legacyAccess: LegacyAccessMode;
};

export const HOST_REMOTE_ACCESS_COMMAND_TYPES = [
  'host/remote-access-configure',
  'host/relay-user-create',
  'host/relay-user-rename',
  'host/relay-user-export',
  'host/relay-user-import',
  'host/relay-user-enrollment-line',
  'host/channel-migrate',
] as const;

export type HostRemoteAccessCommandType = (typeof HOST_REMOTE_ACCESS_COMMAND_TYPES)[number];

export type HostRemoteAccessCommand =
  | {
      id?: string;
      type: 'host/remote-access-configure';
      /** `url: null` clears the relay URL. */
      relay?: { enabled?: boolean; url?: string | null; enrollToken?: string | null };
      legacyAccess?: LegacyAccessMode;
    }
  | { id?: string; type: 'host/relay-user-create'; name: string }
  | { id?: string; type: 'host/relay-user-rename'; name: string }
  | { id?: string; type: 'host/relay-user-export'; passphrase: string }
  | { id?: string; type: 'host/relay-user-import'; bundle: string; passphrase: string }
  | { id?: string; type: 'host/relay-user-enrollment-line' }
  | ({ id?: string; type: 'host/channel-migrate' } & ChannelMigrateRequest);

export type RelayUserExportData = { bundle: string };
export type RelayUserEnrollmentLineData = { line: string };
export type ChannelMigrateData = ChannelMigrateResult;

const TYPE_SET = new Set<string>(HOST_REMOTE_ACCESS_COMMAND_TYPES);
const MAX_NAME_LENGTH = 256;
const MAX_URL_LENGTH = 2_048;
const MAX_SECRET_LENGTH = 4_096;
const MAX_BUNDLE_LENGTH = 16_384;
const MAX_KEY_TEXT_LENGTH = 64;
const MAX_CLIENT_ID_LENGTH = 128;

export function isHostRemoteAccessCommandType(
  value: unknown,
): value is HostRemoteAccessCommandType {
  return typeof value === 'string' && TYPE_SET.has(value);
}

export function isLegacyAccessMode(value: unknown): value is LegacyAccessMode {
  return value === 'full' || value === 'migrate-only' || value === 'off';
}

/** Payload check for commands arriving from the wire. */
export function isHostRemoteAccessCommand(value: unknown): value is HostRemoteAccessCommand {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case 'host/remote-access-configure':
      return isConfigurePayload(record);
    case 'host/relay-user-create':
    case 'host/relay-user-rename':
      return isBounded(record.name, MAX_NAME_LENGTH);
    case 'host/relay-user-export':
      return isBounded(record.passphrase, MAX_SECRET_LENGTH);
    case 'host/relay-user-import':
      return (
        isBounded(record.bundle, MAX_BUNDLE_LENGTH) &&
        isBounded(record.passphrase, MAX_SECRET_LENGTH)
      );
    case 'host/relay-user-enrollment-line':
      return true;
    case 'host/channel-migrate':
      return (
        isBounded(record.channelPublicKey, MAX_KEY_TEXT_LENGTH) &&
        isBounded(record.clientId, MAX_CLIENT_ID_LENGTH) &&
        (record.deviceName === undefined || isBounded(record.deviceName, MAX_NAME_LENGTH))
      );
    default:
      return false;
  }
}

const RELAY_STATES = new Set<RelayConnectionState>(['off', 'connecting', 'ready', 'error']);

/** Reads the `remote` block of `host/pairing-status`; undefined when malformed. */
export function readRemoteAccessStatusData(value: unknown): RemoteAccessStatusData | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const relay = record.relay as Record<string, unknown> | undefined;
  const direct = record.direct as Record<string, unknown> | undefined;
  const user = record.user as Record<string, unknown> | undefined;
  if (
    !isRemoteId(record.hostId) ||
    typeof record.hostName !== 'string' ||
    !isLegacyAccessMode(record.legacyAccess) ||
    typeof relay !== 'object' ||
    relay === null ||
    typeof relay.enabled !== 'boolean' ||
    !RELAY_STATES.has(relay.state as RelayConnectionState) ||
    typeof direct !== 'object' ||
    direct === null ||
    typeof direct.enabled !== 'boolean'
  ) {
    return undefined;
  }
  const validUser =
    typeof user === 'object' &&
    user !== null &&
    isRemoteId(user.userId) &&
    typeof user.name === 'string';
  return {
    hostId: record.hostId,
    hostName: record.hostName,
    ...(validUser ? { user: { userId: user.userId as string, name: user.name as string } } : {}),
    relay: {
      enabled: relay.enabled,
      state: relay.state as RelayConnectionState,
      ...(typeof relay.url === 'string' ? { url: relay.url } : {}),
      ...(typeof relay.lastCloseCode === 'number' ? { lastCloseCode: relay.lastCloseCode } : {}),
    },
    direct: {
      enabled: direct.enabled,
      ...(typeof direct.url === 'string' ? { url: direct.url } : {}),
    },
    legacyAccess: record.legacyAccess,
  };
}

/** Role requested for a pairing code; absent means `member`. */
export function readPairingRole(value: unknown): RemoteDeviceRole | undefined {
  return isRemoteDeviceRole(value) ? value : undefined;
}

function isConfigurePayload(record: Record<string, unknown>): boolean {
  if (record.legacyAccess !== undefined && !isLegacyAccessMode(record.legacyAccess)) return false;
  const relay = record.relay;
  if (relay === undefined) return record.legacyAccess !== undefined;
  if (typeof relay !== 'object' || relay === null) return false;
  const { enabled, url, enrollToken } = relay as Record<string, unknown>;
  return (
    (enabled === undefined || typeof enabled === 'boolean') &&
    (url === undefined || url === null || isBounded(url, MAX_URL_LENGTH)) &&
    (enrollToken === undefined || enrollToken === null || isBounded(enrollToken, MAX_SECRET_LENGTH))
  );
}

function isBounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
