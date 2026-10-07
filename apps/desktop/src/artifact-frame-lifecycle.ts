import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
} from '@piwin/artifact';
import {
  createArtifactFrameLease,
  type ArtifactFrameLeaseSnapshot,
} from './artifact-frame-lease.js';

export { ARTIFACT_INIT_LEASE_TIMEOUT_MS } from './artifact-frame-lease.js';

export type ArtifactFrameLifecycleState =
  | 'idle'
  | 'waiting-live-host'
  | 'waiting-init-lease'
  | 'bootstrapping'
  | 'streaming'
  | 'ready'
  | 'recycled';

/** The only scheduler object Artifact frame components consume. */
export type ArtifactFrameLease = {
  state: ArtifactFrameLifecycleState;
  hostIframe: boolean;
  initGranted: boolean;
  markIframeLoaded: () => void;
  requestHost: () => void;
};

/** Live streaming Inline and Canvas stay pinned; completed Inline may recycle. */
export function shouldForceKeepArtifactHost(
  presentation: 'inline' | 'canvas',
  streaming: boolean,
): boolean {
  return presentation === 'canvas' || streaming;
}

function resolveHostPriority(presentation: 'inline' | 'canvas', streaming: boolean): number {
  if (presentation === 'canvas') {
    return ARTIFACT_LIVE_PRIORITY_CANVAS;
  }
  return streaming ? ARTIFACT_LIVE_PRIORITY_STREAM : ARTIFACT_LIVE_PRIORITY_VISIBLE;
}

export function resolveArtifactFrameLifecycleState(
  snapshot: ArtifactFrameLeaseSnapshot,
  streaming: boolean,
): ArtifactFrameLifecycleState {
  if (!snapshot.claimed) {
    return 'idle';
  }
  if (!snapshot.hostIframe) {
    return snapshot.everAdmitted ? 'recycled' : 'waiting-live-host';
  }
  if (!snapshot.initGranted) {
    return 'waiting-init-lease';
  }
  if (!snapshot.loaded) {
    return 'bootstrapping';
  }
  return streaming ? 'streaming' : 'ready';
}

/**
 * Binds one frame to its lease. The admission / init / recycle bookkeeping
 * lives in `createArtifactFrameLease`; this hook only ranks the claim from
 * props and releases the lease when the frame goes away.
 */
export function useArtifactFrameLease(input: {
  channelId: string;
  initPriority: number;
  presentation: 'inline' | 'canvas';
  streaming: boolean;
}): ArtifactFrameLease {
  const forceKeep = shouldForceKeepArtifactHost(input.presentation, input.streaming);
  const priority = resolveHostPriority(input.presentation, input.streaming);
  const lease = useMemo(() => createArtifactFrameLease(input.channelId), [input.channelId]);
  const snapshot = useSyncExternalStore(lease.subscribe, lease.getSnapshot, lease.getSnapshot);

  // Declared before the claim so the first init request carries the priority.
  useEffect(() => {
    lease.setInitPriority(input.initPriority);
  }, [lease, input.initPriority]);

  useEffect(() => {
    lease.claim({ forceKeep, priority });
  }, [lease, forceKeep, priority]);

  useEffect(() => () => lease.release(), [lease]);

  const markIframeLoaded = useCallback((): void => lease.markIframeLoaded(), [lease]);
  const requestHost = useCallback((): void => lease.requestHost(), [lease]);

  return {
    state: resolveArtifactFrameLifecycleState(snapshot, input.streaming),
    hostIframe: snapshot.hostIframe,
    initGranted: snapshot.initGranted,
    markIframeLoaded,
    requestHost,
  };
}
