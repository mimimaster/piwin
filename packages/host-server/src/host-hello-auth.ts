import type { HostClientHello, TrustedDeviceCredential } from '@piwin/contracts';
import { isTrustedDeviceCredential } from '@piwin/contracts';
import type { HostDevicePairing } from './device-pairing.js';

export type HostHelloAuthSuccess = {
  ok: true;
  pairedDeviceId?: string;
  issuedDeviceSecret?: string;
};

export type HostHelloAuthFailure = {
  ok: false;
  message: string;
};

export type HostHelloAuthResult = HostHelloAuthSuccess | HostHelloAuthFailure;

export type HostHelloAuthContext = {
  authToken: string | undefined;
  devicePairing: HostDevicePairing | undefined;
  /** Loopback with no door token may omit every admission key. */
  allowAnonymousHello: boolean;
  persistEnrollment: (pairing: HostDevicePairing) => Promise<void>;
  tokensEqual: (expected: string, provided: string | undefined) => boolean;
};

/**
 * Resolve the three admission keys on client/hello. Pairing enrollment is
 * persisted before the caller may send deviceSecret on host/hello. Persist
 * failure rolls the in-memory consume back to the pre-hello snapshot.
 */
export async function authenticateHostHello(
  message: HostClientHello,
  context: HostHelloAuthContext,
): Promise<HostHelloAuthResult> {
  const hasDeviceCredential = message.deviceCredential !== undefined;
  const hasPairingToken = message.pairingToken !== undefined && message.pairingToken.trim().length > 0;
  const hasAuthToken = message.authToken !== undefined && message.authToken.length > 0;
  const keyCount = Number(hasDeviceCredential) + Number(hasPairingToken) + Number(hasAuthToken);
  if (keyCount > 1) {
    return { ok: false, message: 'Hello must present exactly one admission key' };
  }

  if (!hasPairingToken && !hasDeviceCredential && !hasAuthToken) {
    if (context.allowAnonymousHello) {
      return { ok: true };
    }
    if (context.devicePairing !== undefined && context.authToken === undefined) {
      return { ok: false, message: 'A paired device is required' };
    }
  }

  if (hasPairingToken || hasDeviceCredential) {
    if (context.devicePairing === undefined) {
      return { ok: false, message: 'Device pairing is not enabled' };
    }
    if (hasPairingToken) {
      const snapshot = context.devicePairing.exportState();
      try {
        const completion = context.devicePairing.completePairing(
          message.pairingToken ?? '',
          message.deviceName ?? message.clientId,
        );
        await context.persistEnrollment(context.devicePairing);
        return {
          ok: true,
          pairedDeviceId: completion.credential.deviceId,
          issuedDeviceSecret: completion.credential.deviceSecret,
        };
      } catch (error) {
        context.devicePairing.restoreState(snapshot);
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Device authentication failed',
        };
      }
    }

    if (!isTrustedDeviceCredential(message.deviceCredential)) {
      return { ok: false, message: 'Device credential is invalid or revoked' };
    }
    const device = context.devicePairing.authenticate(message.deviceCredential as TrustedDeviceCredential);
    if (device === undefined) {
      return { ok: false, message: 'Device credential is invalid or revoked' };
    }
    return { ok: true, pairedDeviceId: device.id };
  }

  if (context.authToken !== undefined && !context.tokensEqual(context.authToken, message.authToken)) {
    return { ok: false, message: 'Host authentication failed' };
  }

  return { ok: true };
}

export function isWildcardHostBind(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
}
