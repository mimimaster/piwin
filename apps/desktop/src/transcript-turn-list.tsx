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
import { messageAnchorId } from './transcript-outline';
import { useTranscriptScrollPort, type TranscriptScrollPort } from './transcript-scroll-port';
import { readTranscriptTurnHeight, rememberTranscriptTurnHeight } from './transcript-scroll-memory';
import { indexTranscriptTurnsByMessageId, type TranscriptTurn } from './transcript-turns';

export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 40;
const TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX = 360;
const TRANSCRIPT_TURN_GAP_PX = 20;
const TRANSCRIPT_TURN_OVERSCAN = 4;

export function shouldVirtualizeTranscript(turnCount: number): boolean {
  return turnCount > TRANSCRIPT_VIRTUALIZATION_THRESHOLD;
}

export function createTranscriptRangeExtractor(
  pinnedTurnIndex: number | null,
): (range: Range) => number[] {
  return (range) => {
    const indexes = defaultRangeExtractor(range);
    if (
      pinnedTurnIndex === null ||
      pinnedTurnIndex < 0 ||
      pinnedTurnIndex >= range.count ||
      indexes.includes(pinnedTurnIndex)
    ) {
      return indexes;
    }
    return [...indexes, pinnedTurnIndex].sort((left, right) => left - right);
  };
}

export type TranscriptTurnListProps = {
  turns: readonly TranscriptTurn[];
  pinnedMessageId: string | null;
  renderTurn: (turn: TranscriptTurn) => ReactElement;
};

export function TranscriptTurnList(props: TranscriptTurnListProps): ReactElement {
  const scrollPort = useTranscriptScrollPort();
  if (!scrollPort || !shouldVirtualizeTranscript(props.turns.length)) {
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
  const jumpFrameRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const highlightedElementRef = useRef<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const turnIndexByMessageId = useMemo(
    () => indexTranscriptTurnsByMessageId(props.turns),
    [props.turns],
  );
  const pinnedTurnIndex = props.pinnedMessageId
    ? (turnIndexByMessageId.get(props.pinnedMessageId) ?? null)
    : null;
  const rangeExtractor = useMemo(
    () => createTranscriptRangeExtractor(pinnedTurnIndex),
    [pinnedTurnIndex],
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
      const height = element.getBoundingClientRect().height;
      const turnId = element.dataset.turnId;
      if (props.scrollPort.sessionId && turnId) {
        rememberTranscriptTurnHeight(props.scrollPort.sessionId, turnId, height);
      }
      return height;
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

  useEffect(() => {
    const unregisterScroller = props.scrollPort.registerMessageScroller((messageId) => {
      const turnIndex = turnIndexByMessageId.get(messageId);
      if (turnIndex === undefined) {
        return false;
      }

      if (jumpFrameRef.current !== null) {
        window.cancelAnimationFrame(jumpFrameRef.current);
      }
      virtualizer.scrollToIndex(turnIndex, { align: 'center', behavior: 'auto' });
      jumpFrameRef.current = window.requestAnimationFrame(() => {
        jumpFrameRef.current = null;
        virtualizer.scrollToIndex(turnIndex, { align: 'center', behavior: 'auto' });
        const targetElement = document.getElementById(messageAnchorId(messageId));
        if (!targetElement) {
          return;
        }
        if (highlightTimerRef.current !== null) {
          window.clearTimeout(highlightTimerRef.current);
        }
        highlightedElementRef.current?.classList.remove('highlight-target');
        highlightedElementRef.current = targetElement;
        targetElement.classList.add('highlight-target');
        highlightTimerRef.current = window.setTimeout(() => {
          targetElement.classList.remove('highlight-target');
          if (highlightedElementRef.current === targetElement) {
            highlightedElementRef.current = null;
          }
          highlightTimerRef.current = null;
        }, 2000);
      });
      return true;
    });
    return () => {
      unregisterScroller();
      if (jumpFrameRef.current !== null) {
        window.cancelAnimationFrame(jumpFrameRef.current);
        jumpFrameRef.current = null;
      }
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      highlightedElementRef.current?.classList.remove('highlight-target');
      highlightedElementRef.current = null;
    };
  }, [props.scrollPort, turnIndexByMessageId, virtualizer]);

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
