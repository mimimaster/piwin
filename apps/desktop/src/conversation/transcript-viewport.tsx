/**
 * Transcript shell + scrollport with jump-to-latest and floating chrome.
 *
 * Architecture (single source of truth):
 * - `.transcript-viewport` is a non-scrolling relative shell.
 * - `.chat-stream` is the only overflow-y scroll container (native scrollbar
 *   hidden) so its content width matches `.composer-dock` with no gutter.
 * - History ticks + floating scrollbar are absolute children of the shell,
 *   never of the scrollport, so they stay pinned while content scrolls.
 * - Edge fades are pointer-transparent overlays on `.transcript-viewport`;
 *   the translucent window material masks `.chat-stream` instead
 *   (styles/window-material.css). The bottom edge also gets a progressive
 *   blur strip (styles/transcript-edge-blur.css).
 *
 * Scroll metrics come from `useTranscriptScroll` (ResizeObserver + activity),
 * not mount/unmount of the floating track. The track places the resident
 * window among all session turns (TranscriptTurnScrollbar).
 *
 * Older history prepends invisibly near the top, or on wheel-up when the
 * latest page fits and therefore cannot emit a scroll-away. Follow-tail
 * opens do not auto-page on mount.
 *
 * Reopening a session lands on the message the reader left on (see
 * useTranscriptReadingRestore); a reader who left at the tail reopens there.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import type { SessionUserMessageAnchor, SessionUserMessageIndexData } from '@piwin/contracts';
import { useTranscriptScroll } from '../hooks/use-transcript-scroll';
import { HistoryTicksDrawer } from '../session/history-ticks-drawer';
import { TranscriptScrollProvider } from './transcript-scroll-port';
import { useTranscriptReveal } from '../hooks/use-transcript-reveal.js';
import { useTranscriptHistoryPaging } from '../hooks/use-transcript-history-paging.js';
import type { TranscriptReadingAnchorRestorer } from './transcript-reading-anchor.js';
import { JUMP_TO_LATEST_BUTTON_ICON_PX, JumpToLatestButton } from './jump-to-latest-button';
import { TranscriptFoldRail } from './transcript-fold-rail';
import { readTranscriptScrollPosition } from './transcript-scroll-memory.js';
import { useTranscriptReadingRestore } from '../hooks/use-transcript-reading-restore.js';
import { useTranscriptUnseenCount } from '../hooks/use-transcript-unseen-count.js';
import { useTranscriptReturnPoint } from '../hooks/use-transcript-return-point.js';
import { IconBack } from '../tool-cards/shell-icons';
import { TranscriptTurnScrollbar } from './transcript-turn-scrollbar';
import { countIndexedUserMessages } from './indexed-user-message.js';
import { resolveResidentTurnSpan } from './transcript-turn-scale.js';
import '../styles/transcript-opening.css';
import '../styles/transcript-jump-controls.css';

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
  awaitingTranscript?: boolean;
  canLoadOlder?: boolean;
  canLoadNewer?: boolean;
  /** The history view shows every row Host has and ends inside the live tail. */
  historyCaughtUp?: boolean;
  historyLoading?: boolean;
  onLoadOlder?: (keepMessageId?: string) => Promise<void>;
  onLoadNewer?: (keepMessageId?: string) => Promise<void>;
  /** Turn ordinal of the history view's first row (Host page ordinal); places it in the session. */
  historyTurnStart?: number | undefined;
  /** Bring a non-resident message in (Host transcript window) to restore a reading position. */
  onSeekToMessage?: (messageId: string) => Promise<void> | void;
  locale?: 'zh-CN' | 'en';
  /** Newly submitted live turn that should restore follow-tail. */
  liveTurnId?: string | null;
  children: ReactNode;
};

const NO_MESSAGES: readonly ChatMessageUi[] = [];

export function TranscriptViewport(props: TranscriptViewportProps): ReactElement {
  const handleLoadOlderRef = useRef<() => void>(() => {});
  // Read once: the viewport remounts per session (keyed by its owner).
  const [remembered] = useState(() =>
    props.sessionId ? readTranscriptScrollPosition(props.sessionId) : null,
  );
  // Coming back to a reader who left mid-run: the turn that was already
  // running is not a new send and must not pull them down to the tail.
  const suppressedLiveTurnId =
    remembered && !remembered.followTail ? remembered.lastUserMessageId : null;
  const liveTurnId =
    props.liveTurnId && props.liveTurnId !== suppressedLiveTurnId ? props.liveTurnId : null;
  const messages = props.messages ?? NO_MESSAGES;
  const scroll = useTranscriptScroll({
    messageCount: props.messageCount,
    activitySignal: props.activitySignal,
    liveTurnId,
    historyViewActive: props.historyViewActive === true,
    canLoadOlder: props.canLoadOlder === true,
    onUnscrollableHistoryIntent: () => {
      handleLoadOlderRef.current();
    },
  });
  const readingAnchorRestorerRef = useRef<TranscriptReadingAnchorRestorer | null>(null);
  const { lastSeenMessageId, unseenCount } = useTranscriptUnseenCount({
    initialLastSeenMessageId:
      remembered && !remembered.followTail ? remembered.lastSeenMessageId : null,
    followTail: scroll.followTail,
    messages,
    historyViewActive: props.historyViewActive === true,
  });
  const reading = useTranscriptReadingRestore({
    sessionId: props.sessionId ?? null,
    remembered,
    scroll,
    readingAnchorRestorerRef,
    messages,
    awaitingTranscript: props.awaitingTranscript === true,
    historyViewActive: props.historyViewActive === true,
    liveTurnId,
    lastSeenMessageId,
    onSeekToMessage: props.onSeekToMessage,
  });
  const opening = useTranscriptReveal({
    ...(props.sessionId ? { sessionId: props.sessionId } : {}),
    messageCount: props.messageCount,
    awaitingTranscript: props.awaitingTranscript === true,
    historyViewActive: props.historyViewActive === true,
    scrollElementRef: scroll.containerRef,
    jumpToLatest: scroll.jumpToLatest,
    settlePosition: reading.settleOpenPosition,
  });

  const returnToLive = useCallback((): void => {
    props.onReturnToLatest?.();
    scroll.jumpToLatest();
  }, [props.onReturnToLatest, scroll.jumpToLatest]);
  const paging = useTranscriptHistoryPaging({
    ...props,
    scroll,
    readingAnchorRestorerRef,
    onReturnToLive: returnToLive,
  });
  handleLoadOlderRef.current = paging.loadOlder;
  const { returnPoint, markJumpOrigin, returnToPoint } = useTranscriptReturnPoint({
    reading,
    isFollowingTail: scroll.isFollowingTail,
    liveTurnId,
    resetPagingIntent: paging.resetIntent,
  });
  const openedSessionPinRef = useRef<{ sessionId: string; pinned: boolean } | null>(null);

  useLayoutEffect(() => {
    if (props.historyViewActive) {
      scroll.detachFromTail();
      return;
    }
    // Opening a session lands where the reader left it: the remembered
    // message, or the live tail when they left there (or never read it).
    if (!props.sessionId) {
      return;
    }
    const previous = openedSessionPinRef.current;
    if (previous?.sessionId !== props.sessionId) {
      openedSessionPinRef.current = {
        sessionId: props.sessionId,
        pinned: props.messageCount > 0,
      };
      reading.openAtRememberedPosition();
      return;
    }
    // Cold resume paints an empty placeholder first. Re-pin once the first
    // page arrives, otherwise the virtualizer stays on the estimated bottom
    // of a short list — the middle of the real transcript.
    if (!previous.pinned && props.messageCount > 0) {
      openedSessionPinRef.current = { sessionId: props.sessionId, pinned: true };
      reading.openAtRememberedPosition();
    }
  }, [
    props.historyViewActive,
    props.messageCount,
    props.sessionId,
    reading.openAtRememberedPosition,
    scroll.detachFromTail,
  ]);

  const handleStreamScroll = useCallback((): void => {
    scroll.handleScroll();
    paging.onScroll();
    reading.onScroll();
  }, [paging.onScroll, reading.onScroll, scroll]);

  const locale = props.locale ?? 'zh-CN';
  const residentUserMessages = useMemo(() => countIndexedUserMessages(messages), [messages]);
  const turnSpan = resolveResidentTurnSpan({
    totalUserMessages: props.historyIndex?.totalUserMessages ?? null,
    residentUserMessages,
    historyFirstOrdinal: props.historyTurnStart,
    historyViewActive: props.historyViewActive === true,
  });
  const handleJumpToHistoryAnchor = useCallback(async (anchor: SessionUserMessageAnchor) => {
    paging.resetIntent();
    await props.onJumpToHistoryAnchor?.(anchor);
  }, [paging.resetIntent, props.onJumpToHistoryAnchor]);
  const handleJumpToLatest = useCallback((): void => {
    markJumpOrigin();
    paging.resetIntent();
    returnToLive();
  }, [markJumpOrigin, paging.resetIntent, returnToLive]);
  const showJumpToLatest =
    props.messageCount > 0 &&
    (props.historyViewActive === true || scroll.showJumpToLatest);
  const baseJumpToLatestLabel = props.historyViewActive
    ? locale === 'zh-CN'
      ? '返回最新消息'
      : 'Return to latest messages'
    : locale === 'zh-CN'
      ? '跳到最新'
      : 'Jump to latest';
  const jumpToLatestLabel =
    unseenCount === 0
      ? baseJumpToLatestLabel
      : locale === 'zh-CN'
        ? `${baseJumpToLatestLabel}（${unseenCount} 条新消息）`
        : `${baseJumpToLatestLabel} (${unseenCount} new)`;
  const returnPointLabel = locale === 'zh-CN' ? '返回刚才位置' : 'Back to where you were';
  const showReturnPoint = returnPoint !== null && props.messageCount > 0;

  return (
        <TranscriptScrollProvider
      sessionId={props.sessionId ?? null}
      scrollElementRef={scroll.containerRef}
      notifyContentGrew={scroll.notifyContentGrew}
      detachFromTail={scroll.detachFromTail}
      isFollowingTail={scroll.isFollowingTail}
      beginProgrammaticScroll={scroll.beginProgrammaticScroll}
      beginLocalFoldLayout={scroll.beginLocalFoldLayout}
      markJumpOrigin={markJumpOrigin}
      readingAnchorRestorerRef={readingAnchorRestorerRef}
    >
      <div className={`transcript-viewport${opening ? ' is-opening' : ''}`}>
        {opening || (props.awaitingTranscript && props.messageCount === 0 && !props.historyViewActive) ? (
          <div className="transcript-opening-state" data-testid="transcript-opening-state" role="status">
            <div className="transcript-opening-container">
              <div className="transcript-opening-banner">
                <span aria-hidden="true" className="transcript-opening-spinner" />
                <span data-testid={props.awaitingTranscript ? 'transcript-awaiting-banner' : undefined}>
                  {locale === 'zh-CN' ? '正在打开会话…' : 'Opening conversation…'}
                </span>
              </div>
              <div className="transcript-opening-skeleton" aria-hidden="true">
                <div className="transcript-skeleton-turn is-user">
                  <div className="transcript-skeleton-body">
                    <div className="transcript-skeleton-bar w-80 ml-auto" />
                    <div className="transcript-skeleton-bar w-60 ml-auto" />
                  </div>
                  <div className="transcript-skeleton-avatar is-user" />
                </div>
                <div className="transcript-skeleton-turn is-assistant">
                  <div className="transcript-skeleton-avatar is-assistant" />
                  <div className="transcript-skeleton-body">
                    <div className="transcript-skeleton-card">
                      <div className="transcript-skeleton-tool-header">
                        <span className="transcript-skeleton-tool-dot" />
                        <div className="transcript-skeleton-bar w-40" />
                      </div>
                      <div className="transcript-skeleton-bar w-100" />
                      <div className="transcript-skeleton-bar w-80" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <HistoryTicksDrawer
          messages={props.messages}
          historyIndex={props.historyIndex}
          onJumpToAnchor={handleJumpToHistoryAnchor}
          locale={locale}
        />
        <TranscriptFoldRail
          scrollElementRef={scroll.containerRef}
          beginProgrammaticScroll={scroll.beginProgrammaticScroll}
          locale={locale}
        />
        <div
          className="chat-stream"
          data-testid="chat-stream"
          data-artifact-layout-root="main"
          data-artifact-layout-session={props.sessionId}
          ref={scroll.containerRef}
          aria-hidden={opening}
          inert={opening}
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
          aria-busy={opening || props.activitySignal.includes('streaming')}
        >
          {props.children}
        </div>
        <div className="transcript-edge-blur" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {showJumpToLatest ? (
          <JumpToLatestButton
            label={jumpToLatestLabel}
            onClick={handleJumpToLatest}
            badgeCount={unseenCount}
          />
        ) : null}
        {showReturnPoint ? (
          <JumpToLatestButton
            label={returnPointLabel}
            onClick={returnToPoint}
            testId="transcript-return-point-btn"
            className={
              showJumpToLatest ? 'transcript-return-point-btn is-stacked' : 'transcript-return-point-btn'
            }
            icon={
              <IconBack width={JUMP_TO_LATEST_BUTTON_ICON_PX} height={JUMP_TO_LATEST_BUTTON_ICON_PX} />
            }
          />
        ) : null}
        {/* Always mounted: visibility via isOverflowing avoids mount thrash. */}
        <TranscriptTurnScrollbar
          isOverflowing={scroll.isOverflowing}
          scrollRatio={scroll.scrollRatio}
          scrollProgress={scroll.scrollProgress}
          span={turnSpan}
          historyIndex={props.historyIndex ?? null}
          onJumpToAnchor={handleJumpToHistoryAnchor}
          locale={locale}
        />
      </div>
    </TranscriptScrollProvider>
  );
}
