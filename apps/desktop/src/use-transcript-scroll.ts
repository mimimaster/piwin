/**
 * Follow-tail / jump-to-latest scroll presentation state for the transcript.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 64;

export type TranscriptScrollState = {
  followTail: boolean;
  unreadActivityCount: number;
  showJumpToLatest: boolean;
};

export function isNearBottom(element: HTMLElement, thresholdPx = BOTTOM_THRESHOLD_PX): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining <= thresholdPx;
}

export function useTranscriptScroll(options: {
  messageCount: number;
  activitySignal: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);
  const previousSignalRef = useRef(options.activitySignal);

  const jumpToLatest = useCallback(() => {
    const element = containerRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
    setFollowTail(true);
    setUnreadActivityCount(0);
  }, []);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const nearBottom = isNearBottom(element);
    setFollowTail(nearBottom);
    if (nearBottom) {
      setUnreadActivityCount(0);
    }
  }, []);

  useEffect(() => {
    if (followTail) {
      const element = containerRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    }
    // A single assistant message can stream for minutes without changing the
    // message count. activitySignal includes bounded visible growth, so tail
    // followers keep seeing the current answer without token-by-token scroll.
  }, [options.activitySignal, options.messageCount, followTail]);

  useEffect(() => {
    if (previousSignalRef.current === options.activitySignal) {
      return;
    }
    previousSignalRef.current = options.activitySignal;
    if (!followTail) {
      setUnreadActivityCount((count) => count + 1);
    }
  }, [options.activitySignal, followTail]);

  return {
    containerRef,
    followTail,
    unreadActivityCount,
    showJumpToLatest: !followTail,
    jumpToLatest,
    handleScroll,
    setFollowTail,
  };
}
