import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  FlashcardSelectionExplainInput,
  FlashcardSelectionExplanation,
  FlashcardTutorFace,
  FlashcardTutorIntent,
  HostCommand,
  HostResponse,
  ModelRef,
} from '@piwin/contracts';

export type CardTutorStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CardTutorError = {
  code: string;
  message: string;
};

export type CardTutorState = {
  status: CardTutorStatus;
  explanationId: string | null;
  itemId: string | null;
  face: FlashcardTutorFace | null;
  selectedText: string | null;
  intent: FlashcardTutorIntent | null;
  markdown: string | null;
  error: CardTutorError | null;
};

export type CardTutorExplainArgs = {
  itemId: string;
  face: FlashcardTutorFace;
  selectedText: string;
  intent: FlashcardTutorIntent;
};

export type CardTutorContextValue = {
  state: CardTutorState;
  explain: (args: CardTutorExplainArgs) => Promise<void>;
  followUp: (intent: 'example' | 'simplify') => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => void;
  close: () => void;
};

export type CardTutorRequest = (command: HostCommand) => Promise<HostResponse>;

const IDLE_STATE: CardTutorState = {
  status: 'idle',
  explanationId: null,
  itemId: null,
  face: null,
  selectedText: null,
  intent: null,
  markdown: null,
  error: null,
};

const DEFAULT_CONTEXT: CardTutorContextValue = {
  state: IDLE_STATE,
  explain: async () => undefined,
  followUp: async () => undefined,
  retry: async () => undefined,
  cancel: () => undefined,
  close: () => undefined,
};

const CardTutorContext = createContext<CardTutorContextValue>(DEFAULT_CONTEXT);

export function useCardTutor(): CardTutorContextValue {
  return useContext(CardTutorContext);
}

function createExplanationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fc-exp-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function asExplanation(data: unknown): FlashcardSelectionExplanation | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (
    typeof record.explanationId !== 'string' ||
    typeof record.itemId !== 'string' ||
    typeof record.selectedText !== 'string' ||
    typeof record.markdown !== 'string' ||
    (record.intent !== 'hint' &&
      record.intent !== 'explain' &&
      record.intent !== 'example' &&
      record.intent !== 'simplify')
  ) {
    return null;
  }
  return {
    explanationId: record.explanationId,
    itemId: record.itemId,
    selectedText: record.selectedText,
    intent: record.intent,
    markdown: record.markdown,
  };
}

function errorFromResponse(response: HostResponse): CardTutorError {
  if (response.success) {
    return { code: 'flashcard-selection-provider-failed', message: 'empty explanation' };
  }
  const code = response.problem?.code ?? response.error;
  return { code, message: response.error };
}

export function CardTutorProvider(props: {
  request: CardTutorRequest;
  locale: 'zh-CN' | 'en';
  sessionId?: string;
  model?: ModelRef;
  children: ReactNode;
}): ReactElement {
  const [state, setState] = useState<CardTutorState>(IDLE_STATE);
  const generationRef = useRef(0);
  const explanationIdRef = useRef<string | null>(null);
  const lastArgsRef = useRef<CardTutorExplainArgs | null>(null);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;
  const localeRef = useRef(props.locale);
  localeRef.current = props.locale;
  const sessionIdRef = useRef(props.sessionId);
  sessionIdRef.current = props.sessionId;
  const modelRef = useRef(props.model);
  modelRef.current = props.model;

  const cancelInflight = useCallback((nextStatus: CardTutorStatus) => {
    generationRef.current += 1;
    const explanationId = explanationIdRef.current;
    explanationIdRef.current = null;
    if (explanationId) {
      void requestRef
        .current({ type: 'flashcards/cancel-explanation', explanationId })
        .catch(() => undefined);
    }
    if (nextStatus === 'idle') {
      setState(IDLE_STATE);
    }
  }, []);

  const cancel = useCallback((): void => {
    lastArgsRef.current = null;
    cancelInflight('idle');
  }, [cancelInflight]);

  const close = useCallback((): void => {
    cancel();
  }, [cancel]);

  const runExplain = useCallback(async (args: CardTutorExplainArgs): Promise<void> => {
    cancelInflight('loading');
    const explanationId = createExplanationId();
    const generation = generationRef.current;
    explanationIdRef.current = explanationId;
    lastArgsRef.current = args;
    setState({
      status: 'loading',
      explanationId,
      itemId: args.itemId,
      face: args.face,
      selectedText: args.selectedText,
      intent: args.intent,
      markdown: null,
      error: null,
    });

    const input: FlashcardSelectionExplainInput = {
      explanationId,
      itemId: args.itemId,
      face: args.face,
      selectedText: args.selectedText,
      intent: args.intent,
      locale: localeRef.current === 'en' ? 'en' : 'zh-CN',
    };
    const sessionId = sessionIdRef.current;
    if (sessionId) input.sessionId = sessionId;
    const model = modelRef.current;
    if (model) input.model = model;

    try {
      const response = await requestRef.current({
        type: 'flashcards/explain-selection',
        input,
      });
      if (generation !== generationRef.current || explanationIdRef.current !== explanationId) {
        return;
      }
      if (!response.success) {
        const error = errorFromResponse(response);
        if (error.code === 'flashcard-selection-cancelled') {
          setState(IDLE_STATE);
          return;
        }
        setState((prev) => ({
          ...prev,
          status: 'error',
          markdown: null,
          error,
        }));
        return;
      }
      const payload = asExplanation(response.data);
      if (!payload || payload.explanationId !== explanationId) {
        return;
      }
      setState({
        status: 'ready',
        explanationId,
        itemId: payload.itemId,
        face: args.face,
        selectedText: payload.selectedText,
        intent: payload.intent,
        markdown: payload.markdown,
        error: null,
      });
    } catch (error) {
      if (generation !== generationRef.current || explanationIdRef.current !== explanationId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        status: 'error',
        markdown: null,
        error: {
          code: 'flashcard-selection-provider-failed',
          message: error instanceof Error ? error.message : 'provider failed',
        },
      }));
    }
  }, [cancelInflight]);

  const explain = useCallback(
    async (args: CardTutorExplainArgs): Promise<void> => {
      await runExplain(args);
    },
    [runExplain],
  );

  const followUp = useCallback(
    async (intent: 'example' | 'simplify'): Promise<void> => {
      const last = lastArgsRef.current;
      const selectedText = state.selectedText ?? last?.selectedText;
      const itemId = state.itemId ?? last?.itemId;
      const face = state.face ?? last?.face ?? 'back';
      if (!itemId || !selectedText) return;
      await runExplain({ itemId, face, selectedText, intent });
    },
    [runExplain, state.face, state.itemId, state.selectedText],
  );

  const retry = useCallback(async (): Promise<void> => {
    const last = lastArgsRef.current;
    if (!last) return;
    await runExplain(last);
  }, [runExplain]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      const explanationId = explanationIdRef.current;
      explanationIdRef.current = null;
      if (explanationId) {
        void requestRef
          .current({ type: 'flashcards/cancel-explanation', explanationId })
          .catch(() => undefined);
      }
    };
  }, []);

  const value = useMemo<CardTutorContextValue>(
    () => ({ state, explain, followUp, retry, cancel, close }),
    [state, explain, followUp, retry, cancel, close],
  );

  return <CardTutorContext.Provider value={value}>{props.children}</CardTutorContext.Provider>;
}
