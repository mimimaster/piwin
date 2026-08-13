/**
 * Bound how many sandboxed Artifact iframes may stay mounted at once.
 * Waiters re-admit when a slot frees (release / eviction), so a recycled
 * frame does not stay blank forever while still mounted in the virtual list.
 */

/** Hard cap on concurrent live Artifact iframes in the Desktop shell. */
export const MAX_LIVE_ARTIFACT_IFRAMES = 3;

export type ArtifactLiveHostRegistration = {
  id: string;
  /**
   * Stream-preview / Canvas must not be evicted for budget.
   * They can push the live count above the soft cap briefly.
   */
  forceKeep?: boolean;
  /** Higher wins when choosing whom to keep or promote from the wait queue. */
  priority?: number;
  /** Called when this host is sacrificed so another may mount. */
  evict: () => void;
  /**
   * Called when a previously denied claim is later admitted (slot freed).
   * The frame should set hostIframe=true and proceed to init.
   */
  onAdmit?: () => void;
};

type LiveEntry = {
  id: string;
  forceKeep: boolean;
  priority: number;
  lastTouchAt: number;
  evict: () => void;
  onAdmit?: () => void;
};

const hosts = new Map<string, LiveEntry>();
/** Denied claims waiting for a free slot (id → registration). */
const waiters = new Map<string, LiveEntry>();

export function getLiveArtifactHostCount(): number {
  return hosts.size;
}

export function getWaitingArtifactHostCount(): number {
  return waiters.size;
}

export function getLiveArtifactHostIdsForTests(): string[] {
  return [...hosts.keys()];
}

export function getWaitingArtifactHostIdsForTests(): string[] {
  return [...waiters.keys()];
}

export function resetArtifactLiveHostRegistryForTests(): void {
  hosts.clear();
  waiters.clear();
}

function toEntry(registration: ArtifactLiveHostRegistration, now: number): LiveEntry {
  const entry: LiveEntry = {
    id: registration.id,
    forceKeep: registration.forceKeep === true,
    priority: registration.priority ?? 0,
    lastTouchAt: now,
    evict: registration.evict,
  };
  if (registration.onAdmit) {
    entry.onAdmit = registration.onAdmit;
  }
  return entry;
}

function pickVictim(excludeId: string): LiveEntry | null {
  let victim: LiveEntry | null = null;
  for (const entry of hosts.values()) {
    if (entry.id === excludeId || entry.forceKeep) {
      continue;
    }
    if (!victim) {
      victim = entry;
      continue;
    }
    if (entry.priority < victim.priority) {
      victim = entry;
      continue;
    }
    if (entry.priority === victim.priority && entry.lastTouchAt < victim.lastTouchAt) {
      victim = entry;
    }
  }
  return victim;
}

function pickBestWaiter(): LiveEntry | null {
  let best: LiveEntry | null = null;
  for (const entry of waiters.values()) {
    if (!best) {
      best = entry;
      continue;
    }
    if (entry.priority > best.priority) {
      best = entry;
      continue;
    }
    if (entry.priority === best.priority && entry.lastTouchAt > best.lastTouchAt) {
      best = entry;
    }
  }
  return best;
}

function evictEntry(entry: LiveEntry): void {
  hosts.delete(entry.id);
  try {
    entry.evict();
  } catch {
    // Eviction must not break the admit path.
  }
}

function admitEntry(entry: LiveEntry): void {
  waiters.delete(entry.id);
  hosts.set(entry.id, entry);
  if (entry.onAdmit) {
    try {
      entry.onAdmit();
    } catch {
      // Best-effort; frame may already be unmounted.
    }
  }
}

/**
 * After a slot frees, promote the highest-priority waiter (may chain if
 * forceKeep waiters exceed the soft cap only when forceKeep claims).
 */
function promoteWaiters(): void {
  while (hosts.size < MAX_LIVE_ARTIFACT_IFRAMES) {
    const next = pickBestWaiter();
    if (!next) {
      return;
    }
    // Re-check: forceKeep can always enter even if we somehow over-count.
    if (hosts.size >= MAX_LIVE_ARTIFACT_IFRAMES && !next.forceKeep) {
      return;
    }
    admitEntry({ ...next, lastTouchAt: Date.now() });
  }
}

/**
 * Claim a live iframe slot. May immediately evict a lower-priority host.
 * If denied, the registration stays in the wait queue and `onAdmit` fires later.
 */
export function claimArtifactLiveHost(
  registration: ArtifactLiveHostRegistration,
): { admitted: boolean } {
  const now = Date.now();
  const entry = toEntry(registration, now);
  waiters.delete(registration.id);

  const existing = hosts.get(registration.id);
  if (existing) {
    existing.forceKeep = entry.forceKeep;
    existing.priority = entry.priority;
    existing.lastTouchAt = now;
    existing.evict = entry.evict;
    if (entry.onAdmit) {
      existing.onAdmit = entry.onAdmit;
    }
    return { admitted: true };
  }

  while (hosts.size >= MAX_LIVE_ARTIFACT_IFRAMES) {
    const victim = pickVictim(registration.id);
    if (!victim) {
      break;
    }
    evictEntry(victim);
  }

  if (hosts.size >= MAX_LIVE_ARTIFACT_IFRAMES && !entry.forceKeep) {
    waiters.set(entry.id, entry);
    return { admitted: false };
  }

  hosts.set(entry.id, entry);
  return { admitted: true };
}

export function releaseArtifactLiveHost(id: string): void {
  const wasLive = hosts.delete(id);
  waiters.delete(id);
  if (wasLive) {
    promoteWaiters();
  }
}

/**
 * User-driven retry: boost priority and try to claim again (may evict others).
 * Returns whether the iframe may mount now.
 */
export function requestArtifactLiveHost(
  registration: ArtifactLiveHostRegistration,
): { admitted: boolean } {
  return claimArtifactLiveHost({
    ...registration,
    priority: Math.max(registration.priority ?? 0, 500),
  });
}
