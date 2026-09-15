import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

export type TranscriptMessageScroller = (messageId: string) => boolean;

export type TranscriptScrollPort = {
  sessionId: string | null;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  /** Reactive mount notification; a ref assignment alone does not rerender consumers. */
  scrollElement: HTMLDivElement | null;
  registerMessageScroller: (scroller: TranscriptMessageScroller) => () => void;
  scrollToMessage: TranscriptMessageScroller;
  /** True while the viewport is pinned to the live tail. */
  isFollowingTail: () => boolean;
  /** Stop follow-tail before a history jump so ResizeObserver sticks cannot yank back. */
  detachFromTail: () => void;
  /** Mark the next scroll event as layout-owned (virtualizer size compensation). */
  beginProgrammaticScroll: () => void;
  /**
   * Nested content grew (e.g. Artifact iframe height bridge). Re-stick to the
   * live tail when follow-tail is active — without waiting for App-level
   * activitySignal re-renders.
   */
  notifyContentGrew: () => void;
  /**
   * User opened or closed a local fold. Skip follow-tail sticks for the same
   * two-frame window that pin-to-end uses, so remasure cannot yank the
   * viewport off the row they just clicked.
   */
  beginLocalFoldLayout: () => void;
};

const TranscriptScrollContext = createContext<TranscriptScrollPort | null>(null);

export function TranscriptScrollProvider(props: {
  sessionId: string | null;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  /** Optional stick callback from useTranscriptScroll. */
  notifyContentGrew?: () => void;
  detachFromTail?: () => void;
  isFollowingTail?: () => boolean;
  beginProgrammaticScroll?: () => void;
  beginLocalFoldLayout?: () => void;
  children: ReactNode;
}): ReactElement {
  const [scrollElement, setScrollElement] = useState(props.scrollElementRef.current);
  useLayoutEffect(() => {
    // The scroll root's ref attaches after its children's layout effects.
    // Publish it before paint so a cold-mounted virtualizer can subscribe and
    // measure without relying on a later resize, activity update, or timer.
    setScrollElement(props.scrollElementRef.current);
  }, [props.scrollElementRef]);
  const messageScrollerRef = useRef<TranscriptMessageScroller | null>(null);
  const notifyContentGrewRef = useRef(props.notifyContentGrew);
  notifyContentGrewRef.current = props.notifyContentGrew;
  const detachFromTailRef = useRef(props.detachFromTail);
  detachFromTailRef.current = props.detachFromTail;
  const isFollowingTailRef = useRef(props.isFollowingTail);
  isFollowingTailRef.current = props.isFollowingTail;
  const beginProgrammaticScrollRef = useRef(props.beginProgrammaticScroll);
  beginProgrammaticScrollRef.current = props.beginProgrammaticScroll;
  const beginLocalFoldLayoutRef = useRef(props.beginLocalFoldLayout);
  beginLocalFoldLayoutRef.current = props.beginLocalFoldLayout;

  const registerMessageScroller = useCallback((scroller: TranscriptMessageScroller) => {
    messageScrollerRef.current = scroller;
    return () => {
      if (messageScrollerRef.current === scroller) {
        messageScrollerRef.current = null;
      }
    };
  }, []);

  const detachFromTail = useCallback((): void => {
    detachFromTailRef.current?.();
  }, []);

  const isFollowingTail = useCallback((): boolean => {
    return isFollowingTailRef.current?.() ?? true;
  }, []);

  const beginProgrammaticScroll = useCallback((): void => {
    beginProgrammaticScrollRef.current?.();
  }, []);

  const beginLocalFoldLayout = useCallback((): void => {
    beginLocalFoldLayoutRef.current?.();
  }, []);

  const scrollToMessage = useCallback((messageId: string): boolean => {
    detachFromTailRef.current?.();
    return messageScrollerRef.current?.(messageId) ?? false;
  }, []);

  const notifyContentGrew = useCallback((): void => {
    notifyContentGrewRef.current?.();
  }, []);

  const value = useMemo<TranscriptScrollPort>(
    () => ({
      sessionId: props.sessionId,
      scrollElementRef: props.scrollElementRef,
      scrollElement,
      registerMessageScroller,
      scrollToMessage,
      isFollowingTail,
      detachFromTail,
      beginProgrammaticScroll,
      beginLocalFoldLayout,
      notifyContentGrew,
    }),
    [
      props.sessionId,
      props.scrollElementRef,
      scrollElement,
      registerMessageScroller,
      scrollToMessage,
      isFollowingTail,
      detachFromTail,
      beginProgrammaticScroll,
      beginLocalFoldLayout,
      notifyContentGrew,
    ],
  );

  return (
    <TranscriptScrollContext.Provider value={value}>
      {props.children}
    </TranscriptScrollContext.Provider>
  );
}

export function useTranscriptScrollPort(): TranscriptScrollPort | null {
  return useContext(TranscriptScrollContext);
}
