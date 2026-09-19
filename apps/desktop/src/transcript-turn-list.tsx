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
import {
  defaultRangeExtractor,
  elementScroll,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from '@tanstack/react-virtual';
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

/** Virtualize any non-empty transcript. Off-screen history must not mount. */
export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 0;
export { TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX };
export const TRANSCRIPT_TURN_GAP_PX = 20;
/**
 * Keep enough off-screen turns mounted that first-measure (estimate → actual)
 * happens above the fold. Overscan 2 let rows appear, remasure, then jump.
 */
const TRANSCRIPT_TURN_OVERSCAN = 8;
/** Always keep the newest N items/turns mounted so the live call chain never unmounts. */
const TRANSCRIPT_LIVE_TAIL_PIN_COUNT = 3;

/**
 * WKWebView starves `requestAnimationFrame` under a steady Host stream — the
 * same trap Streamdown's `startTransition` path hit. TanStack's default
 * ResizeObserver → rAF measure therefore never runs while tokens (or a
 * pause/error row) change height, so the next turn is placed on top of the
 * previous markdown.
 *
 * Slot height is locked to the virtualizer size cache (see render); measure the
 * inner body, not the locked outer shell.
 */
export function transcriptVirtualizerMeasurePolicy(streaming: boolean): {
  useAnimationFrameWithResizeObserver: false;
  useFlushSync: boolean;
} {
  return {
    useAnimationFrameWithResizeObserver: false,
    useFlushSync: streaming,
  };
}

type TranscriptVirtualizerScrollState = {
  scrollDirection: 'forward' | 'backward' | null;
  scrollAdjustments: number;
  scrollOffset: number | null;
  itemSizeCache: ReadonlyMap<string | number | bigint, number>;
};

/**
 * Pin-to-end is `notifyContentGrew` only. This predicate keeps the row the
 * user is reading still — it must not restick the live tail.
 *
 * First measure (estimate → actual) of a row that was fully above the fold
 * must shift scrollTop even while scrolling into history. Skipping that is
 * the “pull-up chat jumps / refreshes” bug. A spanning / just-entering row
 * is left alone so a near-tail flick is not yanked back.
 */
export function shouldAdjustTranscriptScrollOnItemSizeChange(
  item: Pick<VirtualItem, 'key' | 'start' | 'size'>,
  _delta: number,
  instance: TranscriptVirtualizerScrollState,
  following: boolean,
): boolean {
  const scrollOffset = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  const isFirstMeasure = !instance.itemSizeCache.has(item.key);
  const previousEnd = item.start + item.size;
  if (isFirstMeasure) {
    if (following) {
      return item.start < scrollOffset;
    }
    return previousEnd <= scrollOffset;
  }
  if (instance.scrollDirection === 'backward') {
    return false;
  }
  return previousEnd <= scrollOffset;
}

function transcriptTurnItemStructureKey(turn: TranscriptTurn): string {
  return turn.items
    .map((item) => {
      const message = item.message;
      const toolSig =
        message.tools?.map((tool) => `${tool.toolCallId}:${tool.status}`).join(',') ?? '';
      const failureCode = message.failure?.code ?? '';
      const errorSig = message.error ?? '';
      // Structure only — token growth is handled by buildTranscriptStreamingMeasureKey.
      return [message.id, message.status, toolSig, errorSig, failureCode].join(':');
    })
    .join(';');
}

/** Identity of mounted turn bodies so a pause/error/new-query remasures before paint. */
export function buildTranscriptTurnsStructureKey(turns: readonly TranscriptTurn[]): string {
  return turns
    .map((turn) => `${turn.id}:${turn.items.length}:${transcriptTurnItemStructureKey(turn)}`)
    .join('|');
}

/**
 * Live-tail content fingerprint. Includes text length so streaming growth
 * forces a remasure; structure key alone intentionally does not.
 */
export function buildTranscriptStreamingMeasureKey(
  turns: readonly TranscriptTurn[],
  streaming: boolean,
): string {
  if (!streaming || turns.length === 0) {
    return '';
  }
  const tail = turns.slice(-TRANSCRIPT_LIVE_TAIL_PIN_COUNT);
  return tail
    .map((turn) => {
      const body = turn.items
        .map((item) => {
          const message = item.message;
          const textLen = message.text?.length ?? 0;
          const thinkingLen = message.thinking?.length ?? 0;
          const toolSig =
            message.tools
              ?.map(
                (tool) =>
                  `${tool.toolCallId}:${tool.status}:${(tool.output ?? '').length}`,
              )
              .join(',') ?? '';
          return `${message.id}:${message.status}:${textLen}:${thinkingLen}:${toolSig}`;
        })
        .join(';');
      return `${turn.id}:${body}`;
    })
    .join('|');
}

export function shouldVirtualizeTranscript(turnCount: number): boolean {
  return turnCount > TRANSCRIPT_VIRTUALIZATION_THRESHOLD;
}

export function createTranscriptRangeExtractor(
  pinnedIndex: number | null,
  liveTailStartIndex: number | null = null,
): (range: Range) => number[] {
  return (range) => {
    const indexes = new Set(defaultRangeExtractor(range));
    if (pinnedIndex !== null && pinnedIndex >= 0 && pinnedIndex < range.count) {
      indexes.add(pinnedIndex);
    }
    if (liveTailStartIndex !== null && liveTailStartIndex >= 0) {
      for (let index = liveTailStartIndex; index < range.count; index += 1) {
        indexes.add(index);
      }
    }
    return [...indexes].sort((left, right) => left - right);
  };
}

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

  const measurePolicy = transcriptVirtualizerMeasurePolicy(props.streaming === true);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: props.turns.length,
    getScrollElement: () => props.scrollPort.scrollElement,
    estimateSize,
    getItemKey,
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
            className="transcript-turn-window-item"
            data-testid="transcript-turn-window-item"
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
