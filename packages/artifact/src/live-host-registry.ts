/**
 * Bound how many sandboxed Artifact iframes may stay mounted at once.
 * Viewport TTL still applies; this registry is the hard ceiling so a long
 * transcript cannot keep dozens of live WebContent documents around.
 */

/** Hard cap on concurrent live Inline/Canvas artifact iframes in the Desktop shell. */
export const MAX_LIVE_ARTIFACT_IFRAMES = 2;

export type ArtifactLiveHostRegistration = {
  id: string;
  /**
   * Stream-preview / Canvas must not be evicted for budget.
   * They can push the live count above the soft cap briefly.
   */
  forceKeep?: boolean;
  /** Higher wins when choosing whom to keep (intersecting ≫ off-screen). */
  priority?: number;
  /** Called when this host is sacrificed so another may mount. */
  evict: () => void;
};

type LiveEntry = {
  id: string;
  forceKeep: boolean;
  priority: number;
  lastTouchAt: number;
  evict: () => void;
};

const hosts = new Map<string, LiveEntry>();

export function getLiveArtifactHostCount(): number {
  return hosts.size;
}

export function getLiveArtifactHostIdsForTests(): string[] {
  return [...hosts.keys()];
}

export function resetArtifactLiveHostRegistryForTests(): void {
  hosts.clear();
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

function evictEntry(entry: LiveEntry): void {
  hosts.delete(entry.id);
  try {
    entry.evict();
  } catch {
    // Eviction must not break the admit path; the host unmount is best-effort.
  }
}

/**
 * Claim a live iframe slot. May immediately evict a lower-priority host.
 * Returns whether this id is admitted into the live set (caller should mount).
 */
export function claimArtifactLiveHost(
  registration: ArtifactLiveHostRegistration,
): { admitted: boolean } {
  const forceKeep = registration.forceKeep === true;
  const priority = registration.priority ?? 0;
  const now = Date.now();
  const existing = hosts.get(registration.id);
  if (existing) {
    existing.forceKeep = forceKeep;
    existing.priority = priority;
    existing.lastTouchAt = now;
    existing.evict = registration.evict;
    return { admitted: true };
  }

  while (hosts.size >= MAX_LIVE_ARTIFACT_IFRAMES) {
    const victim = pickVictim(registration.id);
    if (!victim) {
      break;
    }
    evictEntry(victim);
  }

  if (hosts.size >= MAX_LIVE_ARTIFACT_IFRAMES && !forceKeep) {
    return { admitted: false };
  }

  hosts.set(registration.id, {
    id: registration.id,
    forceKeep,
    priority,
    lastTouchAt: now,
    evict: registration.evict,
  });
  return { admitted: true };
}

/** Update priority / liveness without re-evicting. No-op if not registered. */
export function touchArtifactLiveHost(
  id: string,
  patch: { priority?: number; forceKeep?: boolean } = {},
): void {
  const entry = hosts.get(id);
  if (!entry) {
    return;
  }
  if (patch.priority !== undefined) {
    entry.priority = patch.priority;
  }
  if (patch.forceKeep !== undefined) {
    entry.forceKeep = patch.forceKeep;
  }
  entry.lastTouchAt = Date.now();
}

export function releaseArtifactLiveHost(id: string): void {
  hosts.delete(id);
}
