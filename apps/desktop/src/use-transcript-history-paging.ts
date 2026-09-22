import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { ChatMessageUi } from './chat-reducer.js';
import {
  alignTranscriptReadingAnchor,
  captureTranscriptReadingAnchor,
  type TranscriptReadingAnchor,
  type TranscriptReadingAnchorRestorer,
} from './transcript-reading-anchor.js';
import type { useTranscriptScroll } from './use-transcript-scroll.js';

const EDGE_LOAD_PX = 120;
type Direction = 'older' | 'newer';
type PagingOptions = {
  scroll: ReturnType<typeof useTranscriptScroll>;
  sessionId?: string;
  messageCount: number;
  messages?: ChatMessageUi[];
  canLoadOlder?: boolean;
  canLoadNewer?: boolean;
  historyLoading?: boolean;
  onLoadOlder?: (keepMessageId?: string) => Promise<void>;
  onLoadNewer?: (keepMessageId?: string) => Promise<void>;
  /** Set by the virtualized list; restores an anchor whose row may be unmounted. */
  readingAnchorRestorerRef?: MutableRefObject<TranscriptReadingAnchorRestorer | null>;
};

/** Page in response to scroll intent; never walk the whole history on mount. */
export function useTranscriptHistoryPaging(options: PagingOptions) {
  const { scroll } = options;
  const pageKey = `${options.sessionId}:${options.messages?.[0]?.id}:${options.messages?.at(-1)?.id}:${options.messageCount}`;
  const lastRequestRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const ignoreScrollRef = useRef(false);
  const directionRef = useRef<Direction | null>(null);
  const lastScrollTopRef = useRef(0);
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;
  const restorerRef = options.readingAnchorRestorerRef;
  /**
   * Where the reader is, refreshed on every scroll and after every commit, so
   * it always describes the view just before the next window change —
   * whenever that commit lands and however far the wheel moved meanwhile. A
   * one-shot capture at request time raced the commit and went stale.
   */
  const readingRef = useRef<{ anchor: TranscriptReadingAnchor; pageKey: string } | null>(null);
  /** A deliberate jump (history tick, return to latest) owns the next window change. */
  const skipNextRestoreRef = useRef(false);

  const recordReading = useCallback(() => {
    const container = scroll.containerRef.current;
    if (!container) return;
    const anchor = captureTranscriptReadingAnchor(container);
    readingRef.current = anchor ? { anchor, pageKey: pageKeyRef.current } : null;
  }, [scroll.containerRef]);

  // A page prepends above the reader or evicts the far edge; either way the
  // message they were reading stays put. Row-keyed virtualizer anchoring
  // cannot do this when one turn spans pages (see transcript-reading-anchor.ts):
  // it let every older page strand the viewport at the top edge and cascade
  // to the session start.
  const restoreReading = useCallback(() => {
    const container = scroll.containerRef.current;
    const reading = readingRef.current;
    if (skipNextRestoreRef.current) {
      skipNextRestoreRef.current = false;
      return;
    }
    (window as any).__alog?.push({ t: Math.round(performance.now()), ev: 'restore?', reading: reading ? `${reading.anchor.messageId}@${Math.round(reading.anchor.offset)}` : null, same: reading?.pageKey === pageKeyRef.current, follow: scroll.isFollowingTail(), top: container?.scrollTop });
    if (!container || !reading || reading.pageKey === pageKeyRef.current) return;
    if (scroll.isFollowingTail()) return;
    const restorer = restorerRef?.current;
    if (restorer) {
      const ok = restorer(reading.anchor);
      (window as any).__alog?.push({ t: Math.round(performance.now()), ev: 'restored', ok, top: container.scrollTop, mounted: Boolean(document.getElementById('msg-' + reading.anchor.messageId)) });
      return;
    }
    alignTranscriptReadingAnchor(container, reading.anchor, {
      beforeScroll: scroll.beginProgrammaticScroll,
    });
  }, [restorerRef, scroll.beginProgrammaticScroll, scroll.containerRef, scroll.isFollowingTail]);

  const loadPage = useCallback(
    async (direction: Direction) => {
      const container = scroll.containerRef.current;
      const canLoad = direction === 'older' ? options.canLoadOlder : options.canLoadNewer;
      const load = direction === 'older' ? options.onLoadOlder : options.onLoadNewer;
      if (!container || !canLoad || !load || options.historyLoading || inFlightRef.current) return;
      const requestKey = `${direction}:${pageKey}`;
      if (lastRequestRef.current === requestKey) return;
      lastRequestRef.current = requestKey;
      inFlightRef.current = true;
      scroll.detachFromTail();
      recordReading();
      try {
        await load(readingRef.current?.anchor.messageId);
      } catch (error) {
        console.error('Transcript history page failed', error);
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      options.canLoadOlder,
      options.canLoadNewer,
      options.onLoadOlder,
      options.onLoadNewer,
      options.historyLoading,
      pageKey,
      recordReading,
      scroll.containerRef,
      scroll.detachFromTail,
    ],
  );

  const maybeLoad = useCallback(
    (direction: Direction) => {
      const container = scroll.containerRef.current;
      if (!container) return;
      const maximumTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const top = Math.max(0, Math.min(container.scrollTop, maximumTop));
      if ((direction === 'older' ? top : maximumTop - top) <= EDGE_LOAD_PX)
        void loadPage(direction);
    },
    [loadPage, scroll.containerRef],
  );

  const onScroll = useCallback(() => {
    const container = scroll.containerRef.current;
    if (!container) return;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = container.scrollTop;
    if (!scroll.isFollowingTail()) recordReading();
    if (inFlightRef.current || ignoreScrollRef.current) return;
    const direction = container.scrollTop < previousTop ? 'older' : 'newer';
    directionRef.current = direction;
    if (!scroll.isFollowingTail() || direction === 'newer') maybeLoad(direction);
  }, [maybeLoad, recordReading, scroll.containerRef, scroll.isFollowingTail]);

  useEffect(() => {
    const container = scroll.containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      ignoreScrollRef.current = false;
      skipNextRestoreRef.current = false;
      const direction = event.deltaY < 0 ? 'older' : 'newer';
      directionRef.current = direction;
      if (!inFlightRef.current) lastRequestRef.current = null;
      maybeLoad(direction);
    };
    const onManualScroll = () => {
      ignoreScrollRef.current = false;
    };
    const shell = container.parentElement;
    container.addEventListener('wheel', onWheel, { passive: true });
    shell?.addEventListener('pointerdown', onManualScroll);
    shell?.addEventListener('keydown', onManualScroll);
    return () => {
      container.removeEventListener('wheel', onWheel);
      shell?.removeEventListener('pointerdown', onManualScroll);
      shell?.removeEventListener('keydown', onManualScroll);
    };
  }, [maybeLoad, scroll.containerRef]);

  useLayoutEffect(() => {
    restoreReading();
    recordReading();
    const container = scroll.containerRef.current;
    if (container) lastScrollTopRef.current = container.scrollTop;
  }, [pageKey, recordReading, restoreReading, scroll.containerRef]);
  useEffect(() => {
    if (directionRef.current && !options.historyLoading) maybeLoad(directionRef.current);
  }, [pageKey, options.historyLoading, maybeLoad]);
  const resetIntent = useCallback(() => {
    directionRef.current = null;
    skipNextRestoreRef.current = true;
    lastRequestRef.current = null;
    ignoreScrollRef.current = true;
  }, []);
  return {
    onScroll,
    resetIntent,
    loadOlder: () => {
      void loadPage('older');
    },
  };
}
