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
 * - Programmatic sticks must not clear followTail from layout thrash alone.
 * - User scroll-away (wheel up / trackpad / intentional scrollTop drop) must
 *   win over Artifact/virtualizer ResizeObserver sticks — otherwise history
 *   is unreachable while content keeps growing (reads as "can't scroll up").
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptScrollPosition } from './transcript-scroll-memory';
import { computeCurrentResponseMinHeight } from './transcript-response-viewport.js';

const BOTTOM_THRESHOLD_PX = 64;
/** Treat near-full viewports as non-overflowing to avoid 1px thrash. */
const OVERFLOW_EPSILON = 0.002;
/**
 * User scroll-up of at least this many px demotes follow-tail even if a
 * programmatic stick flag is still set (race with rAF stick frames).
 */
const USER_SCROLL_AWAY_DELTA_PX = 8;
/** Wheel deltaY < 0 (scroll content up / reveal history) detaches follow-tail. */
const USER_WHEEL_AWAY_DELTA_Y = -2;

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

/**
 * Pure helper for tests: should a scroll-top decrease demote follow-tail.
 */
export function shouldDetachFollowTailFromScrollDelta(options: {
  scrollTopDelta: number;
  programmatic: boolean;
  nearBottom: boolean;
}): boolean {
  if (options.nearBottom) {
    return false;
  }
  if (options.scrollTopDelta <= -USER_SCROLL_AWAY_DELTA_PX) {
    return true;
  }
  if (!options.programmatic && options.scrollTopDelta < 0) {
    return true;
  }
  return false;
}

/**
 * Pure helper: wheel / trackpad gesture that reveals earlier content.
 */
export function shouldDetachFollowTailFromWheelDelta(deltaY: number): boolean {
  return deltaY <= USER_WHEEL_AWAY_DELTA_Y;
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
  /** A newly submitted turn re-enters follow-tail even after history reading. */
  liveTurnId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);
  /**
   * User explicitly navigated into history. Blocks all stick-to-bottom until
   * jump-to-latest or the viewport returns near the tail.
   */
  const userDetachedRef = useRef(false);
  /** True while we own scrollTop writes; soft-blocks followTail clear on onScroll. */
  const programmaticScrollRef = useRef(false);
  const stickFramesRef = useRef<number[]>([]);
  const previousLiveTurnIdRef = useRef<string | null>(null);
  /** Last observed scroll geometry — distinguishes user scroll from growth. */
  const lastScrollGeometryRef = useRef({ scrollTop: 0, scrollHeight: 0 });
  const [followTail, setFollowTailState] = useState(true);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [scrollRatio, setScrollRatio] = useState(1);
  const [currentResponseMinHeight, setCurrentResponseMinHeight] = useState(0);

  const applyMetrics = useCallback((element: HTMLElement) => {
    setCurrentResponseMinHeight(computeCurrentResponseMinHeight(element.clientHeight));
    const metrics = readScrollMetrics(element);
    setScrollProgress(metrics.progress);
    setScrollRatio(metrics.ratio);
  }, []);

  const setFollowTail = useCallback((nextFollowTail: boolean) => {
    followTailRef.current = nextFollowTail;
    if (nextFollowTail) {
      userDetachedRef.current = false;
    }
    setFollowTailState(nextFollowTail);
  }, []);

  const cancelScheduledSticks = useCallback(() => {
    for (const frameId of stickFramesRef.current) {
      window.cancelAnimationFrame(frameId);
    }
    stickFramesRef.current = [];
  }, []);

  const detachFromTail = useCallback(() => {
    cancelScheduledSticks();
    userDetachedRef.current = true;
    followTailRef.current = false;
    setFollowTailState(false);
  }, [cancelScheduledSticks]);

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
    if (!element || !followTailRef.current || userDetachedRef.current) {
      return;
    }
    beginProgrammaticScroll();
    element.scrollTop = element.scrollHeight;
    lastScrollGeometryRef.current = {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
    };
    applyMetrics(element);
  }, [applyMetrics, beginProgrammaticScroll]);

  /**
   * Stick now and once more on the following frames. Artifact iframe height
   * and tanstack virtual totalSize often land 1–2 frames after the first
   * resize notification; a single stick against a stale scrollHeight is a
   * no-op and leaves the viewport on older turns.
   */
  const stickToBottomAcrossFrames = useCallback(() => {
    if (!followTailRef.current || userDetachedRef.current) {
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
    userDetachedRef.current = false;
    setFollowTail(true);
    if (element) {
      beginProgrammaticScroll();
      element.scrollTop = element.scrollHeight;
      lastScrollGeometryRef.current = {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
      };
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

    // User clearly scrolled into history — always wins over stick races.
    if (
      shouldDetachFollowTailFromScrollDelta({
        scrollTopDelta,
        programmatic: programmaticScrollRef.current,
        nearBottom: metrics.nearBottom,
      })
    ) {
      detachFromTail();
      return;
    }

    if (programmaticScrollRef.current) {
      // Stick / restore write without a user-away delta — keep follow-tail.
      return;
    }

    // Content grew under a following viewport (Artifact iframe / virtualizer)
    // while scrollTop stayed put. That is not user navigation — re-stick and
    // keep follow-tail rather than locking onto historical turns.
    if (
      followTailRef.current &&
      !userDetachedRef.current &&
      !metrics.nearBottom &&
      scrollHeightDelta > 0 &&
      Math.abs(scrollTopDelta) < 1
    ) {
      stickToBottomAcrossFrames();
      return;
    }

    if (metrics.nearBottom) {
      userDetachedRef.current = false;
      setFollowTail(true);
      return;
    }

    if (!followTailRef.current) {
      return;
    }
    // Non-near-bottom without a clear upward delta (layout thrash) — leave
    // follow-tail alone only when still following; detach only on real away.
  }, [detachFromTail, setFollowTail, stickToBottomAcrossFrames]);

  const restorePosition = useCallback(
    (position: TranscriptScrollPosition): void => {
      const element = containerRef.current;
      userDetachedRef.current = !position.followTail;
      setFollowTail(position.followTail);
      if (!element) {
        return;
      }
      beginProgrammaticScroll();
      element.scrollTop = position.followTail
        ? element.scrollHeight
        : Math.max(0, position.scrollTop);
      lastScrollGeometryRef.current = {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
      };
      applyMetrics(element);
    },
    [applyMetrics, beginProgrammaticScroll, setFollowTail],
  );

  // Wheel / trackpad: detach immediately so ResizeObserver sticks cannot yank
  // the viewport back while the user is reading history.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent): void => {
      if (!shouldDetachFollowTailFromWheelDelta(event.deltaY)) {
        return;
      }
      detachFromTail();
    };

    // passive: true — we only observe intent, never preventDefault.
    element.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [detachFromTail, options.messageCount]);

  useLayoutEffect(() => {
    const nextLiveTurnId = options.liveTurnId?.trim() || null;
    if (nextLiveTurnId === null) {
      previousLiveTurnIdRef.current = null;
      return;
    }
    if (previousLiveTurnIdRef.current === nextLiveTurnId) {
      return;
    }
    previousLiveTurnIdRef.current = nextLiveTurnId;
    userDetachedRef.current = false;
    setFollowTail(true);
    stickToBottomAcrossFrames();
  }, [options.liveTurnId, setFollowTail, stickToBottomAcrossFrames]);

  // Observe scrollport size and content tree so height changes remeasure even
  // when stick-to-bottom does not emit a scroll event.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const remeasureFromResize = () => {
      if (followTailRef.current && !userDetachedRef.current) {
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
    if (followTailRef.current && !userDetachedRef.current) {
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
    detachFromTail,
    restorePosition,
    /** Immediate follow-tail stick for nested growers (Artifact iframe height). */
    notifyContentGrew: stickToBottomAcrossFrames,
    scrollProgress,
    scrollRatio,
    isOverflowing: isScrollOverflowing(scrollRatio),
    currentResponseMinHeight,
    measure,
  };
}
