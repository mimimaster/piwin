import { buildHistoryTickMessages } from './history-tick-messages.js';
/**
 * Thin history ticks for the transcript viewport (right-edge ruler).
 *
 * Each tick represents one user message. Moving vertically across the rail
 * selects the nearest message, applies a symmetric length wave that grows
 * leftward into the stage, and shows a preview bubble to the rail's left;
 * clicking the rail jumps to the original message.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessageUi } from './chat-reducer';
import type { SessionUserMessageAnchor, SessionUserMessageIndexData } from '@piwin/contracts';
import { messageAnchorId } from './transcript-outline';
import { useTranscriptScrollPort } from './transcript-scroll-port';
import { useHistoryTickReadingPosition } from './history-tick-reading-position';

export type HistoryTicksDrawerProps = {
  messages?: ChatMessageUi[] | undefined;
  historyIndex?: SessionUserMessageIndexData | null | undefined;
  onJumpToAnchor?: ((anchor: SessionUserMessageAnchor) => Promise<void> | void) | undefined;
};

export function formatFullTimestamp(createdAt?: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month} ${day}, ${hours}:${minutes} ${ampm}`;
}

export function truncateMessageText(text: string, maxLength: number = 100): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

// Keep these geometry values in sync with the compact rail CSS variables
// (--history-tick-gap / --history-tick-pad-y). They let the pointer map to a
// tick without measuring every tick on every mouse event.
const COLLAPSED_TICK_HEIGHT_PX = 1;
const COLLAPSED_TICK_GAP_PX = 10;
const COLLAPSED_TICK_PADDING_TOP_PX = 8;
const COLLAPSED_TICK_STEP_PX = COLLAPSED_TICK_HEIGHT_PX + COLLAPSED_TICK_GAP_PX;

// Hover wave profile, peak first. Widths fall off on an ease-out curve (not
// a straight ramp) so the wave reads as one soft lens; opacity fades toward
// the resting tone in CSS; the peak and first shoulders gain a little weight
// so the selected turn is clearly picked without any extra mark. Keep the
// base width in sync with the compact rail CSS.
const COLLAPSED_TICK_BASE_WIDTH_PX = 8;
const HISTORY_TICK_WAVE_MAX_WIDTH_PX = 24;
const HISTORY_TICK_WAVE_PROFILE = [
  { widthPx: HISTORY_TICK_WAVE_MAX_WIDTH_PX, opacity: 0.75, thicknessPx: 2 },
  { widthPx: 17, opacity: 0.4, thicknessPx: 1.5 },
  { widthPx: 12.5, opacity: 0.25, thicknessPx: 1.5 },
  { widthPx: 9.5, opacity: 0.17, thicknessPx: 1 },
] as const;

type HistoryTickWaveStep = (typeof HISTORY_TICK_WAVE_PROFILE)[number];

function getHistoryTickWaveStep(distance: number): HistoryTickWaveStep | null {
  if (!Number.isFinite(distance)) {
    return null;
  }
  return HISTORY_TICK_WAVE_PROFILE[Math.round(Math.abs(distance))] ?? null;
}

/** Returns the horizontal scale for a collapsed tick at a wave distance. */
export function getHistoryTickWaveScale(distance: number): number {
  const step = getHistoryTickWaveStep(distance);
  return step ? step.widthPx / COLLAPSED_TICK_BASE_WIDTH_PX : 1;
}

/** Inline wave style for a tick, or undefined when it rests (CSS styles it). */
export function getHistoryTickWaveStyle(distance: number | null): CSSProperties | undefined {
  const step = distance === null ? null : getHistoryTickWaveStep(distance);
  if (!step) {
    return undefined;
  }
  const style: CSSProperties = {
    transform: `scaleX(${step.widthPx / COLLAPSED_TICK_BASE_WIDTH_PX})`,
    opacity: step.opacity,
  };
  if (step.thicknessPx !== COLLAPSED_TICK_HEIGHT_PX) {
    // Negative block margins keep the extra weight out of layout, so the
    // column (and the pointer→tick mapping) never shifts.
    style.height = `${step.thicknessPx}px`;
    style.marginBlock = `${(COLLAPSED_TICK_HEIGHT_PX - step.thicknessPx) / 2}px`;
  }
  return style;
}

type CollapsedBubbleAnchor = {
  /** Viewport X of the bubble's right edge; the bubble opens leftward. */
  edgeX: number;
  top: number;
};

type CollapsedRailMetrics = {
  rail: HTMLDivElement;
  top: number;
  bubbleEdgeX: number;
  tickCount: number;
};

/** Gap between the peak wave tip and the preview bubble. Keep small so the
 *  tooltip reads as attached to the tick rail rather than floating mid-stage. */
const COLLAPSED_BUBBLE_OFFSET_PX = 8;
const COLLAPSED_BUBBLE_MAX_HALF_HEIGHT_PX = 120;
const COLLAPSED_BUBBLE_VIEWPORT_PADDING_PX = 12;

function clampCollapsedBubbleTop(centerY: number): number {
  const viewportHeight = window.innerHeight || 768;
  const minTop = COLLAPSED_BUBBLE_VIEWPORT_PADDING_PX + COLLAPSED_BUBBLE_MAX_HALF_HEIGHT_PX;
  const maxTop = Math.max(
    minTop,
    viewportHeight - COLLAPSED_BUBBLE_VIEWPORT_PADDING_PX - COLLAPSED_BUBBLE_MAX_HALF_HEIGHT_PX,
  );
  return Math.min(Math.max(centerY, minTop), maxTop);
}

/** Viewport X just short of the peak wave tip for a right-edge rail. Ticks
 *  are right-aligned in the strip, so the tip sits at railRight - max width. */
function getBubbleEdgeXFromRailRight(railRight: number): number {
  return railRight - HISTORY_TICK_WAVE_MAX_WIDTH_PX - COLLAPSED_BUBBLE_OFFSET_PX;
}

function getCollapsedBubbleAnchor(element: HTMLElement): CollapsedBubbleAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    // Focus path measures the tick itself; use its painted left edge so a
    // scaled wave tip is the anchor rather than the full reserved strip.
    edgeX: bounds.left - COLLAPSED_BUBBLE_OFFSET_PX,
    top: clampCollapsedBubbleTop(bounds.top + bounds.height / 2),
  };
}

/**
 * Map a pointer Y on the collapsed rail to the nearest tick index.
 * Shared by hover preview and click-to-jump so gaps between 1px ticks still
 * resolve to a message (hover already did; click must match).
 */
export function resolveCollapsedTickIndex(options: {
  clientY: number;
  railTop: number;
  railScrollTop: number;
  tickCount: number;
}): number | null {
  if (options.tickCount <= 0) {
    return null;
  }

  const localY =
    options.clientY - options.railTop + options.railScrollTop - COLLAPSED_TICK_PADDING_TOP_PX;
  const rawPosition = (localY - COLLAPSED_TICK_HEIGHT_PX / 2) / COLLAPSED_TICK_STEP_PX;
  const pointerPosition = Math.min(Math.max(rawPosition, 0), options.tickCount - 1);
  return Math.round(pointerPosition);
}

/** Scroll the transcript to a message anchor. Instant: smooth scrolling fights
 *  the virtualizer and follow-tail stick, which reads as a laggy jump. */
export function scrollTranscriptToMessage(messageId: string): boolean {
  const targetElement = document.getElementById(messageAnchorId(messageId));
  if (!targetElement) {
    return false;
  }

  const scrollParent = targetElement.closest('.chat-stream');
  if (scrollParent instanceof HTMLElement) {
    const parentRect = scrollParent.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const parentCenterY = parentRect.top + parentRect.height / 2;
    const nextScrollTop = scrollParent.scrollTop + (targetCenterY - parentCenterY);
    scrollParent.scrollTo({ top: nextScrollTop, behavior: 'auto' });
  } else {
    targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  return true;
}

export const HistoryTicksDrawer = memo(function HistoryTicksDrawer({
  messages = [],
  historyIndex = null,
  onJumpToAnchor,
}: HistoryTicksDrawerProps): ReactElement | null {
  const transcriptScrollPort = useTranscriptScrollPort();
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [collapsedBubbleAnchor, setCollapsedBubbleAnchor] = useState<CollapsedBubbleAnchor | null>(
    null,
  );
  const [waveCenterIndex, setWaveCenterIndex] = useState<number | null>(null);

  const railMetricsRef = useRef<CollapsedRailMetrics | null>(null);
  const hoveredIndexRef = useRef<number | null>(null);

  const userMessages = useMemo(
    () => buildHistoryTickMessages(messages, historyIndex), [historyIndex, messages],
  );
  const tickIds = useMemo(() => userMessages.map((message) => message.id), [userMessages]);
  const readingIndex = useHistoryTickReadingPosition(
    transcriptScrollPort?.scrollElement ?? null,
    tickIds,
  );
  const stripRef = useRef<HTMLDivElement | null>(null);

  const clearPreview = useCallback((): void => {
    setHoveredMessageId(null);
    setCollapsedBubbleAnchor(null);
  }, []);

  const clearRailInteraction = useCallback((): void => {
    clearPreview();
    setWaveCenterIndex(null);
    railMetricsRef.current = null;
    hoveredIndexRef.current = null;
  }, [clearPreview]);

  const refreshRailMetrics = useCallback((rail: HTMLDivElement): CollapsedRailMetrics => {
    const bounds = rail.getBoundingClientRect();
    const metrics: CollapsedRailMetrics = {
      rail,
      top: bounds.top,
      bubbleEdgeX: getBubbleEdgeXFromRailRight(bounds.right),
      tickCount: userMessages.length,
    };
    railMetricsRef.current = metrics;
    return metrics;
  }, [userMessages.length]);

  const updateRailPreview = useCallback(
    (rail: HTMLDivElement, clientY: number): void => {
      const metrics =
        railMetricsRef.current?.rail === rail &&
        railMetricsRef.current.tickCount === userMessages.length
          ? railMetricsRef.current
          : refreshRailMetrics(rail);
      const nextIndex = resolveCollapsedTickIndex({
        clientY,
        railTop: metrics.top,
        railScrollTop: rail.scrollTop,
        tickCount: metrics.tickCount,
      });
      if (nextIndex === null) {
        return;
      }
      // Keep the visual wave independent from the preview state. A pointer
      // can enter the rail without producing a follow-up mousemove, and the
      // nearest tick must still become the peak immediately.
      setWaveCenterIndex(nextIndex);

      if (hoveredIndexRef.current !== nextIndex) {
        hoveredIndexRef.current = nextIndex;
        const message = userMessages[nextIndex];
        if (message) {
          setHoveredMessageId(message.id);
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
    [refreshRailMetrics, userMessages],
  );

  const handleTickJump = useCallback(
    (messageId: string): void => {
      // Resident rows first. scrollToMessage() is false for short
      // (non-virtualized) transcripts and for ticks whose DOM node is already
      // mounted — those used to fall through to a Host window fetch.
      if (transcriptScrollPort?.scrollToMessage(messageId)) {
        return;
      }
      if (scrollTranscriptToMessage(messageId)) {
        transcriptScrollPort?.detachFromTail();
        return;
      }
      const target = userMessages.find((message) => message.id === messageId);
      const anchor = target?.anchor;
      if (!anchor || !onJumpToAnchor) {
        return;
      }
      const settleJump = (): boolean =>
        Boolean(transcriptScrollPort?.scrollToMessage(messageId)) ||
        scrollTranscriptToMessage(messageId);
      const jump = async (): Promise<void> => {
        await onJumpToAnchor(anchor);
        if (settleJump()) {
          return;
        }
        window.requestAnimationFrame(() => {
          if (settleJump()) {
            return;
          }
          window.requestAnimationFrame(() => {
            settleJump();
          });
        });
      };
      void jump().catch((error: unknown) => {
        console.error('history anchor jump failed', error);
      });
    },
    [onJumpToAnchor, transcriptScrollPort, userMessages],
  );

  /** Click anywhere on the rail (including gaps between 1px ticks) jumps. */
  const handleRailClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const rail = event.currentTarget;
      const metrics =
        railMetricsRef.current?.rail === rail &&
        railMetricsRef.current.tickCount === userMessages.length
          ? railMetricsRef.current
          : refreshRailMetrics(rail);
      const nextIndex = resolveCollapsedTickIndex({
        clientY: event.clientY,
        railTop: metrics.top,
        railScrollTop: rail.scrollTop,
        tickCount: metrics.tickCount,
      });
      if (nextIndex === null) {
        return;
      }

      const message = userMessages[nextIndex];
      if (!message) {
        return;
      }

      event.preventDefault();
      // Keep the preview wave on the jumped tick; still scroll the transcript.
      hoveredIndexRef.current = nextIndex;
      setWaveCenterIndex(nextIndex);
      setHoveredMessageId(message.id);
      handleTickJump(message.id);
    },
    [handleTickJump, refreshRailMetrics, userMessages],
  );

  const handleTickFocus = useCallback(
    (messageId: string, event: ReactFocusEvent<HTMLSpanElement>): void => {
      const element = event.currentTarget;
      const index = userMessages.findIndex((message) => message.id === messageId);
      const rail = element.closest('.history-ticks-border-strip');
      if (rail instanceof HTMLDivElement && index >= 0) {
        refreshRailMetrics(rail);
        hoveredIndexRef.current = index;
        setWaveCenterIndex(index);
      }
      setHoveredMessageId(messageId);
      setCollapsedBubbleAnchor(getCollapsedBubbleAnchor(element));
    },
    [refreshRailMetrics, userMessages],
  );

  // Clear the preview if a session swaps out the hovered message.
  useEffect(() => {
    if (hoveredMessageId && !userMessages.some((message) => message.id === hoveredMessageId)) {
      clearRailInteraction();
    }
  }, [clearRailInteraction, hoveredMessageId, userMessages]);

  // A fixed bubble must not remain at an old viewport coordinate while the
  // transcript scrolls underneath it.
  useEffect(() => {
    if (!hoveredMessageId) {
      return;
    }

    const clearPreviewOnScroll = (): void => {
      clearRailInteraction();
    };
    window.addEventListener('scroll', clearPreviewOnScroll, true);
    return () => {
      window.removeEventListener('scroll', clearPreviewOnScroll, true);
    };
  }, [clearRailInteraction, hoveredMessageId]);

  // A long rail scrolls (scrollbar hidden); keep the reading tick in view
  // while the reader scrolls the transcript, but never under the pointer.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || readingIndex === null || waveCenterIndex !== null) {
      return;
    }
    if (strip.scrollHeight <= strip.clientHeight) {
      return;
    }
    const tickTop = COLLAPSED_TICK_PADDING_TOP_PX + readingIndex * COLLAPSED_TICK_STEP_PX;
    const margin = COLLAPSED_TICK_STEP_PX * 3;
    if (tickTop - margin < strip.scrollTop) {
      strip.scrollTop = Math.max(tickTop - margin, 0);
    } else if (tickTop + margin > strip.scrollTop + strip.clientHeight) {
      strip.scrollTop = tickTop + margin - strip.clientHeight;
    }
  }, [readingIndex, waveCenterIndex]);

  // Keep this guard after every hook so an empty session can become populated
  // without changing the component's hook order.
  if (userMessages.length === 0) {
    return null;
  }

  const previewMessage = userMessages.find((message) => message.id === hoveredMessageId);
  const previewPosition =
    previewMessage?.anchor && historyIndex
      ? previewMessage.anchor.spanStartOrdinal === previewMessage.anchor.spanEndOrdinal
        ? `${previewMessage.anchor.ordinal + 1} / ${historyIndex.totalUserMessages}`
        : `${previewMessage.anchor.spanStartOrdinal + 1}–${previewMessage.anchor.spanEndOrdinal + 1} / ${historyIndex.totalUserMessages}`
      : null;

  return (
    <div
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
      data-history-total-user-messages={historyIndex?.totalUserMessages ?? userMessages.length}
    >
      <div
        ref={stripRef}
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
          {userMessages.map((message, index) => {
            const isPreviewed = message.id === hoveredMessageId;
            const waveDistance =
              waveCenterIndex === null ? null : Math.abs(index - waveCenterIndex);
            const waveStyle = getHistoryTickWaveStyle(waveDistance);
            // State classes for tests/themes; the look is the inline wave.
            const waveClass = isPreviewed ? 'is-hovered' : waveStyle ? 'is-in-wave' : '';
            const readingClass = index === readingIndex ? ' is-reading' : '';

            return (
              <span
                key={message.id}
                className={`border-tick-line ${waveClass}${readingClass}`}
                style={waveStyle}
                data-testid={`history-tick-${message.id}`}
                onFocus={(event) => handleTickFocus(message.id, event)}
                onBlur={clearRailInteraction}
                onClick={(event) => {
                  event.stopPropagation();
                  handleTickJump(message.id);
                }}
                role="button"
                tabIndex={0}
                aria-describedby={isPreviewed ? 'history-message-bubble' : undefined}
                aria-current={index === readingIndex ? 'location' : undefined}
                aria-label={`Jump to history message ${(message.anchor?.ordinal ?? index) + 1}: ${truncateMessageText(message.text, 60)}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleTickJump(message.id);
                  }
                }}
              />
            );
          })}
        </div>
      </div>

      {previewMessage && collapsedBubbleAnchor
        ? // Portal to document.body so position:fixed is viewport-relative.
          // Parent chat-column/workspace use backdrop-filter, which creates a
          // containing block and made the bubble sit far from the tick rail.
          createPortal(
            <div
              id="history-message-bubble"
              className="history-message-bubble history-message-bubble--collapsed"
              data-testid="history-message-bubble"
              role="tooltip"
              style={{
                // Anchor the right edge so the bubble opens leftward off the rail
                // without measuring its own width.
                right: `${(document.documentElement.clientWidth || window.innerWidth) - collapsedBubbleAnchor.edgeX}px`,
                top: `${collapsedBubbleAnchor.top}px`,
              }}
            >
              <div className="history-bubble-header">
                <span className="history-bubble-time">
                  {formatFullTimestamp(previewMessage.createdAt) || 'User message'}
                </span>
                {previewPosition ? (
                  <span className="history-bubble-position">{previewPosition}</span>
                ) : null}
              </div>
              <div className="history-bubble-text">
                {truncateMessageText(previewMessage.text, 240)}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
