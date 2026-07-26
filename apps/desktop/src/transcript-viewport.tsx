/**
 * Scrollable transcript container with jump-to-latest affordance.
 * Quiet workbench: no right-edge message mini-nav rail (outline deferred).
 */
import type { ReactElement, ReactNode } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { useTranscriptScroll } from './use-transcript-scroll';

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

  return (
    <div className="transcript-viewport">
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
            aria-label={
              scroll.unreadActivityCount > 0
                ? `Jump to latest, ${scroll.unreadActivityCount} unread activities`
                : 'Jump to latest'
            }
          >
            Jump to latest
            {scroll.unreadActivityCount > 0
              ? ` (${scroll.unreadActivityCount})`
              : ''}
          </button>
        ) : null}
      </div>
    </div>
  );
}
