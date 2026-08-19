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
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useTranscriptScrollPort, type TranscriptScrollPort } from './transcript-scroll-port';
import { scrollTranscriptToMessage } from './history-ticks-drawer';
import { readTranscriptTurnHeight, rememberTranscriptTurnHeight } from './transcript-scroll-memory';
import {
  normalizeTranscriptTurnHeight,
  TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX,
} from './transcript-turn-height';
import {
  flattenTranscriptTurnsToItems,
  indexTranscriptRenderItemsByMessageId,
  resolveTranscriptItemEstimate,
  type TranscriptRenderItem,
} from './transcript-render-item';
import { indexTranscriptTurnsByMessageId, type TranscriptTurn } from './transcript-turns';

export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 20;
export { TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX };
const TRANSCRIPT_TURN_GAP_PX = 20;
const TRANSCRIPT_TURN_OVERSCAN = 6;
/** Always keep the newest N items/turns mounted so the live call chain never unmounts. */
const TRANSCRIPT_LIVE_TAIL_PIN_COUNT = 3;

export function shouldVirtualizeTranscript(
  turnCount: number,
  options?: { streaming?: boolean },
): boolean {
  void options;
  return turnCount > TRANSCRIPT_VIRTUALIZATION_THRESHOLD;
}

export function createTranscriptRangeExtractor(
  pinnedIndex: number | null,
  liveTailStartIndex: number | null = null,
): (range: Range) => number[] {
  return (range) => {
    const indexes = new Set(defaultRangeExtractor(range));
    if (
      pinnedIndex !== null &&
      pinnedIndex >= 0 &&
      pinnedIndex < range.count
    ) {
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
  renderItem?: (item: TranscriptRenderItem) => ReactElement;
  latestAssistantMessageId?: string | null;
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
  const virtualize = shouldVirtualizeTranscript(props.turns.length, {
    streaming: props.streaming === true,
  });

  useEffect(() => {
    if (!scrollPort || virtualize) {
      return;
    }
    return scrollPort.registerMessageScroller((messageId) =>
      scrollTranscriptToMessage(messageId),
    );
  }, [scrollPort, virtualize]);

  if (!scrollPort || !virtualize) {
    if (props.renderItem) {
      const renderItems = flattenTranscriptTurnsToItems(props.turns, {
        ...(props.latestAssistantMessageId !== undefined && props.latestAssistantMessageId !== null
          ? { latestAssistantMessageId: props.latestAssistantMessageId }
          : {}),
      });
      return (
        <>
          {renderItems.map((item) => (
            <Fragment key={item.id}>{props.renderItem!(item)}</Fragment>
          ))}
        </>
      );
    }
    return (
      <>
        {props.turns.map((turn) => (
          <Fragment key={turn.id}>{props.renderTurn(turn)}</Fragment>
        ))}
      </>
    );
  }

  if (props.renderItem) {
    const renderItems = flattenTranscriptTurnsToItems(props.turns, {
      ...(props.latestAssistantMessageId !== undefined && props.latestAssistantMessageId !== null
        ? { latestAssistantMessageId: props.latestAssistantMessageId }
        : {}),
    });
    return (
      <VirtualizedTranscriptItems
        {...props}
        items={renderItems}
        scrollPort={scrollPort}
      />
    );
  }

  return (
    <VirtualizedTranscriptTurns
      {...props}
      scrollPort={scrollPort}
    />
  );
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
      const turnId = props.turns[turnIndex]?.id;
      if (!props.scrollPort.sessionId || !turnId) {
        return TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
      }
      return (
        readTranscriptTurnHeight(props.scrollPort.sessionId, turnId) ??
        TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX
      );
    },
    [props.scrollPort.sessionId, props.turns],
  );
  const measureElement = useCallback(
    (element: HTMLDivElement) => {
      const rawHeight = Math.max(element.offsetHeight, element.getBoundingClientRect().height);
      const normalized = normalizeTranscriptTurnHeight(rawHeight);
      const turnId = element.dataset.turnId;
      if (normalized !== null && props.scrollPort.sessionId && turnId) {
        rememberTranscriptTurnHeight(props.scrollPort.sessionId, turnId, normalized);
        return normalized;
      }
      return normalized ?? TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
    },
    [props.scrollPort.sessionId],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: props.turns.length,
    getScrollElement: () => props.scrollPort.scrollElementRef.current,
    estimateSize,
    getItemKey,
    gap: TRANSCRIPT_TURN_GAP_PX,
    measureElement,
    overscan: TRANSCRIPT_TURN_OVERSCAN,
    rangeExtractor,
    scrollMargin,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

  const turnsStructureKey = useMemo(
    () =>
      props.turns
        .map((turn) => {
          const last = turn.items[turn.items.length - 1]?.message;
          const toolSig = turn.items
            .map((item) =>
              item.message.tools
                ?.map((tool) => `${tool.toolCallId}:${tool.status}`)
                .join(',') ?? '',
            )
            .join(';');
          return `${turn.id}:${turn.items.length}:${last?.id ?? ''}:${last?.status ?? ''}:${toolSig}`;
        })
        .join('|'),
    [props.turns],
  );
  useLayoutEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structural key only
  }, [turnsStructureKey]);

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
  }, [props.scrollPort.scrollElementRef]);

  useVirtualizedMessageJump(props.scrollPort, turnIndexByMessageId, virtualizer);

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={listRef}
      className="transcript-turn-window"
      data-testid="transcript-turn-window"
      data-transcript-turn-count={props.turns.length}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualItem) => {
        const turn = props.turns[virtualItem.index];
        if (!turn) {
          return null;
        }
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            className="transcript-turn-window-item"
            data-index={virtualItem.index}
            data-turn-id={turn.id}
            style={{ transform: `translateY(${virtualItem.start - scrollMargin}px)` }}
          >
            {props.renderTurn(turn)}
          </div>
        );
      })}
    </div>
  );
}

function VirtualizedTranscriptItems(
  props: TranscriptTurnListProps & {
    items: readonly TranscriptRenderItem[];
    scrollPort: TranscriptScrollPort;
  },
): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const itemIndexByMessageId = useMemo(
    () => indexTranscriptRenderItemsByMessageId(props.items),
    [props.items],
  );
  const pinnedItemIndex = props.pinnedMessageId
    ? (itemIndexByMessageId.get(props.pinnedMessageId) ?? null)
    : null;
  const liveTailStartIndex =
    props.items.length > 0
      ? Math.max(0, props.items.length - TRANSCRIPT_LIVE_TAIL_PIN_COUNT)
      : null;
  const rangeExtractor = useMemo(
    () => createTranscriptRangeExtractor(pinnedItemIndex, liveTailStartIndex),
    [pinnedItemIndex, liveTailStartIndex],
  );
  const getItemKey = useCallback(
    (itemIndex: number) => props.items[itemIndex]?.id ?? itemIndex,
    [props.items],
  );
  const estimateSize = useCallback(
    (itemIndex: number) => {
      const item = props.items[itemIndex];
      if (!item) return TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
      const cachedHeight =
        props.scrollPort.sessionId && item.turnId
          ? readTranscriptTurnHeight(props.scrollPort.sessionId, item.turnId)
          : null;
      if (cachedHeight !== null) {
        return cachedHeight;
      }
      return resolveTranscriptItemEstimate(item);
    },
    [props.scrollPort.sessionId, props.items],
  );
  const measureElement = useCallback(
    (element: HTMLDivElement) => {
      const rawHeight = Math.max(element.offsetHeight, element.getBoundingClientRect().height);
      const normalized = normalizeTranscriptTurnHeight(rawHeight);
      const turnId = element.dataset.turnId;
      if (normalized !== null && props.scrollPort.sessionId && turnId) {
        rememberTranscriptTurnHeight(props.scrollPort.sessionId, turnId, normalized);
        return normalized;
      }
      return normalized ?? TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX;
    },
    [props.scrollPort.sessionId],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: props.items.length,
    getScrollElement: () => props.scrollPort.scrollElementRef.current,
    estimateSize,
    getItemKey,
    gap: TRANSCRIPT_TURN_GAP_PX,
    measureElement,
    overscan: TRANSCRIPT_TURN_OVERSCAN,
    rangeExtractor,
    scrollMargin,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

  const structureKey = useMemo(
    () =>
      props.items
        .map((item) => {
          if (item.type === 'tool-group') {
            const toolSig = item.tools.map((t) => `${t.toolCallId}:${t.status}`).join(',');
            return `tools:${item.id}:${toolSig}`;
          }
          if (item.type === 'assistant-message') {
            return `asst:${item.id}:${item.message.status}`;
          }
          return `${item.type}:${item.id}`;
        })
        .join('|'),
    [props.items],
  );
  useLayoutEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structural key only
  }, [structureKey]);

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
  }, [props.scrollPort.scrollElementRef]);

  useVirtualizedMessageJump(props.scrollPort, itemIndexByMessageId, virtualizer);

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={listRef}
      className="transcript-turn-window"
      data-testid="transcript-turn-window"
      data-transcript-item-count={props.items.length}
      data-transcript-turn-count={props.turns.length}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualItem) => {
        const item = props.items[virtualItem.index];
        if (!item || !props.renderItem) {
          return null;
        }
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            className="transcript-turn-window-item"
            data-index={virtualItem.index}
            data-item-id={item.id}
            data-item-type={item.type}
            data-turn-id={item.turnId}
            style={{ transform: `translateY(${virtualItem.start - scrollMargin}px)` }}
          >
            {props.renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}
