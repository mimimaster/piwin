/**
 * Scrollable transcript container with jump-to-latest affordance.
 * Quiet workbench: no right-edge message mini-nav rail (outline deferred).
 *
 * Architecture: `.transcript-viewport` is the scroll container (overflow-y).
 * `.chat-stream` inside it is a plain block — no overflow of its own — so its
 * padding/centering matches `.composer-dock` exactly (same available width,
 * no scrollbar gutter interference).
 *
 * The floating scrollbar is positioned absolutely inside `.transcript-viewport`
 * and doesn't scroll with content because it is a sibling of `.chat-stream`,
 * not a child. Since `.transcript-viewport` itself is the scroll container,
 * `position: absolute` children are positioned relative to the viewport's
 * border box and stay fixed while content scrolls.
 *
 * IMPORTANT: The scroll ref must point to `.transcript-viewport` (the actual
 * overflow container), not `.chat-stream`.
 */
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useRef } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { useTranscriptScroll } from './use-transcript-scroll';
import { HistoryTicksDrawer } from './history-ticks-drawer';

export type TranscriptViewportProps = {
  messageCount: number;
  activitySignal: string;
  messages?: ChatMessageUi[];
  children: ReactNode;
};

export function TranscriptViewport(props: TranscriptViewportProps): ReactElement {
  const scroll = useTranscriptScroll({
    messageCount: props.messageCount,
    activitySignal: props.activitySignal,
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Floating scrollbar geometry: thumb height = ratio * track height,
  // thumb top = progress * (track height - thumb height).
  const thumbHeightPct = Math.max(8, scroll.scrollRatio * 100);
  // `top` percentage is relative to the containing block (the track), so
  // this correctly positions the thumb within the full track height.
  const thumbTopPct = scroll.scrollProgress * (100 - thumbHeightPct);
  const showFloatingScrollbar = scroll.scrollRatio < 1;

  /** Given a Y coordinate within the track, scroll the viewport to the
   *  corresponding position. */
  const scrollToTrackY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      const container = scroll.containerRef.current;
      if (!track || !container) return;

      const rect = track.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      const maxScroll = container.scrollHeight - container.clientHeight;
      container.scrollTop = fraction * maxScroll;
    },
    [scroll.containerRef],
  );

  /** Click on the track (not thumb): jump to that position. */
  const handleTrackMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target !== trackRef.current) return;
      event.preventDefault();
      scrollToTrackY(event.clientY);
    },
    [scrollToTrackY],
  );

  /** Mousedown on thumb: start drag. */
  const handleThumbMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = true;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) return;
        scrollToTrackY(moveEvent.clientY);
      };
      const handleMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [scrollToTrackY],
  );

  return (
    <div
      className="transcript-viewport"
      ref={scroll.containerRef}
      onScroll={() => {
        scroll.handleScroll();
      }}
    >
      <HistoryTicksDrawer messages={props.messages} />
      <div
        className="chat-stream"
        data-testid="chat-stream"
        role="log"
        aria-label="Conversation"
        aria-relevant="additions"
        aria-live="off"
        aria-busy={props.activitySignal.includes('streaming')}
      >
        {props.children}
        {scroll.showJumpToLatest ? (
          <button
            type="button"
            className="jump-to-latest-btn"
            data-testid="jump-to-latest-btn"
            onClick={scroll.jumpToLatest}
            aria-label="Jump to latest"
          >
            Jump to latest
          </button>
        ) : null}
      </div>
      {showFloatingScrollbar ? (
        <div
          className="chat-stream-floating-scrollbar"
          data-testid="chat-stream-floating-scrollbar"
          aria-hidden="true"
          ref={trackRef}
          onMouseDown={handleTrackMouseDown}
        >
          <div
            className="chat-stream-floating-scrollbar-thumb"
            style={{
              height: `${thumbHeightPct}%`,
              top: `${thumbTopPct}%`,
            }}
            onMouseDown={handleThumbMouseDown}
          />
        </div>
      ) : null}
    </div>
  );
}
