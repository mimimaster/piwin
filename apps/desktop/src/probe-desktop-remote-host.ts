import { formatError } from '@piwin/contracts';
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
  | { ok: false; error: string };

/**
 * One-shot WebSocket hello + host/status. Does not persist the target.
 * Used by the boot connect wall and Settings → Remote Host.
 */
export async function probeDesktopRemoteHost(input: {
  endpoint: string;
  authToken?: string;
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

  const probe = createDesktopRemoteHostClient(target, {
    autoReconnect: false,
    clientId: createDesktopRemoteHostProbeClientId(),
  });
  try {
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
    return { ok: false, error: formatError(error) };
  } finally {
    try {
      await probe.close();
    } catch {
      // Probe is only used to validate; App owns the live client.
    }
  }
}
