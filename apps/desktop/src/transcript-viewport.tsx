/**
 * Scrollable transcript container with jump-to-latest affordance.
 * Quiet workbench: no right-edge message mini-nav rail (outline deferred).
 * A custom floating scrollbar overlays the content so it never takes layout
 * space, keeping the centered --chat-max column aligned with the composer dock.
 */
import type { ReactElement, ReactNode } from 'react';
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

  // Floating scrollbar geometry: thumb height = ratio * track height,
  // thumb top = progress * (track height - thumb height).
  const thumbHeightPct = Math.max(8, scroll.scrollRatio * 100);
  const thumbTopPct = scroll.scrollProgress * (100 - thumbHeightPct);
  const showFloatingScrollbar = scroll.scrollRatio < 1;

  return (
    <div className="transcript-viewport">
      <HistoryTicksDrawer messages={props.messages} />
      <div
        className="chat-stream"
        data-testid="chat-stream"
        ref={scroll.containerRef}
        onScroll={() => {
          scroll.handleScroll();
        }}
        role="log"
        aria-label="Conversation"
        aria-relevant="additions"
        // Token deltas must not be announced. Context bar provides the
        // concise phase/permission/terminal announcements instead.
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
        >
          <div
            className="chat-stream-floating-scrollbar-thumb"
            style={{
              height: `${thumbHeightPct}%`,
              transform: `translateY(${thumbTopPct}%)`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
