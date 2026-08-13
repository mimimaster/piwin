import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
  cancelArtifactInit,
  claimArtifactLiveHost,
  releaseArtifactInit,
  releaseArtifactLiveHost,
  requestArtifactInit,
  requestArtifactLiveHost,
} from '@piwin/artifact';

export type ArtifactFrameHost = {
  hostIframe: boolean;
  initGranted: boolean;
  markIframeLoaded: () => void;
  requestHost: () => void;
};

function resolveHostPriority(presentation: 'inline' | 'canvas', streaming: boolean): number {
  if (presentation === 'canvas') {
    return ARTIFACT_LIVE_PRIORITY_CANVAS;
  }
  return streaming ? ARTIFACT_LIVE_PRIORITY_STREAM : ARTIFACT_LIVE_PRIORITY_VISIBLE;
}

/** Owns only iframe memory admission and serialized srcdoc initialization. */
export function useArtifactFrameHost(input: {
  channelId: string;
  initPriority: number;
  presentation: 'inline' | 'canvas';
  streaming: boolean;
}): ArtifactFrameHost {
  const forceKeep = input.presentation === 'canvas' || input.streaming;
  const priority = resolveHostPriority(input.presentation, input.streaming);
  const [hostIframe, setHostIframe] = useState(true);
  const [initGranted, setInitGranted] = useState(false);
  const initSlotActiveRef = useRef(false);
  const initPriorityRef = useRef(input.initPriority);
  initPriorityRef.current = input.initPriority;

  useEffect(() => {
    const registration = {
      id: input.channelId,
      forceKeep,
      priority,
      evict: (): void => setHostIframe(false),
      onAdmit: (): void => setHostIframe(true),
    };
    const claim = claimArtifactLiveHost(registration);
    setHostIframe(claim.admitted);
    return () => releaseArtifactLiveHost(input.channelId);
  }, [forceKeep, input.channelId, priority]);

  useEffect(() => {
    if (!hostIframe) {
      setInitGranted(false);
      cancelArtifactInit(input.channelId);
      releaseArtifactInit(input.channelId);
      initSlotActiveRef.current = false;
      return;
    }

    let cancelled = false;
    setInitGranted(false);
    void requestArtifactInit(input.channelId, { priority: initPriorityRef.current }).then(() => {
      if (cancelled) {
        releaseArtifactInit(input.channelId);
        return;
      }
      initSlotActiveRef.current = true;
      setInitGranted(true);
    });

    return () => {
      cancelled = true;
      cancelArtifactInit(input.channelId);
      releaseArtifactInit(input.channelId);
      initSlotActiveRef.current = false;
    };
  }, [hostIframe, input.channelId]);

  const markIframeLoaded = useCallback((): void => {
    if (!initSlotActiveRef.current) {
      return;
    }
    initSlotActiveRef.current = false;
    releaseArtifactInit(input.channelId);
  }, [input.channelId]);

  const requestHost = useCallback((): void => {
    const claim = requestArtifactLiveHost({
      id: input.channelId,
      forceKeep,
      priority,
      evict: (): void => setHostIframe(false),
      onAdmit: (): void => setHostIframe(true),
    });
    if (claim.admitted) {
      setHostIframe(true);
    }
  }, [forceKeep, input.channelId, priority]);

  return { hostIframe, initGranted, markIframeLoaded, requestHost };
}
