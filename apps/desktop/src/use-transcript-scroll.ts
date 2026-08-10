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
 * - Programmatic sticks must not clear followTail. Artifact iframe growth and
 *   virtualizer remeasures can leave the viewport briefly not near bottom;
 *   treating those intermediate scroll events as user intent was the main
 *   "jumps to history while streaming" failure mode.
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
  /** True while we own scrollTop writes; blocks followTail clear on onScroll. */
  const programmaticScrollRef = useRef(false);
  const stickFramesRef = useRef<number[]>([]);
  /** Last observed scroll geometry — distinguishes user scroll from growth. */
  const lastScrollGeometryRef = useRef({ scrollTop: 0, scrollHeight: 0 });
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

  const cancelScheduledSticks = useCallback(() => {
    for (const frameId of stickFramesRef.current) {
      window.cancelAnimationFrame(frameId);
    }
    stickFramesRef.current = [];
  }, []);

  /**
   * Ignore only the synchronous scroll event from our own scrollTop write.
   * Cleared on microtask so a real user scroll in the same frame still works.
   */
  const beginProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = true;
    queueMicrotask(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  const stickToBottomIfFollowing = useCallback(() => {
    const element = containerRef.current;
    if (!element || !followTailRef.current) {
      return;
    }
    beginProgrammaticScroll();
    element.scrollTop = element.scrollHeight;
    lastScrollGeometryRef.current = {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
    };
  }, [beginProgrammaticScroll]);

  /**
   * Stick now and once more on the following frames. Artifact iframe height
   * and tanstack virtual totalSize often land 1–2 frames after the first
   * resize notification; a single stick against a stale scrollHeight is a
   * no-op and leaves the viewport on older turns.
   */
  const stickToBottomAcrossFrames = useCallback(() => {
    if (!followTailRef.current) {
      return;
    }
    cancelScheduledSticks();
    stickToBottomIfFollowing();
    const frame1 = window.requestAnimationFrame(() => {
      stickToBottomIfFollowing();
      const frame2 = window.requestAnimationFrame(() => {
        stickToBottomIfFollowing();
        const element = containerRef.current;
        if (element) {
          applyMetrics(element);
        }
        stickFramesRef.current = stickFramesRef.current.filter(
          (id) => id !== frame1 && id !== frame2,
        );
      });
      stickFramesRef.current.push(frame2);
    });
    stickFramesRef.current.push(frame1);
  }, [applyMetrics, cancelScheduledSticks, stickToBottomIfFollowing]);

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
      beginProgrammaticScroll();
      element.scrollTop = element.scrollHeight;
      applyMetrics(element);
    }
  }, [applyMetrics, beginProgrammaticScroll, setFollowTail]);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const metrics = readScrollMetrics(element);
    setScrollProgress(metrics.progress);
    setScrollRatio(metrics.ratio);

    const previous = lastScrollGeometryRef.current;
    const scrollTopDelta = element.scrollTop - previous.scrollTop;
    const scrollHeightDelta = element.scrollHeight - previous.scrollHeight;
    lastScrollGeometryRef.current = {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
    };

    if (programmaticScrollRef.current) {
      // Stick / restore write — do not demote followTail from intermediate
      // layout (Artifact height jump, virtualizer remeasure).
      return;
    }

    // Content grew under a following viewport (Artifact iframe / virtualizer)
    // while scrollTop stayed put. That is not user navigation — re-stick and
    // keep follow-tail rather than locking onto historical turns.
    if (
      followTailRef.current &&
      !metrics.nearBottom &&
      scrollHeightDelta > 0 &&
      Math.abs(scrollTopDelta) < 1
    ) {
      stickToBottomAcrossFrames();
      return;
    }

    setFollowTail(metrics.nearBottom);
  }, [setFollowTail, stickToBottomAcrossFrames]);

  const restorePosition = useCallback(
    (position: TranscriptScrollPosition): void => {
      const element = containerRef.current;
      setFollowTail(position.followTail);
      if (!element) {
        return;
      }
      beginProgrammaticScroll();
      element.scrollTop = position.followTail
        ? element.scrollHeight
        : Math.max(0, position.scrollTop);
      applyMetrics(element);
    },
    [applyMetrics, beginProgrammaticScroll, setFollowTail],
  );

  // Observe scrollport size and content tree so height changes remeasure even
  // when stick-to-bottom does not emit a scroll event.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const remeasureFromResize = () => {
      if (followTailRef.current) {
        stickToBottomAcrossFrames();
      } else {
        measure();
      }
    };

    if (typeof ResizeObserver === 'undefined') {
      remeasureFromResize();
      return () => {
        cancelScheduledSticks();
      };
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
      cancelScheduledSticks();
    };
  }, [cancelScheduledSticks, measure, stickToBottomAcrossFrames]);

  // Activity / message growth: stick then remeasure after layout commits.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    if (followTailRef.current) {
      stickToBottomAcrossFrames();
    } else {
      measure();
    }
  }, [options.activitySignal, options.messageCount, measure, stickToBottomAcrossFrames]);

  return {
    containerRef,
    followTail,
    showJumpToLatest: !followTail,
    jumpToLatest,
    handleScroll,
    setFollowTail,
    restorePosition,
    /** Immediate follow-tail stick for nested growers (Artifact iframe height). */
    notifyContentGrew: stickToBottomAcrossFrames,
    scrollProgress,
    scrollRatio,
    isOverflowing: isScrollOverflowing(scrollRatio),
    measure,
  };
}
