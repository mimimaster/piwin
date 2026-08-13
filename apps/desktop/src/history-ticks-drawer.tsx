/**
 * Thin history ticks for the transcript viewport.
 *
 * Each tick represents one user message. Moving vertically across the rail
 * selects the nearest message, applies a symmetric horizontal length wave, and
 * shows a preview bubble; clicking the rail jumps to the original message.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessageUi } from './chat-reducer';
import type { SessionUserMessageAnchor, SessionUserMessageIndexData } from '@piwin/contracts';
import { messageAnchorId } from './transcript-outline';
import { useTranscriptScrollPort } from './transcript-scroll-port';

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

// Keep these geometry values in sync with the compact rail CSS. They let the
// pointer map to a tick without measuring every tick on every mouse event.
const COLLAPSED_TICK_HEIGHT_PX = 1;
const COLLAPSED_TICK_GAP_PX = 10;
const COLLAPSED_TICK_PADDING_TOP_PX = 8;
const COLLAPSED_TICK_STEP_PX = COLLAPSED_TICK_HEIGHT_PX + COLLAPSED_TICK_GAP_PX;

// The wave is an arithmetic progression of widths. Keep the base width in
// sync with the compact rail CSS; the step is derived so changing either
// endpoint automatically recalculates every intermediate tick.
const COLLAPSED_TICK_BASE_WIDTH_PX = 10;
const HISTORY_TICK_WAVE_MAX_WIDTH_PX = 30;
const HISTORY_TICK_WAVE_RADIUS = 4;
const HISTORY_TICK_WAVE_STEP_PX =
  (HISTORY_TICK_WAVE_MAX_WIDTH_PX - COLLAPSED_TICK_BASE_WIDTH_PX) / HISTORY_TICK_WAVE_RADIUS;

/** Returns the discrete horizontal scale for a collapsed tick wave. */
export function getHistoryTickWaveScale(distance: number): number {
  if (!Number.isFinite(distance)) {
    return 1;
  }

  const clampedDistance = Math.min(Math.max(distance, 0), HISTORY_TICK_WAVE_RADIUS);
  const distanceIndex = Math.round(clampedDistance);
  const width = HISTORY_TICK_WAVE_MAX_WIDTH_PX - distanceIndex * HISTORY_TICK_WAVE_STEP_PX;
  return width / COLLAPSED_TICK_BASE_WIDTH_PX;
}

type CollapsedBubbleAnchor = {
  left: number;
  top: number;
};

type CollapsedRailMetrics = {
  rail: HTMLDivElement;
  top: number;
  right: number;
  tickCount: number;
};

type HistoryTickMessage = {
  id: string;
  text: string;
  createdAt?: string;
  anchor?: SessionUserMessageAnchor;
};

/** Gap between the peak wave tip and the preview bubble. Keep small so the
 *  tooltip reads as attached to the tick rail rather than floating mid-stage. */
const COLLAPSED_BUBBLE_OFFSET_PX = 8;
/** How long a cold-anchor jump retries before falling back to plain DOM scroll. */
const HISTORY_JUMP_RETRY_WINDOW_MS = 2_000;
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

/** Viewport X just past the peak wave tip for a given rail left edge. */
function getBubbleLeftFromRailLeft(railLeft: number): number {
  return railLeft + HISTORY_TICK_WAVE_MAX_WIDTH_PX + COLLAPSED_BUBBLE_OFFSET_PX;
}

function getCollapsedBubbleAnchor(element: HTMLElement): CollapsedBubbleAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    // Focus path measures the tick itself; use its painted right edge so a
    // scaled wave tip is the anchor rather than the full reserved strip.
    left: bounds.right + COLLAPSED_BUBBLE_OFFSET_PX,
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

/** Scroll the transcript to a message anchor, preferring the chat-stream port. */
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
    scrollParent.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
  } else {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  targetElement.classList.add('highlight-target');
  window.setTimeout(() => {
    targetElement.classList.remove('highlight-target');
  }, 2000);
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

  const userMessages = useMemo<HistoryTickMessage[]>(() => {
    if (historyIndex !== null) {
      return historyIndex.anchors.map((anchor) => ({
        id: anchor.messageId,
        text: anchor.preview,
        createdAt: anchor.createdAt,
        anchor,
      }));
    }
    return messages
      .filter((message) => message.role === 'user' && message.text.trim().length > 0)
      .map((message) => ({
        id: message.id,
        text: message.text,
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      }));
  }, [historyIndex, messages]);

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
    const tickElements = Array.from(rail.querySelectorAll<HTMLElement>('.border-tick-line'));
    // Anchor at the peak wave tip (base left + max wave width). Do not add the
    // strip's right padding — that pushed the bubble far into the stage gutter,
    // especially when a parent backdrop-filter rebased fixed coordinates.
    const bubbleAnchorRight = getBubbleLeftFromRailLeft(bounds.left);

    const metrics: CollapsedRailMetrics = {
      rail,
      top: bounds.top,
      right: bubbleAnchorRight,
      tickCount: tickElements.length,
    };
    railMetricsRef.current = metrics;
    return metrics;
  }, []);

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
            left: metrics.right,
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
      if (transcriptScrollPort?.scrollToMessage(messageId)) {
        return;
      }
      const target = userMessages.find((message) => message.id === messageId);
      const anchor = target?.anchor;
      if (anchor && onJumpToAnchor) {
        const jump = async (): Promise<void> => {
          await onJumpToAnchor(anchor);
          // The virtualized scroller re-registers only after the seek window
          // commits and the turn list rebuilds its index. Retry across frames
          // until the scroller accepts the message; fall back to DOM after the
          // deadline (non-virtualized view).
          const deadline = performance.now() + HISTORY_JUMP_RETRY_WINDOW_MS;
          const attemptScroll = (): void => {
            if (transcriptScrollPort?.scrollToMessage(messageId)) {
              return;
            }
            if (performance.now() > deadline) {
              scrollTranscriptToMessage(messageId);
              return;
            }
            window.requestAnimationFrame(attemptScroll);
          };
          window.requestAnimationFrame(attemptScroll);
        };
        void jump().catch((error: unknown) => {
          console.error('history anchor jump failed', error);
        });
        return;
      }
      scrollTranscriptToMessage(messageId);
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
      className="history-ticks-drawer is-collapsed"
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
        className="history-ticks-border-strip"
        data-testid="history-drawer-handle"
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
            const waveScale =
              waveCenterIndex === null
                ? 1
                : getHistoryTickWaveScale(Math.abs(index - waveCenterIndex));

            return (
              <span
                key={message.id}
                className={`border-tick-line ${isPreviewed ? 'is-hovered' : ''}`}
                style={waveScale === 1 ? undefined : { transform: `scaleX(${waveScale})` }}
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
                left: `${collapsedBubbleAnchor.left}px`,
                top: `${collapsedBubbleAnchor.top}px`,
              }}
            >
              <div className="history-bubble-header">
                {formatFullTimestamp(previewMessage.createdAt) || 'User Message'}
              </div>
              {previewPosition ? (
                <div className="history-bubble-position">User message {previewPosition}</div>
              ) : null}
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
