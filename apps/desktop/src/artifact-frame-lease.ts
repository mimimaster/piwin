import { ARTIFACT_READY_TIMEOUT_MS } from '@piwin/artifact';
import {
  cancelArtifactInit,
  releaseArtifactInit,
  requestArtifactInit,
} from './artifact-init-queue.js';
import {
  claimArtifactLiveHost,
  releaseArtifactLiveHost,
  requestArtifactLiveHost,
  type ArtifactLiveHostRegistration,
} from './artifact-live-host-registry.js';

export const ARTIFACT_INIT_LEASE_TIMEOUT_MS = ARTIFACT_READY_TIMEOUT_MS;

/** What a frame holds from the two Artifact schedulers at one moment. */
export type ArtifactFrameLeaseSnapshot = {
  /** The frame has asked for a live-host slot at least once since `release`. */
  claimed: boolean;
  /** The frame may mount an iframe. False once it is denied or evicted. */
  hostIframe: boolean;
  /** A slot was held at some point, so a missing one means "recycled". */
  everAdmitted: boolean;
  /** The frame's turn to load its document has come. */
  initGranted: boolean;
  loaded: boolean;
};

export type ArtifactFrameHostRank = {
  forceKeep: boolean;
  priority: number;
};

/**
 * One frame's hold on the live-iframe budget and the init queue.
 *
 * Both schedulers are process-wide and hand out slots that must be given back
 * exactly once. Keeping the bookkeeping in one object outside React means a
 * frame returns everything it holds through a single `release`, whatever state
 * it was in, instead of through the cleanup order of several effects.
 */
export type ArtifactFrameLease = {
  getSnapshot: () => ArtifactFrameLeaseSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Claim a live-host slot, or re-rank the one already held. */
  claim: (rank: ArtifactFrameHostRank) => void;
  setInitPriority: (priority: number) => void;
  /** The iframe finished loading: the init queue may start the next frame. */
  markIframeLoaded: () => void;
  /** User asked for a recycled preview back; may evict another frame. */
  requestHost: () => void;
  /** Give back the live-host slot, the init slot, and every pending timer. */
  release: () => void;
};

const UNCLAIMED_SNAPSHOT: ArtifactFrameLeaseSnapshot = {
  claimed: false,
  // An unclaimed frame renders its empty stage, not the "preview paused"
  // placeholder: it has not been denied anything yet.
  hostIframe: true,
  everAdmitted: false,
  initGranted: false,
  loaded: false,
};

export function createArtifactFrameLease(
  channelId: string,
  options: { initPriority?: number } = {},
): ArtifactFrameLease {
  let snapshot = UNCLAIMED_SNAPSHOT;
  let rank: ArtifactFrameHostRank = { forceKeep: false, priority: 0 };
  let initPriority = options.initPriority ?? 0;
  /** Bumped whenever a pending init request stops being wanted. */
  let initGeneration = 0;
  let initRequested = false;
  let initSlotActive = false;
  let initTimeout: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const update = (patch: Partial<ArtifactFrameLeaseSnapshot>): void => {
    const next = { ...snapshot, ...patch };
    const changed = (Object.keys(patch) as (keyof ArtifactFrameLeaseSnapshot)[]).some(
      (key) => snapshot[key] !== next[key],
    );
    if (!changed) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const clearInitTimeout = (): void => {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
  };

  const endInit = (): void => {
    if (!initRequested) return;
    initRequested = false;
    initGeneration += 1;
    initSlotActive = false;
    clearInitTimeout();
    cancelArtifactInit(channelId);
    releaseArtifactInit(channelId);
  };

  const beginInit = (): void => {
    endInit();
    initRequested = true;
    const generation = initGeneration;
    void requestArtifactInit(channelId, { priority: initPriority }).then(() => {
      if (generation !== initGeneration) {
        // Abandoned while it waited. `endInit` already gave the slot back;
        // releasing here would free the slot a newer request of this same
        // frame now holds and let a second document load beside it.
        return;
      }
      initSlotActive = true;
      update({ initGranted: true });
      clearInitTimeout();
      // A document that never fires `load` must not hold up every frame
      // queued behind it; the frame keeps its grant, only the slot moves on.
      initTimeout = setTimeout(() => {
        initTimeout = null;
        if (initSlotActive) {
          initSlotActive = false;
          releaseArtifactInit(channelId);
        }
      }, ARTIFACT_INIT_LEASE_TIMEOUT_MS);
    });
  };

  const setHosted = (hosted: boolean): void => {
    if (!hosted) {
      endInit();
      update({ hostIframe: false, initGranted: false, loaded: false });
      return;
    }
    const wasHosted = snapshot.claimed && snapshot.hostIframe;
    update({ hostIframe: true, everAdmitted: true });
    if (!wasHosted || !initRequested) {
      update({ initGranted: false, loaded: false });
      beginInit();
    }
  };

  const registration = (): ArtifactLiveHostRegistration => ({
    id: channelId,
    forceKeep: rank.forceKeep,
    priority: rank.priority,
    evict: () => setHosted(false),
    onAdmit: () => setHosted(true),
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    claim(nextRank) {
      rank = nextRank;
      const { admitted } = claimArtifactLiveHost(registration());
      update({ claimed: true });
      setHosted(admitted);
    },
    setInitPriority(priority) {
      initPriority = priority;
    },
    markIframeLoaded() {
      update({ loaded: true });
      if (!initSlotActive) return;
      initSlotActive = false;
      clearInitTimeout();
      releaseArtifactInit(channelId);
    },
    requestHost() {
      if (requestArtifactLiveHost(registration()).admitted) {
        setHosted(true);
      }
    },
    release() {
      endInit();
      releaseArtifactLiveHost(channelId);
      // Not announced: the only subscriber is the frame that is going away.
      snapshot = UNCLAIMED_SNAPSHOT;
    },
  };
}
