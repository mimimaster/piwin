import type { HostClient } from '../host/host-client.js';
import type { DesktopRemoteHostTarget } from '../host/remote-host-session.js';

/** A Host-book id survives address roaming; a legacy attach has only its endpoint. */
export function sessionSnapshotHostKey(target: DesktopRemoteHostTarget | undefined): string | null {
  const key = target?.hostId?.trim() || target?.endpoint.trim() || '';
  return key.length > 0 ? key : null;
}

/** Stable across process restarts; a Host instance id changes on every boot. */
export function sessionCacheHostKey(
  hostClient: Pick<HostClient, 'getTransport'> & Partial<Pick<HostClient, 'getRemoteTarget'>>,
): string | null {
  const transport = hostClient.getTransport();
  if (transport === 'mock') return null;
  if (transport === 'live') return 'local';
  return sessionSnapshotHostKey(hostClient.getRemoteTarget?.());
}
