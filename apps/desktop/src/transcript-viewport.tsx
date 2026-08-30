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
 *
 * Older history loads invisibly when the user is near the top, including when
 * the current page is too short to create a scrollbar.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import type { SessionUserMessageAnchor, SessionUserMessageIndexData } from '@piwin/contracts';
import { isNearBottom, useTranscriptScroll } from './use-transcript-scroll';
import { HistoryTicksDrawer } from './history-ticks-drawer';
import { TranscriptScrollProvider } from './transcript-scroll-port';
import {
  readTranscriptScrollPosition,
  rememberTranscriptScrollPosition,
} from './transcript-scroll-memory';

/** Load the next older page when within this many px of the transcript top. */
const TRANSCRIPT_TOP_AUTO_LOAD_PX = 120;

export type TranscriptViewportProps = {
  messageCount: number;
  activitySignal: string;
  messages?: ChatMessageUi[];
  historyIndex?: SessionUserMessageIndexData | null;
  onJumpToHistoryAnchor?: (anchor: SessionUserMessageAnchor) => Promise<void> | void;
  /** A bounded anchor window is visible while the live tail stays resident. */
  historyViewActive?: boolean;
  onReturnToLatest?: () => void;
  sessionId?: string;
  canLoadOlder?: boolean;
  historyLoading?: boolean;
  onLoadOlder?: () => Promise<void>;
  locale?: 'zh-CN' | 'en';
  /** Newly submitted live turn that should restore follow-tail. */
  liveTurnId?: string | null;
  children: ReactNode;
};

export function TranscriptViewport(props: TranscriptViewportProps): ReactElement {
  const scroll = useTranscriptScroll({
    messageCount: props.messageCount,
    activitySignal: props.activitySignal,
    liveTurnId: props.liveTurnId ?? null,
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const loadInFlightRef = useRef(false);

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
    if (!container || !props.onLoadOlder || props.historyLoading || loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;
    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    try {
      await props.onLoadOlder();
      window.requestAnimationFrame(() => {
        const current = scroll.containerRef.current;
        if (!current) return;
        current.scrollTop =
          previousScrollTop + Math.max(0, current.scrollHeight - previousScrollHeight);
      });
    } finally {
      loadInFlightRef.current = false;
    }
  }, [props.historyLoading, props.onLoadOlder, scroll.containerRef]);

  const maybeAutoLoadOlder = useCallback((): void => {
    if (!props.canLoadOlder || props.historyLoading || !props.onLoadOlder) {
      return;
    }
    const container = scroll.containerRef.current;
    if (!container) {
      return;
    }
    const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const normalizedScrollTop = Math.min(container.scrollTop, maximumScrollTop);
    // Short pages have no useful manual scroll gesture. Treat them as already
    // at the top so older history remains reachable without visible controls.
    if (normalizedScrollTop <= TRANSCRIPT_TOP_AUTO_LOAD_PX) {
      void handleLoadOlder();
    }
  }, [
    handleLoadOlder,
    props.canLoadOlder,
    props.historyLoading,
    props.onLoadOlder,
    scroll.containerRef,
  ]);

  // After each successful older page (messageCount grows), continue if the
  // viewport still has not moved away from the top.
  useEffect(() => {
    maybeAutoLoadOlder();
  }, [
    maybeAutoLoadOlder,
    props.canLoadOlder,
    props.historyLoading,
    props.messageCount,
    props.sessionId,
  ]);

  const handleStreamScroll = useCallback((): void => {
    scroll.handleScroll();
    maybeAutoLoadOlder();
  }, [maybeAutoLoadOlder, scroll]);

  // const locale = props.locale ?? 'zh-CN';
  // const handleJumpToLatest = useCallback((): void => {
  //   props.onReturnToLatest?.();
  //   scroll.jumpToLatest();
  // }, [props.onReturnToLatest, scroll]);
  // const showJumpToLatest = props.historyViewActive === true || scroll.showJumpToLatest;

  return (
        <TranscriptScrollProvider
      sessionId={props.sessionId ?? null}
      scrollElementRef={scroll.containerRef}
      notifyContentGrew={scroll.notifyContentGrew}
      detachFromTail={scroll.detachFromTail}
    >
      <div className="transcript-viewport">
        <HistoryTicksDrawer
          messages={props.messages}
          historyIndex={props.historyIndex}
          onJumpToAnchor={props.onJumpToHistoryAnchor}
        />
        <div
          className="chat-stream"
          data-testid="chat-stream"
          ref={scroll.containerRef}
          style={
            {
              '--transcript-current-response-min-height': `${scroll.currentResponseMinHeight}px`,
            } as CSSProperties
          }
          onScroll={handleStreamScroll}
          role="log"
          aria-label="Conversation"
          aria-relevant="additions"
          aria-live="off"
          aria-busy={props.activitySignal.includes('streaming')}
        >
          {props.children}
        </div>
        {/*
        {showJumpToLatest ? (
          <button
            type="button"
            className="jump-to-latest-btn"
            data-testid="jump-to-latest-btn"
            onClick={handleJumpToLatest}
            aria-label={
              props.historyViewActive
                ? locale === 'zh-CN'
                  ? '返回最新消息'
                  : 'Return to latest messages'
                : locale === 'zh-CN'
                  ? '跳到最新'
                  : 'Jump to latest'
            }
          >
            {props.historyViewActive
              ? locale === 'zh-CN'
                ? '返回最新'
                : 'Back to latest'
              : locale === 'zh-CN'
                ? '跳到最新'
                : 'Jump to latest'}
          </button>
        ) : null}
        */}
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
