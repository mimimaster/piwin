import { formatError, type HostHelloRejectReason } from '@piwin/contracts';
import { HostHandshakeError } from '@piwin/host-transport';
import { primeDeviceCredential } from './device-admission.js';
import {
  createDesktopRemoteHostClient,
  createDesktopRemoteHostProbeClientId,
  isDesktopRemoteHostEndpoint,
  peekLiveDesktopRemoteHost,
  readRemoteHostInstanceId,
  sameDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';

export type ProbeDesktopRemoteHostResult =
  | { ok: true; target: DesktopRemoteHostTarget; hostInstanceId?: string }
  | {
      ok: false;
      error: string;
      /** Set when the Host classified its refusal; the caller localizes from it. */
      reason?: HostHelloRejectReason;
    };

/**
 * One-shot WebSocket hello + host/status. Does not persist the target.
 * Used by the boot connect wall and Settings → Remote Host.
 */
export async function probeDesktopRemoteHost(input: {
  endpoint: string;
  authToken?: string;
  /** One-time pairing token from a scanned code; the probe performs the enrolment. */
  pairingToken?: string;
  invalidEndpointMessage: string;
}): Promise<ProbeDesktopRemoteHostResult> {
  const normalizedEndpoint = input.endpoint.trim();
  if (!isDesktopRemoteHostEndpoint(normalizedEndpoint)) {
    return { ok: false, error: input.invalidEndpointMessage };
  }

  const trimmedToken = input.authToken?.trim() ?? '';
  const target: DesktopRemoteHostTarget =
    trimmedToken.length === 0
      ? { endpoint: normalizedEndpoint }
      : { endpoint: normalizedEndpoint, authToken: trimmedToken };

  const pairingToken = input.pairingToken?.trim() ?? '';
  // A stored credential for this Host must be in memory before the hello.
  await primeDeviceCredential(normalizedEndpoint);

  const live = peekLiveDesktopRemoteHost();
  if (live !== undefined && live.isReady() && sameDesktopRemoteHostTarget(live.target, target)) {
    const status = await live.requestStatus();
    if (!status.ok) {
      return { ok: false, error: status.error };
    }
    return status.hostInstanceId === undefined
      ? { ok: true, target }
      : { ok: true, target, hostInstanceId: status.hostInstanceId };
  }

  // Building the client validates its options and can throw; keep that inside
  // the result contract so callers never see a rejection.
  let probe: ReturnType<typeof createDesktopRemoteHostClient> | undefined;
  try {
    probe = createDesktopRemoteHostClient(target, {
      autoReconnect: false,
      clientId: createDesktopRemoteHostProbeClientId(),
      ...(pairingToken.length === 0 ? {} : { pairingToken }),
    });
    await probe.connect();
    const status = await probe.request({ type: 'host/status' });
    if (!status.success) {
      return { ok: false, error: status.error };
    }
    const hostInstanceId =
      readRemoteHostInstanceId(status.data) ?? probe.getHostHello()?.hostInstanceId;
    return hostInstanceId === undefined
      ? { ok: true, target }
      : { ok: true, target, hostInstanceId };
  } catch (error) {
    return error instanceof HostHandshakeError && error.reason !== undefined
      ? { ok: false, error: formatError(error), reason: error.reason }
      : { ok: false, error: formatError(error) };
  } finally {
    try {
      await probe?.close();
    } catch {
      // Probe is only used to validate; App owns the live client.
    }
  }
}
