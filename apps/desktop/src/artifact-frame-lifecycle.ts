import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
  ARTIFACT_READY_TIMEOUT_MS,
} from '@piwin/artifact';
import {
  cancelArtifactInit,
  releaseArtifactInit,
  requestArtifactInit,
} from './artifact-init-queue.js';
import {
  claimArtifactLiveHost,
  releaseArtifactLiveHost,
  requestArtifactLiveHost,
} from './artifact-live-host-registry.js';

export const ARTIFACT_INIT_LEASE_TIMEOUT_MS = ARTIFACT_READY_TIMEOUT_MS;

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

function resolveLifecycleState(input: {
  claimed: boolean;
  admitted: boolean;
  everAdmitted: boolean;
  initGranted: boolean;
  loaded: boolean;
  streaming: boolean;
}): ArtifactFrameLifecycleState {
  if (!input.claimed) {
    return 'idle';
  }
  if (!input.admitted) {
    return input.everAdmitted ? 'recycled' : 'waiting-live-host';
  }
  if (!input.initGranted) {
    return 'waiting-init-lease';
  }
  if (!input.loaded) {
    return 'bootstrapping';
  }
  return input.streaming ? 'streaming' : 'ready';
}

/**
 * Explicit iframe admission / init / recycle state machine.
 * Live-iframe budget and init concurrency stay internal to the lease.
 */
export function useArtifactFrameLease(input: {
  channelId: string;
  initPriority: number;
  presentation: 'inline' | 'canvas';
  streaming: boolean;
}): ArtifactFrameLease {
  const forceKeep = shouldForceKeepArtifactHost(input.presentation, input.streaming);
  const priority = resolveHostPriority(input.presentation, input.streaming);
  const [hostIframe, setHostIframe] = useState(true);
  const [initGranted, setInitGranted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const everAdmittedRef = useRef(false);
  const initSlotActiveRef = useRef(false);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initPriorityRef = useRef(input.initPriority);
  initPriorityRef.current = input.initPriority;

  const clearInitTimeout = useCallback((): void => {
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
  }, []);

  const releaseInitSlot = useCallback((): void => {
    clearInitTimeout();
    if (!initSlotActiveRef.current) {
      cancelArtifactInit(input.channelId);
      releaseArtifactInit(input.channelId);
      return;
    }
    initSlotActiveRef.current = false;
    cancelArtifactInit(input.channelId);
    releaseArtifactInit(input.channelId);
  }, [clearInitTimeout, input.channelId]);

  useEffect(() => {
    const registration = {
      id: input.channelId,
      forceKeep,
      priority,
      evict: (): void => {
        setHostIframe(false);
        setLoaded(false);
        setInitGranted(false);
      },
      onAdmit: (): void => {
        everAdmittedRef.current = true;
        setHostIframe(true);
      },
    };
    const claim = claimArtifactLiveHost(registration);
    setClaimed(true);
    if (claim.admitted) {
      everAdmittedRef.current = true;
    }
    setHostIframe(claim.admitted);
  }, [forceKeep, input.channelId, priority]);

  useEffect(() => {
    return () => {
      setClaimed(false);
      everAdmittedRef.current = false;
      releaseArtifactLiveHost(input.channelId);
    };
  }, [input.channelId]);

  useEffect(() => {
    if (!hostIframe) {
      setInitGranted(false);
      setLoaded(false);
      releaseInitSlot();
      return;
    }

    let cancelled = false;
    setInitGranted(false);
    setLoaded(false);
    void requestArtifactInit(input.channelId, { priority: initPriorityRef.current }).then(() => {
      if (cancelled) {
        releaseArtifactInit(input.channelId);
        return;
      }
      initSlotActiveRef.current = true;
      setInitGranted(true);
      clearInitTimeout();
      initTimeoutRef.current = setTimeout(() => {
        initTimeoutRef.current = null;
        if (initSlotActiveRef.current) {
          initSlotActiveRef.current = false;
          releaseArtifactInit(input.channelId);
        }
      }, ARTIFACT_INIT_LEASE_TIMEOUT_MS);
    });

    return () => {
      cancelled = true;
      releaseInitSlot();
    };
  }, [clearInitTimeout, hostIframe, input.channelId, releaseInitSlot]);

  const markIframeLoaded = useCallback((): void => {
    setLoaded(true);
    if (!initSlotActiveRef.current) {
      return;
    }
    initSlotActiveRef.current = false;
    clearInitTimeout();
    releaseArtifactInit(input.channelId);
  }, [clearInitTimeout, input.channelId]);

  const requestHost = useCallback((): void => {
    const claim = requestArtifactLiveHost({
      id: input.channelId,
      forceKeep,
      priority,
      evict: (): void => {
        setHostIframe(false);
        setLoaded(false);
        setInitGranted(false);
      },
      onAdmit: (): void => {
        everAdmittedRef.current = true;
        setHostIframe(true);
      },
    });
    if (claim.admitted) {
      everAdmittedRef.current = true;
      setHostIframe(true);
    }
  }, [forceKeep, input.channelId, priority]);

  const state = resolveLifecycleState({
    claimed,
    admitted: hostIframe,
    everAdmitted: everAdmittedRef.current,
    initGranted,
    loaded,
    streaming: input.streaming,
  });

  return { state, hostIframe, initGranted, markIframeLoaded, requestHost };
}
