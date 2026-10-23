/**
 * Tracks which sandboxed Artifact iframes are mounted, so memory pressure can
 * reclaim them. There is no count budget: every preview mounts until the
 * Memory Governor reports critical pressure (artifact-memory-bridge.ts).
 *
 * Under critical pressure every host except the pinned ones (live streaming
 * preview, active Canvas) is evicted, and new unpinned claims start recycled
 * until pressure clears, so the freed memory is not refilled right away.
 * Leaving critical never remounts anything by itself; the user clicks
 * "Load preview", which always mounts.
 */

export type ArtifactLiveHostRegistration = {
  id: string;
  /** Live streaming previews and the active Canvas survive pressure eviction. */
  forceKeep?: boolean;
  /** Called when memory pressure takes this host's iframe away. */
  evict: () => void;
};

type LiveEntry = {
  id: string;
  forceKeep: boolean;
  evict: () => void;
};

const hosts = new Map<string, LiveEntry>();
let pressureHold = false;

export function getLiveArtifactHostCount(): number {
  return hosts.size;
}

export function getLiveArtifactHostIdsForTests(): string[] {
  return [...hosts.keys()];
}

export function resetArtifactLiveHostRegistryForTests(): void {
  hosts.clear();
  pressureHold = false;
}

function evictEntry(entry: LiveEntry): void {
  hosts.delete(entry.id);
  try {
    entry.evict();
  } catch (error) {
    // The frame may already be unmounting; eviction must still finish for the rest.
    console.warn('[artifact-live-host] evict failed:', error);
  }
}

function admit(registration: ArtifactLiveHostRegistration): { admitted: boolean } {
  const existing = hosts.get(registration.id);
  if (existing) {
    existing.forceKeep = registration.forceKeep === true;
    existing.evict = registration.evict;
  } else {
    hosts.set(registration.id, { id: registration.id, forceKeep: registration.forceKeep === true, evict: registration.evict });
  }
  return { admitted: true };
}

/**
 * Mount a preview. Always admitted, except an unpinned new claim while
 * critical pressure holds, which starts recycled ("Load preview").
 */
export function claimArtifactLiveHost(registration: ArtifactLiveHostRegistration): { admitted: boolean } {
  if (pressureHold && registration.forceKeep !== true && !hosts.has(registration.id)) {
    return { admitted: false };
  }
  return admit(registration);
}

/** User clicked "Load preview": mount regardless of pressure. */
export function requestArtifactLiveHost(registration: ArtifactLiveHostRegistration): { admitted: boolean } {
  return admit(registration);
}

export function releaseArtifactLiveHost(id: string): void {
  hosts.delete(id);
}

/**
 * Critical-pressure lifeboat: drop every live iframe that is not forceKeep
 * (canvas / live stream preview) and hold new unpinned claims until
 * `setArtifactHostPressureHold(false)`.
 */
export function evictNonForceKeepArtifactHosts(): number {
  pressureHold = true;
  const victims = [...hosts.values()].filter((entry) => !entry.forceKeep);
  for (const victim of victims) {
    evictEntry(victim);
  }
  return victims.length;
}

/** Pressure left critical: new previews mount again (evicted ones stay recycled). */
export function setArtifactHostPressureHold(hold: boolean): void {
  pressureHold = hold;
}
