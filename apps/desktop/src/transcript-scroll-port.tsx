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
};

const TranscriptScrollContext = createContext<TranscriptScrollPort | null>(null);

export function TranscriptScrollProvider(props: {
  sessionId: string | null;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}): ReactElement {
  const messageScrollerRef = useRef<TranscriptMessageScroller | null>(null);

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

  const value = useMemo<TranscriptScrollPort>(
    () => ({
      sessionId: props.sessionId,
      scrollElementRef: props.scrollElementRef,
      registerMessageScroller,
      scrollToMessage,
    }),
    [props.sessionId, props.scrollElementRef, registerMessageScroller, scrollToMessage],
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
