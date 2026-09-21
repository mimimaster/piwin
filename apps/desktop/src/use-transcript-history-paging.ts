import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessageUi } from './chat-reducer.js';
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
  onLoadOlder?: () => Promise<void>;
  onLoadNewer?: () => Promise<void>;
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
  const pendingRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const restoreAnchor = useCallback(() => {
    const container = scroll.containerRef.current;
    const pending = pendingRef.current;
    if (!container || !pending) return;
    // Key-based virtualizer anchoring handles both prepend and opposite-edge
    // eviction. A total-height delta cannot represent a sliding window.
    if (container.querySelector('.transcript-turn-window')) {
      pendingRef.current = null;
      return;
    }
    const delta = container.scrollHeight - pending.scrollHeight;
    if (delta <= 0) return;
    scroll.beginProgrammaticScroll();
    container.scrollTop = pending.scrollTop + delta;
    pendingRef.current = null;
  }, [scroll.beginProgrammaticScroll, scroll.containerRef]);

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
      if (direction === 'older')
        pendingRef.current = {
          scrollHeight: container.scrollHeight,
          scrollTop: container.scrollTop,
        };
      try {
        await load();
        restoreAnchor();
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
      scroll.containerRef,
      scroll.detachFromTail,
      restoreAnchor,
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
    if (inFlightRef.current || ignoreScrollRef.current) return;
    const direction = container.scrollTop < previousTop ? 'older' : 'newer';
    directionRef.current = direction;
    if (!scroll.isFollowingTail() || direction === 'newer') maybeLoad(direction);
  }, [maybeLoad, scroll.containerRef, scroll.isFollowingTail]);

  useEffect(() => {
    const container = scroll.containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      ignoreScrollRef.current = false;
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
    restoreAnchor();
    const container = scroll.containerRef.current;
    if (container) lastScrollTopRef.current = container.scrollTop;
  }, [pageKey, options.historyLoading, restoreAnchor, scroll.containerRef]);
  useEffect(() => {
    if (directionRef.current && !options.historyLoading) maybeLoad(directionRef.current);
  }, [pageKey, options.historyLoading, maybeLoad]);
  const resetIntent = useCallback(() => {
    directionRef.current = null;
    pendingRef.current = null;
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
