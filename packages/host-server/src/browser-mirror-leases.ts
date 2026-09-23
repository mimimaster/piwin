import type { HostCommand } from '@piwin/contracts';

/** Stand-in for the legacy unnamed lease (`browser/start` without a lease id). */
const LEGACY_MIRROR_LEASE = 'default';

/**
 * How long a lease survives its connection. A reconnecting client re-asserts
 * its lease within this window, so a network blip neither frees Chromium nor
 * throws away the page it was showing.
 */
export const DISCONNECTED_MIRROR_LEASE_GRACE_MS = 30_000;

/** Track which mirror leases a connection holds after a successful start/stop. */
export function applyBrowserLeaseCommand(held: Set<string>, command: HostCommand): void {
  if (command.type === 'browser/start') {
    held.add(command.leaseId ?? LEGACY_MIRROR_LEASE);
  } else if (command.type === 'browser/stop') {
    held.delete(command.leaseId ?? LEGACY_MIRROR_LEASE);
  }
}

function browserStopOnDisconnect(lease: string): HostCommand {
  return lease === LEGACY_MIRROR_LEASE
    ? { type: 'browser/stop', reason: 'disconnect' }
    : { type: 'browser/stop', leaseId: lease, reason: 'disconnect' };
}

export type DisconnectedMirrorLeaseReaper = {
  /** A connection closed while holding these leases. */
  schedule(leases: Iterable<string>): void;
  dispose(): void;
};

/**
 * Only an unmounting panel sends `browser/stop`. A client that crashes, is
 * killed, or loses its socket never does, and its lease would pin the Host at
 * "multiple mirrors" forever — freezing follow resizes for every other panel.
 * The Host therefore releases a closed connection's leases itself, unless a
 * live connection (usually the same client, reconnected) holds them again.
 */
export function createDisconnectedMirrorLeaseReaper(options: {
  isHeldByLiveConnection: (lease: string) => boolean;
  execute: (command: HostCommand) => Promise<{ success: boolean; error?: string }>;
  onError: (error: Error) => void;
  graceMs?: number;
}): DisconnectedMirrorLeaseReaper {
  const graceMs = options.graceMs ?? DISCONNECTED_MIRROR_LEASE_GRACE_MS;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  async function release(lease: string): Promise<void> {
    if (options.isHeldByLiveConnection(lease)) return;
    try {
      const response = await options.execute(browserStopOnDisconnect(lease));
      if (!response.success) {
        options.onError(new Error(`Disconnected browser mirror lease release failed: ${response.error}`));
      }
    } catch (error) {
      options.onError(
        error instanceof Error ? error : new Error('Disconnected browser mirror lease release failed'),
      );
    }
  }

  return {
    schedule(leases) {
      for (const lease of leases) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          void release(lease);
        }, graceMs);
        timer.unref?.();
        timers.add(timer);
      }
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
