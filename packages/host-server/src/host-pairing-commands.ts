/**
 * `host/pairing-*` for shells attached to this Host server (ADR 0075).
 *
 * The server that owns the pairing registry answers these itself; they never
 * reach HostRuntime. Operator connections (auth token or anonymous loopback)
 * manage pairing; a paired phone only reads status, so one phone can never
 * enroll another. `host/pairing-set-enabled` toggles admission of paired
 * devices on the existing listener; nothing here opens or closes a listener.
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
  'Device pairing is turned off on this Host. Turn on phone access in Desktop settings.';
export const HOST_PAIRING_DEVICE_FORBIDDEN_ERROR = 'Paired devices cannot manage pairing';

export type HostPairingCommandContext = {
  pairing: HostDevicePairing | undefined;
  store: HostDevicePairingFileStore | undefined;
  hostInstanceId: string;
  /** Address phones dial; the bound URL when the operator configured none. */
  advertisedEndpoint: string | undefined;
  /** Set when the caller authenticated as a paired device. */
  callerDeviceId: string | undefined;
  onRevoked: (deviceId: string) => void;
  /** Explicit enable flag when dynamic toggle is supported. */
  pairingEnabled?: boolean;
  /** Callback to dynamically toggle pairing and optionally update advertised endpoint. */
  setEnabled?: (enabled: boolean, advertisedEndpoint?: string) => Promise<void> | void;
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
  const isEnabled = context.pairingEnabled ?? (registry !== undefined);

  if (command.type === 'host/pairing-status') {
    const canManage = isOperator && (registry !== undefined || context.setEnabled !== undefined);
    const status: HostPairingStatusData = {
      enabled: isEnabled,
      canManage,
      pairedDeviceCount: registry === undefined ? 0 : countActivePairedDevices(registry),
      hostInstanceId: context.hostInstanceId,
    };
    if (isEnabled && context.advertisedEndpoint !== undefined) {
      status.advertisedEndpoint = context.advertisedEndpoint;
    }
    return respond({ data: status });
  }

  if (command.type === 'host/pairing-set-enabled') {
    if (!isOperator) {
      return respond({ error: HOST_PAIRING_DEVICE_FORBIDDEN_ERROR });
    }
    if (context.setEnabled === undefined) {
      return respond({ error: 'This Host does not support dynamic pairing configuration' });
    }
    try {
      await context.setEnabled(command.enabled, command.advertisedEndpoint);
      const effectiveEndpoint = command.advertisedEndpoint ?? context.advertisedEndpoint;
      const status: HostPairingStatusData = {
        enabled: command.enabled,
        canManage: true,
        pairedDeviceCount: registry === undefined ? 0 : countActivePairedDevices(registry),
        hostInstanceId: context.hostInstanceId,
      };
      if (effectiveEndpoint !== undefined) {
        status.advertisedEndpoint = effectiveEndpoint;
      }
      return respond({ data: status });
    } catch (error) {
      return respond({
        error: error instanceof Error ? error.message : 'Failed to update pairing setting',
      });
    }
  }

  if (registry === undefined || !isEnabled) {
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
            advertisedEndpoint: command.advertisedEndpoint ?? context.advertisedEndpoint ?? '',
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
