/**
 * Follow-tail / jump-to-latest scroll presentation state for the transcript.
 * Also exposes scrollProgress (0–1) for a floating scrollbar indicator
 * that overlays the content without taking layout space.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 64;

export type TranscriptScrollState = {
  followTail: boolean;
  unreadActivityCount: number;
  showJumpToLatest: boolean;
  /** Fraction of content scrolled from top (0) to bottom (1). */
  scrollProgress: number;
  /** Visible-to-content height ratio; drives the floating thumb height. */
  scrollRatio: number;
};

export function isNearBottom(element: HTMLElement, thresholdPx = BOTTOM_THRESHOLD_PX): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining <= thresholdPx;
}

export function computeScrollProgress(element: HTMLElement): {
  progress: number;
  ratio: number;
} {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) {
    return { progress: 1, ratio: 1 };
  }
  const progress = Math.min(1, Math.max(0, element.scrollTop / maxScroll));
  const ratio = Math.min(1, element.clientHeight / element.scrollHeight);
  return { progress, ratio };
}

export function useTranscriptScroll(options: {
  messageCount: number;
  activitySignal: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [scrollRatio, setScrollRatio] = useState(1);
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
    const { progress, ratio } = computeScrollProgress(element);
    setScrollProgress(progress);
    setScrollRatio(ratio);
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
    scrollProgress,
    scrollRatio,
  };
}
