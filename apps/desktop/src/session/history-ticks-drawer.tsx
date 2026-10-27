/**
 * Thin history ticks for the transcript viewport (right-edge ruler).
 *
 * Each tick represents one user message — or, when the session has more
 * turns than the rail has room for, one evenly sized segment of turns.
 * Ticks carry the Host's turn marks (error, compaction, branch, artifact)
 * as a tint. Moving vertically across the rail selects the nearest tick,
 * applies a symmetric length wave that grows leftward into the stage, and
 * shows a preview bubble to the rail's left; clicking jumps to the turn.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import type { SessionUserMessageIndexData } from '@piwin/contracts';
import type { ChatMessageUi } from '../conversation/chat-reducer';
import { useTranscriptScrollPort } from '../conversation/transcript-scroll-port';
import { useHistoryTickReadingPosition } from './history-tick-reading-position';
import { buildHistoryTickMessages, countHistoryTickTurns } from './history-tick-messages.js';
import {
  findHistoryTickGroupIndex,
  groupHistoryTicks,
  resolveHistoryTickCapacity,
  type HistoryTickGroup,
} from './history-tick-groups.js';
import {
  COLLAPSED_TICK_GAP_PX,
  COLLAPSED_TICK_HEIGHT_PX,
  COLLAPSED_TICK_PADDING_TOP_PX,
  COLLAPSED_TICK_STEP_PX,
  clampCollapsedBubbleTop,
  getBubbleEdgeXFromRailRight,
  getCollapsedBubbleAnchor,
  getHistoryTickWaveStyle,
  resolveCollapsedTickIndex,
  type CollapsedBubbleAnchor,
  type CollapsedRailMetrics,
} from './history-tick-geometry.js';
import { jumpToHistoryMessage, type HistoryAnchorJumpHandler } from './history-anchor-jump.js';
import {
  HistoryTickBubble,
  formatHistoryTickPosition,
  formatTurnMarks,
  truncateMessageText,
  type HistoryTickLocale,
} from './history-tick-bubble.js';

export type HistoryTicksDrawerProps = {
  messages?: ChatMessageUi[] | undefined;
  historyIndex?: SessionUserMessageIndexData | null | undefined;
  onJumpToAnchor?: HistoryAnchorJumpHandler | undefined;
  locale?: HistoryTickLocale | undefined;
};

/**
 * Rail height in px (the drawer box spans the space the rail may use).
 * Measured before paint so a dense rail never shows unmerged ticks first.
 */
function useRailHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = (): void => setHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

export const HistoryTicksDrawer = memo(function HistoryTicksDrawer({
  messages = [],
  historyIndex = null,
  onJumpToAnchor,
  locale = 'en',
}: HistoryTicksDrawerProps): ReactElement | null {
  const transcriptScrollPort = useTranscriptScrollPort();
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [collapsedBubbleAnchor, setCollapsedBubbleAnchor] = useState<CollapsedBubbleAnchor | null>(
    null,
  );
  const [waveCenterIndex, setWaveCenterIndex] = useState<number | null>(null);
  const [drawerElement, setDrawerElement] = useState<HTMLDivElement | null>(null);

  const railMetricsRef = useRef<CollapsedRailMetrics | null>(null);
  const hoveredIndexRef = useRef<number | null>(null);

  const ticks = useMemo(
    () => buildHistoryTickMessages(messages, historyIndex),
    [historyIndex, messages],
  );
  const totalTurns = countHistoryTickTurns(ticks, historyIndex);
  const railHeight = useRailHeight(drawerElement);
  const groups = useMemo(
    () => groupHistoryTicks(ticks, resolveHistoryTickCapacity(railHeight)),
    [railHeight, ticks],
  );
  const tickIds = useMemo(() => ticks.map((tick) => tick.id), [ticks]);
  const readingTickIndex = useHistoryTickReadingPosition(
    transcriptScrollPort?.scrollElement ?? null,
    tickIds,
  );
  const readingIndex = findHistoryTickGroupIndex(groups, readingTickIndex);

  const clearPreview = useCallback((): void => {
    setHoveredGroupId(null);
    setCollapsedBubbleAnchor(null);
  }, []);

  const clearRailInteraction = useCallback((): void => {
    clearPreview();
    setWaveCenterIndex(null);
    railMetricsRef.current = null;
    hoveredIndexRef.current = null;
  }, [clearPreview]);

  const refreshRailMetrics = useCallback(
    (rail: HTMLDivElement): CollapsedRailMetrics => {
      const bounds = rail.getBoundingClientRect();
      const metrics: CollapsedRailMetrics = {
        rail,
        top: bounds.top,
        bubbleEdgeX: getBubbleEdgeXFromRailRight(bounds.right),
        tickCount: groups.length,
      };
      railMetricsRef.current = metrics;
      return metrics;
    },
    [groups.length],
  );

  const resolveRailIndex = useCallback(
    (rail: HTMLDivElement, clientY: number): { index: number; metrics: CollapsedRailMetrics } | null => {
      const metrics =
        railMetricsRef.current?.rail === rail && railMetricsRef.current.tickCount === groups.length
          ? railMetricsRef.current
          : refreshRailMetrics(rail);
      const index = resolveCollapsedTickIndex({
        clientY,
        railTop: metrics.top,
        railScrollTop: rail.scrollTop,
        tickCount: metrics.tickCount,
      });
      return index === null ? null : { index, metrics };
    },
    [groups.length, refreshRailMetrics],
  );

  const updateRailPreview = useCallback(
    (rail: HTMLDivElement, clientY: number): void => {
      const resolved = resolveRailIndex(rail, clientY);
      if (!resolved) {
        return;
      }
      const { index: nextIndex, metrics } = resolved;
      // Keep the visual wave independent from the preview state. A pointer
      // can enter the rail without producing a follow-up mousemove, and the
      // nearest tick must still become the peak immediately.
      setWaveCenterIndex(nextIndex);

      if (hoveredIndexRef.current !== nextIndex) {
        hoveredIndexRef.current = nextIndex;
        const group = groups[nextIndex];
        if (group) {
          setHoveredGroupId(group.id);
          setCollapsedBubbleAnchor({
            edgeX: metrics.bubbleEdgeX,
            top: clampCollapsedBubbleTop(
              metrics.top +
                COLLAPSED_TICK_PADDING_TOP_PX +
                nextIndex * COLLAPSED_TICK_STEP_PX +
                COLLAPSED_TICK_HEIGHT_PX / 2 -
                rail.scrollTop,
            ),
          });
        }
      }
    },
    [groups, resolveRailIndex],
  );

  const handleGroupJump = useCallback(
    (group: HistoryTickGroup): void => {
      jumpToHistoryMessage({
        port: transcriptScrollPort,
        messageId: group.first.id,
        anchor: group.first.anchor,
        onJumpToAnchor,
      });
    },
    [onJumpToAnchor, transcriptScrollPort],
  );

  /** Click anywhere on the rail (including gaps between 1px ticks) jumps. */
  const handleRailClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const resolved = resolveRailIndex(event.currentTarget, event.clientY);
      const group = resolved ? groups[resolved.index] : undefined;
      if (!resolved || !group) {
        return;
      }
      event.preventDefault();
      // Keep the preview wave on the jumped tick; still scroll the transcript.
      hoveredIndexRef.current = resolved.index;
      setWaveCenterIndex(resolved.index);
      setHoveredGroupId(group.id);
      handleGroupJump(group);
    },
    [groups, handleGroupJump, resolveRailIndex],
  );

  const handleTickFocus = useCallback(
    (index: number, event: ReactFocusEvent<HTMLSpanElement>): void => {
      const element = event.currentTarget;
      const group = groups[index];
      const rail = element.closest('.history-ticks-border-strip');
      if (rail instanceof HTMLDivElement) {
        refreshRailMetrics(rail);
        hoveredIndexRef.current = index;
        setWaveCenterIndex(index);
      }
      setHoveredGroupId(group?.id ?? null);
      setCollapsedBubbleAnchor(getCollapsedBubbleAnchor(element));
    },
    [groups, refreshRailMetrics],
  );

  // Clear the preview if a session swap or regroup removes the hovered tick.
  useEffect(() => {
    if (hoveredGroupId && !groups.some((group) => group.id === hoveredGroupId)) {
      clearRailInteraction();
    }
  }, [clearRailInteraction, groups, hoveredGroupId]);

  // A fixed bubble must not remain at an old viewport coordinate while the
  // transcript scrolls underneath it.
  useEffect(() => {
    if (!hoveredGroupId) {
      return;
    }

    const clearPreviewOnScroll = (): void => {
      clearRailInteraction();
    };
    window.addEventListener('scroll', clearPreviewOnScroll, true);
    return () => {
      window.removeEventListener('scroll', clearPreviewOnScroll, true);
    };
  }, [clearRailInteraction, hoveredGroupId]);

  // Keep this guard after every hook so an empty session can become populated
  // without changing the component's hook order.
  if (groups.length === 0) {
    return null;
  }

  const previewGroup = groups.find((group) => group.id === hoveredGroupId);

  return (
    <div
      ref={setDrawerElement}
      className="history-ticks-drawer"
      onMouseLeave={clearRailInteraction}
      onMouseOut={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return;
        }
        clearRailInteraction();
      }}
      data-testid="history-ticks-drawer"
      data-history-index-mode={historyIndex?.mode ?? 'resident-fallback'}
      data-history-total-user-messages={totalTurns}
      data-history-segmented={groups.length < ticks.length ? 'true' : undefined}
    >
      <div
        className="history-ticks-border-strip"
        data-testid="history-drawer-handle"
        style={
          {
            '--history-tick-gap': `${COLLAPSED_TICK_GAP_PX}px`,
            '--history-tick-pad-y': `${COLLAPSED_TICK_PADDING_TOP_PX}px`,
          } as CSSProperties
        }
        onMouseEnter={(event) => {
          updateRailPreview(event.currentTarget, event.clientY);
        }}
        onMouseMove={(event) => {
          updateRailPreview(event.currentTarget, event.clientY);
        }}
        onMouseLeave={clearRailInteraction}
        onClick={handleRailClick}
        onScroll={clearRailInteraction}
      >
        <div className="border-ticks-list">
          {groups.map((group, index) => {
            const isPreviewed = group.id === hoveredGroupId;
            const waveDistance =
              waveCenterIndex === null ? null : Math.abs(index - waveCenterIndex);
            const waveStyle = getHistoryTickWaveStyle(waveDistance);
            // State classes for tests/themes; the look is the inline wave.
            const waveClass = isPreviewed ? 'is-hovered' : waveStyle ? 'is-in-wave' : '';
            const readingClass = index === readingIndex ? ' is-reading' : '';
            const marks = formatTurnMarks(group.marks, locale);

            return (
              <span
                key={group.id}
                className={`border-tick-line ${waveClass}${readingClass}`}
                style={waveStyle}
                data-testid={`history-tick-${group.id}`}
                data-mark={group.marks[0]}
                data-tick-count={group.tickCount > 1 ? group.tickCount : undefined}
                onFocus={(event) => handleTickFocus(index, event)}
                onBlur={clearRailInteraction}
                onClick={(event) => {
                  event.stopPropagation();
                  handleGroupJump(group);
                }}
                role="button"
                tabIndex={0}
                aria-describedby={isPreviewed ? 'history-message-bubble' : undefined}
                aria-current={index === readingIndex ? 'location' : undefined}
                aria-label={`Jump to history message ${formatHistoryTickPosition(group, totalTurns)}${marks ? ` (${marks})` : ''}: ${truncateMessageText(group.first.text, 60)}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleGroupJump(group);
                  }
                }}
              />
            );
          })}
        </div>
      </div>

      {previewGroup && collapsedBubbleAnchor ? (
        <HistoryTickBubble
          group={previewGroup}
          anchor={collapsedBubbleAnchor}
          totalTurns={totalTurns}
          locale={locale}
        />
      ) : null}
    </div>
  );
});
