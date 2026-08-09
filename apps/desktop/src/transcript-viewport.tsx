/**
 * Transcript shell + scrollport with jump-to-latest and floating chrome.
 *
 * Architecture (single source of truth):
 * - `.transcript-viewport` is a non-scrolling relative shell.
 * - `.chat-stream` is the only overflow-y scroll container (native scrollbar
 *   hidden) so its content width matches `.composer-dock` with no gutter.
 * - History ticks + floating scrollbar are absolute children of the shell,
 *   never of the scrollport, so they stay pinned while content scrolls.
 * - Bottom fade mask lives on `.chat-stream` only — never on chrome.
 *
 * Scroll metrics come from `useTranscriptScroll` (ResizeObserver + activity),
 * not mount/unmount of the floating track.
 */
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { Button } from '@piwin/ui-kit';
import type { ChatMessageUi } from './chat-reducer';
import { isNearBottom, useTranscriptScroll } from './use-transcript-scroll';
import { HistoryTicksDrawer } from './history-ticks-drawer';
import { TranscriptScrollProvider } from './transcript-scroll-port';
import {
  readTranscriptScrollPosition,
  rememberTranscriptScrollPosition,
} from './transcript-scroll-memory';

export type TranscriptViewportProps = {
  messageCount: number;
  activitySignal: string;
  messages?: ChatMessageUi[];
  sessionId?: string;
  canLoadOlder?: boolean;
  historyLoading?: boolean;
  historyCacheLimitReached?: boolean;
  onLoadOlder?: () => Promise<void>;
  children: ReactNode;
};

export function TranscriptViewport(props: TranscriptViewportProps): ReactElement {
  const scroll = useTranscriptScroll({
    messageCount: props.messageCount,
    activitySignal: props.activitySignal,
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useLayoutEffect(() => {
    const sessionId = props.sessionId;
    if (!sessionId) {
      return;
    }
    const rememberedPosition = readTranscriptScrollPosition(sessionId);
    if (rememberedPosition) {
      scroll.restorePosition(rememberedPosition);
    }
    const scrollElementRef = scroll.containerRef;
    return () => {
      const element = scrollElementRef.current;
      if (!element) {
        return;
      }
      rememberTranscriptScrollPosition(sessionId, {
        scrollTop: element.scrollTop,
        followTail: isNearBottom(element),
      });
    };
  }, [props.sessionId, scroll.containerRef, scroll.restorePosition]);

  // Floating scrollbar geometry: thumb height = ratio * track height,
  // thumb top = progress * (track height - thumb height).
  const thumbHeightPct = Math.max(8, scroll.scrollRatio * 100);
  const thumbTopPct = scroll.scrollProgress * (100 - thumbHeightPct);

  /** Given a Y coordinate within the track, scroll the stream to that position. */
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

  const handleTrackMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target !== trackRef.current) return;
      event.preventDefault();
      scrollToTrackY(event.clientY);
    },
    [scrollToTrackY],
  );

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

  const handleLoadOlder = useCallback(async (): Promise<void> => {
    const container = scroll.containerRef.current;
    if (!container || !props.onLoadOlder || props.historyLoading) return;
    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    await props.onLoadOlder();
    window.requestAnimationFrame(() => {
      const current = scroll.containerRef.current;
      if (!current) return;
      current.scrollTop =
        previousScrollTop + Math.max(0, current.scrollHeight - previousScrollHeight);
    });
  }, [props.historyLoading, props.onLoadOlder, scroll.containerRef]);

  return (
    <TranscriptScrollProvider
      sessionId={props.sessionId ?? null}
      scrollElementRef={scroll.containerRef}
    >
      <div className="transcript-viewport">
        <HistoryTicksDrawer messages={props.messages} />
        <div
          className="chat-stream"
          data-testid="chat-stream"
          ref={scroll.containerRef}
          onScroll={scroll.handleScroll}
          role="log"
          aria-label="Conversation"
          aria-relevant="additions"
          aria-live="off"
          aria-busy={props.activitySignal.includes('streaming')}
        >
          {props.canLoadOlder || props.historyCacheLimitReached ? (
            <div
              className="transcript-history-page-control"
              data-testid="transcript-history-page-control"
            >
              {props.canLoadOlder ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={props.historyLoading === true}
                  data-testid="transcript-load-older"
                  onClick={() => void handleLoadOlder()}
                >
                  {props.historyLoading ? 'Loading earlier messages…' : 'Load earlier messages'}
                </Button>
              ) : (
                <span className="muted" data-testid="transcript-cache-limit">
                  History window limit reached — export the session for the complete transcript.
                </span>
              )}
            </div>
          ) : null}
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
        {/* Always mounted: visibility via isOverflowing avoids mount thrash. */}
        <div
          className={
            scroll.isOverflowing
              ? 'chat-stream-floating-scrollbar is-visible'
              : 'chat-stream-floating-scrollbar'
          }
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
      </div>
    </TranscriptScrollProvider>
  );
}
