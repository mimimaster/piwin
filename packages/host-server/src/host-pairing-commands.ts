/**
 * `host/pairing-*` for shells attached to this Host server (ADR 0075).
 *
 * The server that owns the pairing registry answers these itself; they never
 * reach HostRuntime. Operator connections (auth token or anonymous loopback)
 * manage pairing; a paired phone only reads status, so one phone can never
 * enroll another. Nothing here opens or closes a listener.
 */
import type {
  HostPairingCommand,
  HostPairingStatusData,
  HostResponse,
} from '@piwin/contracts';
import { isHostPairingCommand } from '@piwin/contracts';
import type { HostDevicePairing } from './device-pairing.js';
import type { HostDevicePairingFileStore } from './device-pairing-store.js';
import {
  countActivePairedDevices,
  listPairedDevices,
  mintPairingCode,
  revokePairedDevice,
  type PairingRegistry,
} from './pairing-operations.js';

export const HOST_PAIRING_DISABLED_ERROR =
  'Device pairing is not enabled on this Host. Restart it with PIWIN_HOST_PAIRING=1.';
export const HOST_PAIRING_DEVICE_FORBIDDEN_ERROR = 'Paired devices cannot manage pairing';

export type HostPairingCommandContext = {
  pairing: HostDevicePairing | undefined;
  store: HostDevicePairingFileStore | undefined;
  hostInstanceId: string;
  bindHost: string;
  /** Address phones dial; the bound URL when the operator configured none. */
  advertisedEndpoint: string | undefined;
  /** Set when the caller authenticated as a paired device. */
  callerDeviceId: string | undefined;
  onRevoked: (deviceId: string) => void;
};

export async function handleHostPairingCommand(
  command: HostPairingCommand,
  context: HostPairingCommandContext,
): Promise<HostResponse> {
  const respond = (result: { data: unknown } | { error: string }): HostResponse => ({
    type: 'response',
    command: command.type,
    ...('error' in result
      ? { success: false as const, error: result.error }
      : { success: true as const, data: result.data }),
    ...(command.id === undefined ? {} : { id: command.id }),
  });

  if (!isHostPairingCommand(command)) {
    return respond({ error: `Invalid ${String((command as { type?: unknown }).type)} payload` });
  }
  const registry: PairingRegistry | undefined =
    context.pairing === undefined ? undefined : { pairing: context.pairing, store: context.store };
  const isOperator = context.callerDeviceId === undefined;

  if (command.type === 'host/pairing-status') {
    const status: HostPairingStatusData = {
      enabled: registry !== undefined,
      canManage: registry !== undefined && isOperator,
      pairedDeviceCount: registry === undefined ? 0 : countActivePairedDevices(registry),
      hostInstanceId: context.hostInstanceId,
    };
    if (registry !== undefined && context.advertisedEndpoint !== undefined) {
      status.advertisedEndpoint = context.advertisedEndpoint;
    }
    return respond({ data: status });
  }
  if (registry === undefined) {
    return respond({ error: HOST_PAIRING_DISABLED_ERROR });
  }
  if (!isOperator) {
    return respond({ error: HOST_PAIRING_DEVICE_FORBIDDEN_ERROR });
  }

  try {
    switch (command.type) {
      case 'host/pairing-create-code':
        return respond({
          data: await mintPairingCode(registry, {
            advertisedEndpoint: context.advertisedEndpoint ?? '',
            bindHost: context.bindHost,
            hostInstanceId: context.hostInstanceId,
          }),
        });
      case 'host/pairing-list-devices':
        return respond({ data: { devices: listPairedDevices(registry) } });
      case 'host/pairing-revoke-device':
        return respond({
          data: await revokePairedDevice(registry, command.deviceId, context.onRevoked),
        });
    }
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : 'Pairing command failed' });
  }
}
