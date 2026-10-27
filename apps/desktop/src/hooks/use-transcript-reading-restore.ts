/**
 * Reading position across session switches: remember the message the reader
 * had on screen, and put them back on it when the session opens again.
 *
 * The transcript viewport remounts per session, so this runs on mount
 * (open) and in layout cleanup (leave). A remembered message that is no
 * longer resident — the reader was in a history window — is brought back by
 * a Host seek once the open's own refresh has landed (that refresh replaces
 * the history window, so seeking earlier would be undone).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  alignTranscriptReadingAnchor,
  captureTranscriptReadingAnchor,
  measureTranscriptReadingAnchorDrift,
  type TranscriptReadingAnchor,
  type TranscriptReadingAnchorRestorer,
} from '../conversation/transcript-reading-anchor.js';
import {
  rememberTranscriptScrollPosition,
  type TranscriptScrollPosition,
} from '../conversation/transcript-scroll-memory.js';
import {
  findLastUserMessageId,
  type UnseenCountMessage,
} from '../conversation/transcript-unseen-count.js';

/** Scroll-idle delay before the position is written (storage is synchronous). */
const REMEMBER_IDLE_MS = 160;
/** Frames a seek's window may take to commit after the Host request settles. */
const SEEK_SETTLE_FRAMES = 3;
/** A settled anchor is within this many px of its remembered offset. */
const ANCHOR_SETTLED_PX = 2;

type ReadingScrollControls = {
  containerRef: RefObject<HTMLDivElement | null>;
  detachFromTail: () => void;
  jumpToLatest: () => void;
  isFollowingTail: () => boolean;
  beginProgrammaticScroll: () => void;
};

export type TranscriptReadingRestoreOptions = {
  sessionId: string | null;
  /** Read once by the owner when this session's viewport mounted. */
  remembered: TranscriptScrollPosition | null;
  scroll: ReadingScrollControls;
  readingAnchorRestorerRef: MutableRefObject<TranscriptReadingAnchorRestorer | null>;
  messages: readonly UnseenCountMessage[];
  awaitingTranscript: boolean;
  historyViewActive: boolean;
  liveTurnId: string | null;
  /** Unseen-count origin owned by the viewport; null while following. */
  lastSeenMessageId: string | null;
  onSeekToMessage?: ((messageId: string) => Promise<void> | void) | undefined;
};

export type TranscriptReadingRestore = {
  /** Open at the remembered message, or the live tail when there is none. */
  openAtRememberedPosition: () => void;
  /** For the opening cover: settle on the open target; true once it is there. */
  settleOpenPosition: () => boolean;
  /** Deliberate navigation to a reading anchor, seeking it in when not resident. */
  navigateToAnchor: (anchor: TranscriptReadingAnchor) => void;
  /** A newer deliberate jump owns the viewport; drop any restore in flight. */
  cancelPending: () => void;
  captureAnchor: () => TranscriptReadingAnchor | null;
  /** Call from the scroll handler; writes the position once scrolling idles. */
  onScroll: () => void;
};

function isAtBottom(element: HTMLElement): boolean {
  const maximumTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return maximumTop - Math.max(0, Math.min(element.scrollTop, maximumTop)) <= ANCHOR_SETTLED_PX;
}

export function useTranscriptReadingRestore(
  options: TranscriptReadingRestoreOptions,
): TranscriptReadingRestore {
  const { readingAnchorRestorerRef } = options;
  const containerRef = options.scroll.containerRef;
  // `scroll` is rebuilt every render; read it through the ref so every
  // callback here stays stable (the leave cleanup must run on unmount only).
  const latestRef = useRef(options);
  latestRef.current = options;
  const openTargetRef = useRef<TranscriptReadingAnchor | null>(
    options.remembered && !options.remembered.followTail ? options.remembered.anchor : null,
  );
  /** Anchor still waiting for its message to mount (or be seeked in). */
  const pendingRef = useRef<TranscriptReadingAnchor | null>(null);
  /** Message id already asked of the Host for the pending anchor. */
  const seekedMessageIdRef = useRef<string | null>(null);
  const rememberTimerRef = useRef<number | null>(null);

  const captureAnchor = useCallback((): TranscriptReadingAnchor | null => {
    const container = containerRef.current;
    return container ? captureTranscriptReadingAnchor(container) : null;
  }, [containerRef]);

  const alignAnchor = useCallback(
    (anchor: TranscriptReadingAnchor): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      const { scroll } = latestRef.current;
      // Going to history: no follow-tail stick may pull the reader back down.
      scroll.detachFromTail();
      const restorer = readingAnchorRestorerRef.current;
      if (restorer) return restorer(anchor);
      return alignTranscriptReadingAnchor(container, anchor, {
        beforeScroll: scroll.beginProgrammaticScroll,
      });
    },
    [containerRef, readingAnchorRestorerRef],
  );

  const requestSeek = useCallback(
    (anchor: TranscriptReadingAnchor): void => {
      const { awaitingTranscript, onSeekToMessage } = latestRef.current;
      if (awaitingTranscript || seekedMessageIdRef.current === anchor.messageId) return;
      if (!onSeekToMessage) {
        pendingRef.current = null;
        return;
      }
      seekedMessageIdRef.current = anchor.messageId;
      const settleAfterSeek = (framesLeft = SEEK_SETTLE_FRAMES): void => {
        window.requestAnimationFrame(() => {
          if (pendingRef.current !== anchor) return;
          // Usually the window's commit already aligned it (layout effect).
          // Allow it a few frames to land; after that the Host had no such
          // message and this restore is over.
          if (alignAnchor(anchor) || framesLeft <= 0) {
            pendingRef.current = null;
            return;
          }
          settleAfterSeek(framesLeft - 1);
        });
      };
      void Promise.resolve()
        .then(() => onSeekToMessage(anchor.messageId))
        .then(() => settleAfterSeek(), (error: unknown) => {
          console.error('reading position seek failed', error);
          if (pendingRef.current === anchor) pendingRef.current = null;
        });
    },
    [alignAnchor],
  );

  const tryPending = useCallback((): void => {
    const anchor = pendingRef.current;
    if (!anchor) return;
    if (alignAnchor(anchor)) {
      pendingRef.current = null;
      return;
    }
    requestSeek(anchor);
  }, [alignAnchor, requestSeek]);

  const navigateToAnchor = useCallback(
    (anchor: TranscriptReadingAnchor): void => {
      pendingRef.current = anchor;
      seekedMessageIdRef.current = null;
      tryPending();
    },
    [tryPending],
  );

  const cancelPending = useCallback((): void => {
    pendingRef.current = null;
    openTargetRef.current = null;
  }, []);

  const openAtRememberedPosition = useCallback((): void => {
    const target = openTargetRef.current;
    if (target) {
      navigateToAnchor(target);
      return;
    }
    latestRef.current.scroll.jumpToLatest();
  }, [navigateToAnchor]);

  const settleOpenPosition = useCallback((): boolean => {
    const container = containerRef.current;
    const target = openTargetRef.current;
    if (!target) {
      latestRef.current.scroll.jumpToLatest();
      return container ? isAtBottom(container) : true;
    }
    if (pendingRef.current === null) {
      // Layout keeps settling under the cover; re-align every sample.
      if (!alignAnchor(target)) navigateToAnchor(target);
    } else {
      tryPending();
    }
    if (!container) return false;
    const drift = measureTranscriptReadingAnchorDrift(container, target);
    return drift !== null && Math.abs(drift) <= ANCHOR_SETTLED_PX;
  }, [alignAnchor, containerRef, navigateToAnchor, tryPending]);

  // Each commit may have mounted the pending message (first page, seek window).
  useLayoutEffect(() => {
    tryPending();
  }, [options.messages, options.awaitingTranscript, options.historyViewActive, tryPending]);

  // A reader who scrolls, clicks or types while a restore is pending has
  // taken the viewport; landing them somewhere else afterwards would yank it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const takeOver = (): void => {
      pendingRef.current = null;
      openTargetRef.current = null;
    };
    const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const type of events) container.addEventListener(type, takeOver, { passive: true });
    return () => {
      for (const type of events) container.removeEventListener(type, takeOver);
    };
  }, [containerRef]);

  const remember = useCallback((): void => {
    const current = latestRef.current;
    if (!current.sessionId) return;
    const followTail = current.scroll.isFollowingTail();
    // Not there yet (seek in flight): the destination is still where they are.
    const anchor = followTail ? null : (pendingRef.current ?? captureAnchor());
    if (!followTail && anchor === null) return;
    const lastMessageId = current.messages.at(-1)?.id ?? null;
    rememberTranscriptScrollPosition(current.sessionId, {
      followTail,
      anchor,
      lastSeenMessageId: followTail ? lastMessageId : (current.lastSeenMessageId ?? lastMessageId),
      lastUserMessageId: current.liveTurnId ?? findLastUserMessageId(current.messages),
    });
  }, [captureAnchor]);

  const onScroll = useCallback((): void => {
    if (rememberTimerRef.current !== null) window.clearTimeout(rememberTimerRef.current);
    rememberTimerRef.current = window.setTimeout(() => {
      rememberTimerRef.current = null;
      remember();
    }, REMEMBER_IDLE_MS);
  }, [remember]);

  // Leaving the session: layout cleanup still sees the mounted rows.
  useLayoutEffect(
    () => () => {
      if (rememberTimerRef.current !== null) {
        window.clearTimeout(rememberTimerRef.current);
        rememberTimerRef.current = null;
      }
      remember();
    },
    [remember],
  );

  return {
    openAtRememberedPosition,
    settleOpenPosition,
    navigateToAnchor,
    cancelPending,
    captureAnchor,
    onScroll,
  };
}
