/**
 * Follow-tail / jump-to-latest for the transcript scrollport.
 *
 * One following bit (`followTailRef`). Pin-to-end writes happen only while it
 * is true (`notifyContentGrew` / ResizeObserver / activity). Nested growers and
 * the virtualizer read that bit from the scroll port — they do not restick the
 * tail on their own.
 *
 * User history navigation (wheel up, or an upward scroll still inside the tail
 * zone) clears following immediately. A fitted transcript cannot leave the tail.
 * Metrics also update on resize and activity so the floating thumb does not
 * depend on a scroll event that stick-to-bottom may not emit.
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
  scrollHeightDelta?: number;
  overflowing?: boolean;
}): boolean {
  if (options.overflowing === false) {
    return false;
  }
  // User-owned upward move in the tail zone is history intent, even when a
  // hero image / virtualizer measure grew the document in the same frame.
  if (!options.programmatic && options.scrollTopDelta < 0 && options.nearBottom) {
    return true;
  }
  const heightDelta = options.scrollHeightDelta ?? 0;
  if (heightDelta > 0 && options.scrollTopDelta >= -heightDelta) {
    return false;
  }
  if (options.programmatic && heightDelta !== 0) {
    return false;
  }
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
 * Vacuous wheels on a fitted (non-overflowing) transcript are ignored —
 * browsers still emit them, but scrollTop cannot change, so the viewport
 * would otherwise stick in a detached state with no way to re-pin.
 */
export function shouldDetachFollowTailFromWheelDelta(options: {
  deltaY: number;
  overflowing: boolean;
}): boolean {
  if (!options.overflowing) {
    return false;
  }
  return options.deltaY < 0;
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
  /** Explicit history opens are positioned by their anchor, not the live tail. */
  historyViewActive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const historyViewActiveRef = useRef(options.historyViewActive === true);
  historyViewActiveRef.current = options.historyViewActive === true;
  const followTailRef = useRef(options.historyViewActive !== true);
  /**
   * User explicitly navigated into history. Blocks all stick-to-bottom until
   * jump-to-latest or the viewport returns near the tail.
   */
  const userDetachedRef = useRef(options.historyViewActive === true);
  /** True while we own scrollTop writes; soft-blocks followTail clear on onScroll. */
  const programmaticScrollRef = useRef(false);
  const stickFramesRef = useRef<number[]>([]);
  /** Skip pin-to-end while a user-owned fold remasures (see beginLocalFoldLayout). */
  const suppressFollowStickRef = useRef(false);
  const suppressStickFramesRef = useRef<number[]>([]);
  const previousLiveTurnIdRef = useRef<string | null>(null);
  /** Last observed scroll geometry — distinguishes user scroll from growth. */
  const lastScrollGeometryRef = useRef({ scrollTop: 0, scrollHeight: 0 });
  const [followTail, setFollowTailState] = useState(options.historyViewActive !== true);
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

  const cancelSuppressStickClear = useCallback(() => {
    for (const frameId of suppressStickFramesRef.current) {
      window.cancelAnimationFrame(frameId);
    }
    suppressStickFramesRef.current = [];
  }, []);

  const beginLocalFoldLayout = useCallback(() => {
    suppressFollowStickRef.current = true;
    cancelSuppressStickClear();
    const frame1 = window.requestAnimationFrame(() => {
      const frame2 = window.requestAnimationFrame(() => {
        suppressFollowStickRef.current = false;
        suppressStickFramesRef.current = suppressStickFramesRef.current.filter(
          (id) => id !== frame1 && id !== frame2,
        );
      });
      suppressStickFramesRef.current.push(frame2);
    });
    suppressStickFramesRef.current.push(frame1);
  }, [cancelSuppressStickClear]);

  const detachFromTail = useCallback(() => {
    cancelScheduledSticks();
    userDetachedRef.current = true;
    followTailRef.current = false;
    setFollowTailState(false);
  }, [cancelScheduledSticks]);

  useLayoutEffect(() => {
    if (options.historyViewActive) detachFromTail();
  }, [options.historyViewActive, detachFromTail]);

  useEffect(() => () => cancelSuppressStickClear(), [cancelSuppressStickClear]);

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
    if (
      !element ||
      suppressFollowStickRef.current ||
      !followTailRef.current ||
      userDetachedRef.current ||
      historyViewActiveRef.current
    ) {
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
    if (
      suppressFollowStickRef.current ||
      !followTailRef.current ||
      userDetachedRef.current ||
      historyViewActiveRef.current
    ) {
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

  const isFollowingTail = useCallback((): boolean => followTailRef.current, []);

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
        scrollHeightDelta,
        overflowing: isScrollOverflowing(metrics.ratio),
      })
    ) {
      detachFromTail();
      return;
    }

    if (programmaticScrollRef.current) {
      // Stick / restore write without a user-away delta — keep follow-tail.
      return;
    }

    // Content grew under a following viewport (Artifact iframe / virtualizer
    // measure). Re-stick rather than locking onto the old estimated bottom,
    // which reads as "opened in the middle of the conversation".
    if (
      followTailRef.current &&
      !userDetachedRef.current &&
      !metrics.nearBottom &&
      scrollHeightDelta > 0
    ) {
      stickToBottomAcrossFrames();
      return;
    }

    if (metrics.nearBottom) {
      if (userDetachedRef.current && (scrollTopDelta <= 0 || scrollHeightDelta !== 0)) {
        return;
      }
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
      const overflowing = isScrollOverflowing(readScrollMetrics(element).ratio);
      if (
        !shouldDetachFollowTailFromWheelDelta({
          deltaY: event.deltaY,
          overflowing,
        })
      ) {
        // Fitted transcript: any leftover detached state is unrecoverable by
        // scrolling (there is no scroll). Re-pin so jump-to-latest cannot stick.
        if (!overflowing && (userDetachedRef.current || !followTailRef.current)) {
          setFollowTail(true);
        }
        return;
      }
      detachFromTail();
    };

    // Capture + passive: observe intent before nested surfaces stop
    // propagation, and never preventDefault.
    element.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => {
      element.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [detachFromTail, options.messageCount, setFollowTail]);

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
      if (suppressFollowStickRef.current) {
        measure();
        return;
      }
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
    if (suppressFollowStickRef.current) {
      measure();
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
    showJumpToLatest: !followTail && isScrollOverflowing(scrollRatio),
    jumpToLatest,
    handleScroll,
    setFollowTail,
    detachFromTail,
    isFollowingTail,
    beginProgrammaticScroll,
    beginLocalFoldLayout,
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
