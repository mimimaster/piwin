import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { elementScroll, useVirtualizer } from '@tanstack/react-virtual';
import {
  buildTranscriptStreamingMeasureKey,
  buildTranscriptTurnsStructureKey,
  createTranscriptRangeExtractor,
  shouldAdjustTranscriptScrollOnItemSizeChange,
  shouldVirtualizeTranscript,
  transcriptVirtualizerMeasurePolicy,
  TRANSCRIPT_LIVE_TAIL_PIN_COUNT,
  TRANSCRIPT_TURN_GAP_PX,
  TRANSCRIPT_TURN_OVERSCAN,
} from './transcript-turn-policy.js';
import { useTranscriptScrollPort, type TranscriptScrollPort } from './transcript-scroll-port';
import { scrollTranscriptToMessage } from './history-ticks-drawer';
import { readTranscriptTurnHeight, rememberTranscriptTurnHeight } from './transcript-scroll-memory';
import {
  normalizeTranscriptTurnHeight,
  readMountedTranscriptTurnHeight,
  resolveTranscriptTurnEstimate,
  TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX,
} from './transcript-turn-height';
import { indexTranscriptTurnsByMessageId, type TranscriptTurn } from './transcript-turns';
import {
  TRANSCRIPT_TURN_MEASURE_EVENT,
  type TranscriptTurnMeasureDetail,
} from './transcript-turn-measure.js';
import { alignTranscriptReadingAnchor } from './transcript-reading-anchor.js';

export type TranscriptTurnListProps = {
  turns: readonly TranscriptTurn[];
  pinnedMessageId: string | null;
  renderTurn: (turn: TranscriptTurn) => ReactElement;
  streaming?: boolean;
};

function useVirtualizedMessageJump(
  scrollPort: TranscriptScrollPort,
  indexByMessageId: ReadonlyMap<string, number>,
  virtualizer: {
    scrollToIndex: (index: number, options: { align: 'start'; behavior: 'auto' }) => void;
  },
): void {
  const jumpFrameRef = useRef<number | null>(null);
  useEffect(() => {
    const unregisterScroller = scrollPort.registerMessageScroller((messageId) => {
      const itemIndex = indexByMessageId.get(messageId);
      if (itemIndex === undefined) {
        return false;
      }
      if (scrollTranscriptToMessage(messageId)) {
        return true;
      }
      if (jumpFrameRef.current !== null) {
        window.cancelAnimationFrame(jumpFrameRef.current);
      }
      virtualizer.scrollToIndex(itemIndex, { align: 'start', behavior: 'auto' });
      jumpFrameRef.current = window.requestAnimationFrame(() => {
        if (scrollTranscriptToMessage(messageId)) {
          jumpFrameRef.current = null;
          return;
        }
        virtualizer.scrollToIndex(itemIndex, { align: 'start', behavior: 'auto' });
        jumpFrameRef.current = window.requestAnimationFrame(() => {
          jumpFrameRef.current = null;
          scrollTranscriptToMessage(messageId);
        });
      });
      return true;
    });
    return () => {
      unregisterScroller();
      if (jumpFrameRef.current !== null) {
        window.cancelAnimationFrame(jumpFrameRef.current);
        jumpFrameRef.current = null;
      }
    };
  }, [indexByMessageId, scrollPort, virtualizer]);
}

/**
 * History paging anchor for the virtualized list. Layout-phase registration so
 * the owner's layout effect (which runs after ours) sees this render's turns.
 */
function useVirtualizedReadingAnchor(
  scrollPort: TranscriptScrollPort,
  indexByMessageId: ReadonlyMap<string, number>,
  virtualizer: {
    scrollToIndex: (index: number, options: { align: 'start'; behavior: 'auto' }) => void;
    scrollOffset: number | null;
    scrollAdjustments: number;
  },
): void {
  const frameRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const cancelFrame = (): void => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    const unregister = scrollPort.registerReadingAnchorRestorer((anchor) => {
      const container = scrollPort.scrollElementRef.current;
      if (!container) {
        return false;
      }
      cancelFrame();
      const align = (): boolean =>
        alignTranscriptReadingAnchor(container, anchor, {
          beforeScroll: scrollPort.beginProgrammaticScroll,
          // TanStack applies size corrections from its own scrollOffset, which
          // only catches up on the next scroll event. The measure of the rows
          // this page mounted lands first, so without this it re-applies the
          // pre-align offset and drags the reader back by the wheel delta.
          afterScroll: (scrollTop) => {
            virtualizer.scrollOffset = scrollTop;
            virtualizer.scrollAdjustments = 0;
          },
        });
      if (align()) {
        return true;
      }
      // The anchor's row was virtualized away (its old scroll offset now points
      // at freshly prepended rows). Mount it, then settle on the next frames.
      const turnIndex = indexByMessageId.get(anchor.messageId);
      if (turnIndex === undefined) {
        return false;
      }
      scrollPort.beginProgrammaticScroll();
      virtualizer.scrollToIndex(turnIndex, { align: 'start', behavior: 'auto' });
      let attempts = 0;
      const settle = (): void => {
        frameRef.current = null;
        if (align() || attempts >= 2) {
          return;
        }
        attempts += 1;
        frameRef.current = window.requestAnimationFrame(settle);
      };
      frameRef.current = window.requestAnimationFrame(settle);
      return true;
    });
    return () => {
      unregister();
      cancelFrame();
    };
  }, [indexByMessageId, scrollPort, virtualizer]);
}

export function TranscriptTurnList(props: TranscriptTurnListProps): ReactElement {
  const scrollPort = useTranscriptScrollPort();
  const virtualize = shouldVirtualizeTranscript(props.turns.length);

  useEffect(() => {
    if (!scrollPort || virtualize) {
      return;
    }
    return scrollPort.registerMessageScroller((messageId) => scrollTranscriptToMessage(messageId));
  }, [scrollPort, virtualize]);

  if (!scrollPort || !virtualize) {
    return (
      <>
        {props.turns.map((turn) => (
          <Fragment key={turn.id}>{props.renderTurn(turn)}</Fragment>
        ))}
      </>
    );
  }

  return <VirtualizedTranscriptTurns {...props} scrollPort={scrollPort} />;
}

function VirtualizedTranscriptTurns(
  props: TranscriptTurnListProps & { scrollPort: TranscriptScrollPort },
): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const turnIndexByMessageId = useMemo(
    () => indexTranscriptTurnsByMessageId(props.turns),
    [props.turns],
  );
  const pinnedTurnIndex = props.pinnedMessageId
    ? (turnIndexByMessageId.get(props.pinnedMessageId) ?? null)
    : null;
  const liveTailStartIndex =
    props.turns.length > 0
      ? Math.max(0, props.turns.length - TRANSCRIPT_LIVE_TAIL_PIN_COUNT)
      : null;
  const rangeExtractor = useMemo(
    () => createTranscriptRangeExtractor(pinnedTurnIndex, liveTailStartIndex),
    [pinnedTurnIndex, liveTailStartIndex],
  );
  const getItemKey = useCallback(
    (turnIndex: number) => props.turns[turnIndex]?.id ?? turnIndex,
    [props.turns],
  );
  const estimateSize = useCallback(
    (turnIndex: number) => {
      const turn = props.turns[turnIndex];
      const cachedHeight =
        props.scrollPort.sessionId && turn
          ? readTranscriptTurnHeight(props.scrollPort.sessionId, turn.id)
          : null;
      return resolveTranscriptTurnEstimate({ turn, cachedHeight });
    },
    [props.scrollPort.sessionId, props.turns],
  );
  const measureElement = useCallback(
    (
      element: HTMLElement,
      entry: ResizeObserverEntry | undefined,
      instance: { itemSizeCache: ReadonlyMap<string | number | bigint, number> },
    ) => {
      // Observer box can be the clipped slot; scrollHeight is the natural body.
      const rawHeight = readMountedTranscriptTurnHeight({ element, entry });
      const normalized = normalizeTranscriptTurnHeight(rawHeight);
      const turnId = element.dataset.turnId;
      if (normalized !== null && props.scrollPort.sessionId && turnId) {
        rememberTranscriptTurnHeight(props.scrollPort.sessionId, turnId, normalized);
        return normalized;
      }
      if (normalized !== null) {
        return normalized;
      }
      // No box (a `hidden` split pane, a detached node): keep the last real
      // size. Writing the estimate would collapse every mounted turn and
      // scramble the list when the pane is shown again.
      return (turnId ? instance.itemSizeCache.get(turnId) : undefined)
        ?? TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
    },
    [props.scrollPort.sessionId],
  );

  const measurePolicy = transcriptVirtualizerMeasurePolicy();
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: props.turns.length,
    getScrollElement: () => props.scrollPort.scrollElement,
    estimateSize,
    getItemKey,
    anchorTo: 'end',
    followOnAppend: false,
    gap: TRANSCRIPT_TURN_GAP_PX,
    measureElement,
    overscan: TRANSCRIPT_TURN_OVERSCAN,
    rangeExtractor,
    scrollMargin,
    scrollToFn: (offset, options, instance) => {
      if (options.adjustments) {
        props.scrollPort.beginProgrammaticScroll();
      }
      elementScroll(offset, options, instance);
    },
    useAnimationFrameWithResizeObserver: measurePolicy.useAnimationFrameWithResizeObserver,
    useFlushSync: measurePolicy.useFlushSync,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
    shouldAdjustTranscriptScrollOnItemSizeChange(
      item,
      delta,
      instance,
      props.scrollPort.isFollowingTail(),
    );

  const turnsStructureKey = useMemo(
    () => buildTranscriptTurnsStructureKey(props.turns),
    [props.turns],
  );
  const measureTurnBody = useCallback(
    (element: HTMLElement): void => {
      // measureElement keys a node by its data-index. A detached body keeps the
      // index it last rendered at, so once a history page or bounded-window
      // trim shifts turns it would claim that index's *current* key: cache the
      // detached node's zero height (→ estimate) and unobserve the live body,
      // leaving an under-sized slot that never heals and paints over neighbors.
      if (!element.isConnected || !listRef.current?.contains(element)) {
        return;
      }
      virtualizer.measureElement(element);
    },
    [virtualizer],
  );
  const measureMountedTurns = useCallback((): void => {
    // measure() clears every exact size and falls back to estimates. Mounted
    // bodies may not resize afterward, so ResizeObserver cannot repair that
    // reset. Re-read only mounted bodies and retain off-screen measurements.
    // Read them from the DOM: elementsCache still holds unmounted bodies.
    const listElement = listRef.current;
    if (!listElement) {
      return;
    }
    for (const element of listElement.querySelectorAll<HTMLElement>(
      ':scope > .transcript-turn-window-item > .transcript-turn-window-item-body',
    )) {
      measureTurnBody(element);
    }
  }, [measureTurnBody]);
  useLayoutEffect(() => {
    measureMountedTurns();
  }, [measureMountedTurns, turnsStructureKey]);

  const streamingMeasureKey = useMemo(
    () => buildTranscriptStreamingMeasureKey(props.turns, props.streaming === true),
    [props.streaming, props.turns],
  );
  useLayoutEffect(() => {
    if (streamingMeasureKey.length === 0) {
      return;
    }
    // Coalesce to one remasure per animation frame — token floods must not
    // sync-layout thrash, but each frame of growth must still lift neighbors.
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (!cancelled) {
        measureMountedTurns();
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [measureMountedTurns, streamingMeasureKey]);

  useEffect(() => {
    const onTurnMeasure = (event: Event): void => {
      const detail = (event as CustomEvent<TranscriptTurnMeasureDetail>).detail;
      const target = detail?.element;
      if (target instanceof HTMLElement) {
        // The event is document-wide; another transcript list may own target.
        measureTurnBody(target);
      } else {
        measureMountedTurns();
      }
      // Local folds remasure the slot only. Pin-to-end here is what made
      // clicking a call-chain dropdown look like a transcript refresh.
      // Automatic folds re-stick from useTranscriptLocalFoldMeasure instead.
    };
    document.addEventListener(TRANSCRIPT_TURN_MEASURE_EVENT, onTurnMeasure);
    return () => {
      document.removeEventListener(TRANSCRIPT_TURN_MEASURE_EVENT, onTurnMeasure);
    };
  }, [measureMountedTurns, measureTurnBody]);

  useLayoutEffect(() => {
    const listElement = listRef.current;
    const scrollElement = props.scrollPort.scrollElementRef.current;
    if (!listElement || !scrollElement) {
      return;
    }

    const measureScrollMargin = (): void => {
      const listBounds = listElement.getBoundingClientRect();
      const scrollBounds = scrollElement.getBoundingClientRect();
      const nextScrollMargin = scrollElement.scrollTop + listBounds.top - scrollBounds.top;
      setScrollMargin((currentMargin) =>
        Math.abs(currentMargin - nextScrollMargin) < 0.5 ? currentMargin : nextScrollMargin,
      );
    };

    measureScrollMargin();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureScrollMargin);
    resizeObserver?.observe(listElement);
    if (listElement.parentElement) {
      resizeObserver?.observe(listElement.parentElement);
    }
    window.addEventListener('resize', measureScrollMargin);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureScrollMargin);
    };
  }, [props.scrollPort.scrollElement, props.scrollPort.scrollElementRef]);

  useVirtualizedMessageJump(props.scrollPort, turnIndexByMessageId, virtualizer);
  useVirtualizedReadingAnchor(props.scrollPort, turnIndexByMessageId, virtualizer);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    // The DOM now contains the measured slot heights. Correct the following
    // viewport before paint, rather than showing the old bottom until a root
    // ResizeObserver / animation frame eventually notices the new list size.
    props.scrollPort.notifyContentGrew();
  }, [props.scrollPort, totalSize]);
  return (
    <div
      ref={listRef}
      className="transcript-turn-window"
      data-testid="transcript-turn-window"
      data-transcript-turn-count={props.turns.length}
      style={{ height: totalSize }}
    >
      {virtualItems.map((virtualItem) => {
        const turn = props.turns[virtualItem.index];
        if (!turn) {
          return null;
        }
        return (
          <div
            key={virtualItem.key}
            className={
              virtualItem.index === props.turns.length - 1
                ? 'transcript-turn-window-item is-live-tail'
                : 'transcript-turn-window-item'
            }
            data-testid="transcript-turn-window-item"
            data-live-tail={
              virtualItem.index === props.turns.length - 1 ? 'true' : undefined
            }
            style={{
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            }}
          >
            {/*
              Measure the inner body (natural height). The outer slot is locked
              to virtualItem.size so under-measure cannot paint over neighbors.
            */}
            <div
              ref={virtualizer.measureElement}
              className="transcript-turn-window-item-body"
              data-index={virtualItem.index}
              data-turn-id={turn.id}
            >
              {props.renderTurn(turn)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
