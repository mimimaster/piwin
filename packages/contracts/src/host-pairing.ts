/**
 * Operator-facing phone pairing on the Host a shell is connected to (ADR 0075).
 *
 * Unlike the sidecar-local `mobile-access/*` IPC, these are real HostCommands
 * served by the Host server that owns the pairing registry. They never open or
 * close a listener: whether a Host accepts phones is its startup configuration.
 * A paired device may read status but never mint codes or revoke devices.
 */
import type { MobileAccessPairingCodeData, MobileAccessDeviceListData } from './mobile-access.js';

export const HOST_PAIRING_COMMAND_TYPES = [
  'host/pairing-status',
  'host/pairing-create-code',
  'host/pairing-list-devices',
  'host/pairing-revoke-device',
  'host/pairing-set-enabled',
] as const;

export type HostPairingCommandType = (typeof HOST_PAIRING_COMMAND_TYPES)[number];

export type HostPairingCommand =
  | { id?: string; type: 'host/pairing-status' }
  | { id?: string; type: 'host/pairing-create-code'; advertisedEndpoint?: string }
  | { id?: string; type: 'host/pairing-list-devices' }
  | { id?: string; type: 'host/pairing-revoke-device'; deviceId: string }
  | { id?: string; type: 'host/pairing-set-enabled'; enabled: boolean; advertisedEndpoint?: string };

export type HostPairingStatusData = {
  /** Paired devices are admitted (on by default; `PIWIN_HOST_PAIRING=0` or the Desktop switch turns it off). */
  enabled: boolean;
  /** False for a paired phone: only operator connections manage pairing. */
  canManage: boolean;
  pairedDeviceCount: number;
  hostInstanceId: string;
  /** WebSocket address a pairing code points phones at. */
  advertisedEndpoint?: string;
};

export type HostPairingCodeData = MobileAccessPairingCodeData;
export type HostPairingDeviceListData = MobileAccessDeviceListData;

const HOST_PAIRING_COMMAND_TYPE_SET = new Set<string>(HOST_PAIRING_COMMAND_TYPES);
const MAX_DEVICE_ID_LENGTH = 256;

export function isHostPairingCommandType(value: unknown): value is HostPairingCommandType {
  return typeof value === 'string' && HOST_PAIRING_COMMAND_TYPE_SET.has(value);
}

/** Payload check for commands arriving from the wire. */
export function isHostPairingCommand(value: unknown): value is HostPairingCommand {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isHostPairingCommandType(record.type)) {
    return false;
  }
  if (record.type === 'host/pairing-revoke-device') {
    const deviceId = record.deviceId;
    return (
      typeof deviceId === 'string' &&
      deviceId.trim().length > 0 &&
      deviceId.length <= MAX_DEVICE_ID_LENGTH
    );
  }
  const advertised = record.advertisedEndpoint;
  const advertisedValid = advertised === undefined || typeof advertised === 'string';
  if (record.type === 'host/pairing-set-enabled') {
    return typeof record.enabled === 'boolean' && advertisedValid;
  }
  if (record.type === 'host/pairing-create-code') {
    return advertisedValid;
  }
  return true;
}

export function readHostPairingStatusData(value: unknown): HostPairingStatusData | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.enabled !== 'boolean' ||
    typeof record.canManage !== 'boolean' ||
    typeof record.pairedDeviceCount !== 'number' ||
    typeof record.hostInstanceId !== 'string'
  ) {
    return undefined;
  }
  const status: HostPairingStatusData = {
    enabled: record.enabled,
    canManage: record.canManage,
    pairedDeviceCount: record.pairedDeviceCount,
    hostInstanceId: record.hostInstanceId,
  };
  if (typeof record.advertisedEndpoint === 'string' && record.advertisedEndpoint.length > 0) {
    status.advertisedEndpoint = record.advertisedEndpoint;
  }
  return status;
}
