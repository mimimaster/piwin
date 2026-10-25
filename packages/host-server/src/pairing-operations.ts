/**
 * Pairing-code, device-list and revoke operations over one pairing registry.
 *
 * Shared by the sidecar's phone listener (local IPC) and the Host server's
 * operator-facing `host/pairing-*` commands, so both mint the same QR payload
 * and revoke with the same side effects.
 */
import type {
  MobileAccessPairingCodeData,
  PairedDeviceSummary,
  RemoteDeviceRole,
} from '@piwin/contracts';
import { projectPairedDeviceSummary } from '@piwin/contracts';
import type { HostDevicePairing } from './device-pairing.js';
import type { HostDevicePairingFileStore } from './device-pairing-store.js';
import { createPairingQrPayload, pairingQrUri } from './pairing-qr.js';

export type PairingRegistry = {
  pairing: HostDevicePairing;
  store: HostDevicePairingFileStore | undefined;
};

/** ADR 0101: builds the v3 channel links for a freshly minted token, when the channel is set up. */
export type PairingChannelLinks = (token: {
  pairingToken: string;
  expiresAt: number;
  role: RemoteDeviceRole;
}) => { channelUri: string; webUri?: string } | undefined;

async function persistPairing(registry: PairingRegistry): Promise<void> {
  if (registry.store === undefined) {
    return;
  }
  await registry.store.save(registry.pairing);
}

/** A new code replaces any unused one: only the newest QR is ever valid. */
export async function mintPairingCode(
  registry: PairingRegistry,
  input: {
    advertisedEndpoint: string;
    hostInstanceId: string;
    role?: RemoteDeviceRole;
    channelLinks?: PairingChannelLinks;
  },
): Promise<MobileAccessPairingCodeData> {
  const advertised = input.advertisedEndpoint.trim();
  if (advertised.length === 0) {
    throw new Error('An advertised WebSocket endpoint is required to mint a pairing QR');
  }
  registry.pairing.invalidatePendingTokens();
  const role = input.role ?? 'member';
  const minted = registry.pairing.mintToken(role);
  await persistPairing(registry);
  const payload = createPairingQrPayload({
    advertisedEndpoint: advertised,
    pairingToken: minted.token,
    hostInstanceId: input.hostInstanceId,
    expiresAt: minted.expiresAt,
  });
  const links = input.channelLinks?.({
    pairingToken: minted.token,
    expiresAt: minted.expiresAt,
    role,
  });
  return {
    endpoint: payload.endpoint,
    pairingToken: payload.pairingToken,
    hostInstanceId: payload.hostInstanceId,
    protocolVersion: payload.protocolVersion,
    expiresAt: payload.expiresAt,
    uri: pairingQrUri(payload),
    ...(links === undefined ? {} : links),
  };
}

export function listPairedDevices(registry: PairingRegistry): PairedDeviceSummary[] {
  return registry.pairing.list().map((device) => projectPairedDeviceSummary(device));
}

export function countActivePairedDevices(registry: PairingRegistry): number {
  return registry.pairing.list().filter((device) => device.revokedAt === undefined).length;
}

/** `onRevoked` drops the device's live sockets and tool routes. */
export async function revokePairedDevice(
  registry: PairingRegistry,
  deviceId: string,
  onRevoked: (deviceId: string) => void,
): Promise<{ revoked: boolean }> {
  const normalized = deviceId.trim();
  const revoked = registry.pairing.revoke(normalized);
  if (revoked) {
    onRevoked(normalized);
    await persistPairing(registry);
  }
  return { revoked };
}
