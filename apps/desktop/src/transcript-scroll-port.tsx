import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

export type TranscriptMessageScroller = (messageId: string) => boolean;

export type TranscriptScrollPort = {
  sessionId: string | null;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  registerMessageScroller: (scroller: TranscriptMessageScroller) => () => void;
  scrollToMessage: TranscriptMessageScroller;
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
  children: ReactNode;
}): ReactElement {
  const messageScrollerRef = useRef<TranscriptMessageScroller | null>(null);
  const notifyContentGrewRef = useRef(props.notifyContentGrew);
  notifyContentGrewRef.current = props.notifyContentGrew;

  const registerMessageScroller = useCallback((scroller: TranscriptMessageScroller) => {
    messageScrollerRef.current = scroller;
    return () => {
      if (messageScrollerRef.current === scroller) {
        messageScrollerRef.current = null;
      }
    };
  }, []);

  const scrollToMessage = useCallback((messageId: string): boolean => {
    return messageScrollerRef.current?.(messageId) ?? false;
  }, []);

  const notifyContentGrew = useCallback((): void => {
    notifyContentGrewRef.current?.();
  }, []);

  const value = useMemo<TranscriptScrollPort>(
    () => ({
      sessionId: props.sessionId,
      scrollElementRef: props.scrollElementRef,
      registerMessageScroller,
      scrollToMessage,
      notifyContentGrew,
    }),
    [props.sessionId, props.scrollElementRef, registerMessageScroller, scrollToMessage, notifyContentGrew],
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
