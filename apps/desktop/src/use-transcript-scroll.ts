/**
 * Follow-tail / jump-to-latest scroll presentation state for the transcript.
 * Also exposes scrollProgress / scrollRatio for a floating scrollbar that
 * overlays the shell without taking layout space.
 *
 * Measurement contract:
 * - Metrics update on scroll, container/content resize, and activity growth.
 * - Never rely on onScroll alone: programmatic stick-to-bottom often does not
 *   fire a scroll event when already near the bottom, which previously left
 *   scrollRatio stuck at 1 and made the floating scrollbar flash in/out.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptScrollPosition } from './transcript-scroll-memory';

const BOTTOM_THRESHOLD_PX = 64;
/** Treat near-full viewports as non-overflowing to avoid 1px thrash. */
const OVERFLOW_EPSILON = 0.002;

export type TranscriptScrollState = {
  followTail: boolean;
  showJumpToLatest: boolean;
  /** Fraction of content scrolled from top (0) to bottom (1). */
  scrollProgress: number;
  /** Visible-to-content height ratio; drives the floating thumb height. */
  scrollRatio: number;
  /** True when content taller than the scrollport (stable chrome visibility). */
  isOverflowing: boolean;
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

export function isScrollOverflowing(scrollRatio: number): boolean {
  return scrollRatio < 1 - OVERFLOW_EPSILON;
}

function readScrollMetrics(element: HTMLElement): {
  progress: number;
  ratio: number;
  nearBottom: boolean;
} {
  const { progress, ratio } = computeScrollProgress(element);
  return {
    progress,
    ratio,
    nearBottom: isNearBottom(element),
  };
}

export function useTranscriptScroll(options: {
  messageCount: number;
  activitySignal: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);
  const [followTail, setFollowTailState] = useState(true);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [scrollRatio, setScrollRatio] = useState(1);

  const applyMetrics = useCallback((element: HTMLElement) => {
    const metrics = readScrollMetrics(element);
    setScrollProgress(metrics.progress);
    setScrollRatio(metrics.ratio);
  }, []);

  const setFollowTail = useCallback((nextFollowTail: boolean) => {
    followTailRef.current = nextFollowTail;
    setFollowTailState(nextFollowTail);
  }, []);

  const stickToBottomIfFollowing = useCallback(() => {
    const element = containerRef.current;
    if (!element || !followTailRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  const measure = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    applyMetrics(element);
  }, [applyMetrics]);

  const jumpToLatest = useCallback(() => {
    const element = containerRef.current;
    setFollowTail(true);
    if (element) {
      element.scrollTop = element.scrollHeight;
      applyMetrics(element);
    }
  }, [applyMetrics, setFollowTail]);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const metrics = readScrollMetrics(element);
    setFollowTail(metrics.nearBottom);
    setScrollProgress(metrics.progress);
    setScrollRatio(metrics.ratio);
  }, [setFollowTail]);

  const restorePosition = useCallback(
    (position: TranscriptScrollPosition): void => {
      const element = containerRef.current;
      setFollowTail(position.followTail);
      if (!element) {
        return;
      }
      element.scrollTop = position.followTail
        ? element.scrollHeight
        : Math.max(0, position.scrollTop);
      applyMetrics(element);
    },
    [applyMetrics, setFollowTail],
  );

  // Observe scrollport size and content tree so height changes remeasure even
  // when stick-to-bottom does not emit a scroll event.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const remeasureFromResize = () => {
      stickToBottomIfFollowing();
      measure();
    };

    if (typeof ResizeObserver === 'undefined') {
      remeasureFromResize();
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      remeasureFromResize();
    });
    resizeObserver.observe(element);

    const observedChildren = new Set<Element>();
    const observeDirectChildren = () => {
      for (const child of Array.from(element.children)) {
        if (child instanceof Element && !observedChildren.has(child)) {
          resizeObserver.observe(child);
          observedChildren.add(child);
        }
      }
    };
    observeDirectChildren();

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            observeDirectChildren();
            remeasureFromResize();
          });
    // childList only on the scroll root — subtree text growth is covered by
    // ResizeObserver on direct children + activitySignal layout effect.
    mutationObserver?.observe(element, { childList: true });

    remeasureFromResize();

    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [measure, stickToBottomIfFollowing]);

  // Activity / message growth: stick then remeasure after layout commits.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    stickToBottomIfFollowing();
    measure();
    const frameId = window.requestAnimationFrame(() => {
      stickToBottomIfFollowing();
      measure();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [options.activitySignal, options.messageCount, measure, stickToBottomIfFollowing]);

  return {
    containerRef,
    followTail,
    showJumpToLatest: !followTail,
    jumpToLatest,
    handleScroll,
    setFollowTail,
    restorePosition,
    scrollProgress,
    scrollRatio,
    isOverflowing: isScrollOverflowing(scrollRatio),
    measure,
  };
}
