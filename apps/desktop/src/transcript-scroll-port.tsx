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
  /** Stop follow-tail before a history jump so ResizeObserver sticks cannot yank back. */
  detachFromTail: () => void;
  /**
   * Nested content grew (e.g. Artifact iframe height bridge). Re-stick to the
   * live tail when follow-tail is active — without waiting for App-level
   * activitySignal re-renders.
   */
  notifyContentGrew: () => void;
};

const TranscriptScrollContext = createContext<TranscriptScrollPort | null>(null);

export function TranscriptScrollProvider(props: {
  sessionId: string | null;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  /** Optional stick callback from useTranscriptScroll. */
  notifyContentGrew?: () => void;
  detachFromTail?: () => void;
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
      detachFromTail,
      notifyContentGrew,
    }),
    [
      props.sessionId,
      props.scrollElementRef,
      scrollElement,
      registerMessageScroller,
      scrollToMessage,
      detachFromTail,
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
