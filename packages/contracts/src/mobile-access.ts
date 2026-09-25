/**
 * Local-only sidecar commands for phone access (hybrid spec §4.3).
 *
 * These are **not** `HostCommand`s. The JSONL sidecar intercepts them before
 * `HostRuntime.handleCommand`. HostServer must never admit them from WebSocket
 * clients — keep them off the remote allowlist.
 */

export const LOCAL_MOBILE_ACCESS_COMMAND_TYPES = [
  'mobile-access/status',
  'mobile-access/start',
  'mobile-access/stop',
  'mobile-access/create-pairing-code',
  'mobile-access/list-devices',
  'mobile-access/revoke-device',
] as const;

export type LocalMobileAccessCommandType = (typeof LOCAL_MOBILE_ACCESS_COMMAND_TYPES)[number];

/** Loopback bind; the phone reaches it only through an operator tunnel. */
export const MOBILE_ACCESS_LOOPBACK_PROFILE_ID = 'loopback';
/**
 * Default bind for the bundled app: all interfaces, so a phone on the same
 * Wi-Fi or tailnet can scan the QR and connect. Admission still requires a
 * paired device credential (no anonymous hello off loopback).
 */
export const MOBILE_ACCESS_LAN_PROFILE_ID = 'lan';

export type LocalMobileAccessCommand =
  | { id?: string; type: 'mobile-access/status' }
  | { id?: string; type: 'mobile-access/start'; profileId: string; advertisedEndpoint?: string }
  | { id?: string; type: 'mobile-access/stop' }
  | { id?: string; type: 'mobile-access/create-pairing-code' }
  | { id?: string; type: 'mobile-access/list-devices' }
  | { id?: string; type: 'mobile-access/revoke-device'; deviceId: string };

export type PairedDeviceSummary = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
};

/** A phone-reachable address the sidecar found on this machine's interfaces. */
export type MobileAccessEndpointCandidate = {
  url: string;
  kind: 'lan' | 'tailscale';
  interfaceName: string;
};

export type MobileAccessStatusData = {
  listening: boolean;
  pairedDeviceCount: number;
  /** Persisted preference: the sidecar resumes listening on start when true. */
  enabled?: boolean;
  /** `auto` = advertised endpoint follows the best detected candidate. */
  advertisedEndpointSource?: 'auto' | 'custom';
  endpointCandidates?: MobileAccessEndpointCandidate[];
  /** Why the last start (including the automatic resume) failed. */
  lastError?: string;
  profileId?: string;
  bindHost?: string;
  bindPort?: number;
  bindUrl?: string;
  advertisedEndpoint?: string;
  hostInstanceId?: string;
};

export type MobileAccessPairingCodeData = {
  endpoint: string;
  pairingToken: string;
  hostInstanceId: string;
  protocolVersion: number;
  expiresAt: number;
  uri: string;
};

export type MobileAccessDeviceListData = {
  devices: PairedDeviceSummary[];
};

const LOCAL_MOBILE_ACCESS_COMMAND_TYPE_SET = new Set<string>(LOCAL_MOBILE_ACCESS_COMMAND_TYPES);

export function isLocalMobileAccessCommandType(value: unknown): value is LocalMobileAccessCommandType {
  return typeof value === 'string' && LOCAL_MOBILE_ACCESS_COMMAND_TYPE_SET.has(value);
}

export function isLocalMobileAccessCommand(value: unknown): value is LocalMobileAccessCommand {
  if (!isRecord(value) || !isLocalMobileAccessCommandType(value.type)) {
    return false;
  }
  const id = value.id;
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
    return false;
  }
  switch (value.type) {
    case 'mobile-access/status':
    case 'mobile-access/stop':
    case 'mobile-access/create-pairing-code':
    case 'mobile-access/list-devices':
      return true;
    case 'mobile-access/start': {
      if (typeof value.profileId !== 'string' || value.profileId.trim().length === 0) {
        return false;
      }
      const advertised = value.advertisedEndpoint;
      return advertised === undefined || typeof advertised === 'string';
    }
    case 'mobile-access/revoke-device':
      return typeof value.deviceId === 'string' && value.deviceId.trim().length > 0;
  }
}

export function readMobileAccessStatusData(value: unknown): MobileAccessStatusData | undefined {
  if (!isRecord(value) || typeof value.listening !== 'boolean' || typeof value.pairedDeviceCount !== 'number') {
    return undefined;
  }
  const status: MobileAccessStatusData = {
    listening: value.listening,
    pairedDeviceCount: value.pairedDeviceCount,
  };
  if (typeof value.profileId === 'string' && value.profileId.length > 0) {
    status.profileId = value.profileId;
  }
  if (typeof value.bindHost === 'string' && value.bindHost.length > 0) {
    status.bindHost = value.bindHost;
  }
  if (typeof value.bindPort === 'number' && Number.isSafeInteger(value.bindPort) && value.bindPort >= 0) {
    status.bindPort = value.bindPort;
  }
  if (typeof value.bindUrl === 'string' && value.bindUrl.length > 0) {
    status.bindUrl = value.bindUrl;
  }
  if (typeof value.advertisedEndpoint === 'string' && value.advertisedEndpoint.length > 0) {
    status.advertisedEndpoint = value.advertisedEndpoint;
  }
  if (typeof value.hostInstanceId === 'string' && value.hostInstanceId.length > 0) {
    status.hostInstanceId = value.hostInstanceId;
  }
  if (typeof value.enabled === 'boolean') {
    status.enabled = value.enabled;
  }
  if (value.advertisedEndpointSource === 'auto' || value.advertisedEndpointSource === 'custom') {
    status.advertisedEndpointSource = value.advertisedEndpointSource;
  }
  if (Array.isArray(value.endpointCandidates)) {
    status.endpointCandidates = value.endpointCandidates.filter(isEndpointCandidate);
  }
  if (typeof value.lastError === 'string' && value.lastError.length > 0) {
    status.lastError = value.lastError;
  }
  return status;
}

function isEndpointCandidate(value: unknown): value is MobileAccessEndpointCandidate {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    value.url.length > 0 &&
    (value.kind === 'lan' || value.kind === 'tailscale') &&
    typeof value.interfaceName === 'string'
  );
}

export function readMobileAccessPairingCodeData(value: unknown): MobileAccessPairingCodeData | undefined {
  if (
    !isRecord(value) ||
    typeof value.endpoint !== 'string' ||
    value.endpoint.length === 0 ||
    typeof value.pairingToken !== 'string' ||
    value.pairingToken.length === 0 ||
    typeof value.hostInstanceId !== 'string' ||
    value.hostInstanceId.length === 0 ||
    typeof value.protocolVersion !== 'number' ||
    !Number.isSafeInteger(value.protocolVersion) ||
    typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt) ||
    typeof value.uri !== 'string' ||
    value.uri.length === 0
  ) {
    return undefined;
  }
  return {
    endpoint: value.endpoint,
    pairingToken: value.pairingToken,
    hostInstanceId: value.hostInstanceId,
    protocolVersion: value.protocolVersion,
    expiresAt: value.expiresAt,
    uri: value.uri,
  };
}

export function readMobileAccessDeviceListData(value: unknown): MobileAccessDeviceListData | undefined {
  if (!isRecord(value) || !Array.isArray(value.devices)) {
    return undefined;
  }
  const devices: PairedDeviceSummary[] = [];
  for (const candidate of value.devices) {
    const device = readPairedDeviceSummary(candidate);
    if (device === undefined) {
      return undefined;
    }
    devices.push(device);
  }
  return { devices };
}

export function projectPairedDeviceSummary(input: {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}): PairedDeviceSummary {
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    lastSeenAt: input.lastSeenAt,
    revoked: input.revokedAt !== undefined,
  };
}

function readPairedDeviceSummary(value: unknown): PairedDeviceSummary | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    typeof value.createdAt !== 'string' ||
    value.createdAt.length === 0 ||
    typeof value.lastSeenAt !== 'string' ||
    value.lastSeenAt.length === 0 ||
    typeof value.revoked !== 'boolean'
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    lastSeenAt: value.lastSeenAt,
    revoked: value.revoked,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
