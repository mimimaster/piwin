import type {
  HostClientHello,
  HostHelloRejectReason,
  RemoteDeviceRole,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import { isTrustedDeviceCredential } from '@piwin/contracts';
import { deviceRoleOf, DevicePairingError, type HostDevicePairing } from './device-pairing.js';

export type HostHelloAuthSuccess = {
  ok: true;
  admittedBy: 'loopback' | 'token' | 'device';
  pairedDeviceId?: string;
  pairedDeviceRole?: RemoteDeviceRole;
  issuedDeviceSecret?: string;
};

export type HostHelloAuthFailure = {
  ok: false;
  reason: HostHelloRejectReason;
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
  /**
   * ADR 0101: the client static key when the hello arrived over the
   * end-to-end channel. Only device keys are valid there, and a device must
   * be bound to exactly this key.
   */
  channelPublicKey?: string;
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
  const hasPairingToken =
    message.pairingToken !== undefined && message.pairingToken.trim().length > 0;
  const hasAuthToken = message.authToken !== undefined && message.authToken.length > 0;
  const keyCount = Number(hasDeviceCredential) + Number(hasPairingToken) + Number(hasAuthToken);
  if (keyCount > 1) {
    return {
      ok: false,
      reason: 'multiple-admission-keys',
      message: 'Hello must present exactly one admission key',
    };
  }

  if (
    context.channelPublicKey !== undefined &&
    (hasAuthToken || (!hasPairingToken && !hasDeviceCredential))
  ) {
    // The channel admits devices only: no token door, no anonymous hello.
    return hasAuthToken
      ? {
          ok: false,
          reason: 'authentication-failed',
          message: 'Tokens are not accepted on the encrypted channel',
        }
      : { ok: false, reason: 'pairing-required', message: 'A paired device is required' };
  }

  if (!hasPairingToken && !hasDeviceCredential && !hasAuthToken) {
    if (context.allowAnonymousHello) {
      return { ok: true, admittedBy: 'loopback' };
    }
    // Never fall through to success without a key: with no token configured
    // (e.g. pairing switched off at runtime) that would admit anyone.
    if (context.authToken === undefined) {
      return context.devicePairing === undefined
        ? {
            ok: false,
            reason: 'access-token-required',
            message:
              'This Host needs an access token (PIWIN_HOST_TOKEN) for connections from other machines',
          }
        : { ok: false, reason: 'pairing-required', message: 'A paired device is required' };
    }
    // Nothing was presented, so this is a missing token rather than a wrong one.
    return { ok: false, reason: 'access-token-required', message: 'Host authentication failed' };
  }

  if (hasPairingToken || hasDeviceCredential) {
    if (context.devicePairing === undefined) {
      return { ok: false, reason: 'pairing-disabled', message: 'Device pairing is not enabled' };
    }
    if (hasPairingToken) {
      const snapshot = context.devicePairing.exportState();
      try {
        const completion = context.devicePairing.completePairing(
          message.pairingToken ?? '',
          message.deviceName ?? message.clientId,
          message.clientId,
          context.channelPublicKey,
        );
        await context.persistEnrollment(context.devicePairing);
        return {
          ok: true,
          admittedBy: 'device',
          pairedDeviceId: completion.credential.deviceId,
          pairedDeviceRole: deviceRoleOf(completion.device),
          issuedDeviceSecret: completion.credential.deviceSecret,
        };
      } catch (error) {
        context.devicePairing.restoreState(snapshot);
        return {
          ok: false,
          reason: error instanceof DevicePairingError ? error.reason : 'authentication-failed',
          message: error instanceof Error ? error.message : 'Device authentication failed',
        };
      }
    }

    if (!isTrustedDeviceCredential(message.deviceCredential)) {
      return {
        ok: false,
        reason: 'device-credential-revoked',
        message: 'Device credential is invalid or revoked',
      };
    }
    const device = context.devicePairing.authenticate(
      message.deviceCredential as TrustedDeviceCredential,
      message.clientId,
      context.channelPublicKey,
    );
    if (device === undefined) {
      return {
        ok: false,
        reason: 'device-credential-revoked',
        message: 'Device credential is invalid or revoked',
      };
    }
    return {
      ok: true,
      admittedBy: 'device',
      pairedDeviceId: device.id,
      pairedDeviceRole: deviceRoleOf(device),
    };
  }

  // A presented authToken can only be validated against a configured token.
  // With none configured, an unverifiable token must never grant more than
  // the anonymous path would: admit only where anonymous hello is allowed
  // (direct loopback, e.g. a shell with a stale saved token), otherwise fail
  // closed so an arbitrary token cannot take operator control.
  if (context.authToken === undefined) {
    return context.allowAnonymousHello
      ? { ok: true, admittedBy: 'loopback' }
      : { ok: false, reason: 'authentication-failed', message: 'Host authentication failed' };
  }
  if (!context.tokensEqual(context.authToken, message.authToken)) {
    return { ok: false, reason: 'authentication-failed', message: 'Host authentication failed' };
  }

  return { ok: true, admittedBy: 'token' };
}

export function isWildcardHostBind(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
}
