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
  ModelRef,
} from '@piwin/contracts';
import {
  IDLE_STATE,
  isDraftSaved,
  isDraftSaving,
  type CardTutorRequest,
  type CardTutorState,
} from './card-tutor-state';
import type { FlashcardDraftSource } from './flashcard-tutor-draft';
import { useCardTutorDraft } from './use-card-tutor-draft';

export type {
  CardTutorDraftSaveStatus,
  CardTutorDraftState,
  CardTutorError,
  CardTutorRequest,
  CardTutorState,
  CardTutorStatus,
} from './card-tutor-state';

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
  cancelForItem: (itemId: string) => void;
  close: () => void;
  startDraft: (item: FlashcardDraftSource) => void;
  updateDraft: (edits: { front?: string; back?: string; deck?: string }) => void;
  saveDraft: () => Promise<void>;
  cancelDraft: () => void;
  registerOnCreated: (handler: () => void | Promise<void>) => () => void;
};

const DEFAULT_CONTEXT: CardTutorContextValue = {
  state: IDLE_STATE,
  explain: async () => undefined,
  followUp: async () => undefined,
  retry: async () => undefined,
  cancel: () => undefined,
  cancelForItem: () => undefined,
  close: () => undefined,
  startDraft: () => undefined,
  updateDraft: () => undefined,
  saveDraft: async () => undefined,
  cancelDraft: () => undefined,
  registerOnCreated: () => () => undefined,
};

const CardTutorContext = createContext<CardTutorContextValue>(DEFAULT_CONTEXT);

export function useCardTutor(): CardTutorContextValue {
  return useContext(CardTutorContext);
}

/** Workspace injects gallery reload; chat omits this and uses notify. */
export function useCardTutorOnCreated(onCreated: () => void | Promise<void>): void {
  const tutor = useCardTutor();
  const register = tutor.registerOnCreated;
  useEffect(() => register(onCreated), [onCreated, register]);
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

function errorFromResponse(response: { success: boolean; error?: string; problem?: { code?: string } }): {
  code: string;
  message: string;
} {
  if (response.success) {
    return { code: 'flashcard-selection-provider-failed', message: 'empty explanation' };
  }
  const code = response.problem?.code ?? response.error ?? 'flashcard-selection-provider-failed';
  return { code, message: response.error ?? code };
}

export function CardTutorProvider(props: {
  request: CardTutorRequest;
  locale: 'zh-CN' | 'en';
  sessionId?: string;
  model?: ModelRef;
  notify?: (message: string) => void;
  children: ReactNode;
}): ReactElement {
  const [state, setState] = useState<CardTutorState>(IDLE_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const draftTokenRef = useRef(0);
  const explanationIdRef = useRef<string | null>(null);
  const activeItemIdRef = useRef<string | null>(null);
  const lastArgsRef = useRef<CardTutorExplainArgs | null>(null);
  const onCreatedRef = useRef<(() => void | Promise<void>) | null>(null);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;
  const localeRef = useRef(props.locale);
  localeRef.current = props.locale;
  const sessionIdRef = useRef(props.sessionId);
  sessionIdRef.current = props.sessionId;
  const modelRef = useRef(props.model);
  modelRef.current = props.model;
  const notifyRef = useRef(props.notify);
  notifyRef.current = props.notify;

  const { startDraft, updateDraft, saveDraft, cancelDraft, registerOnCreated } = useCardTutorDraft({
    stateRef,
    setState,
    requestRef,
    localeRef,
    notifyRef,
    draftTokenRef,
    onCreatedRef,
  });

  const cancelInflight = useCallback((nextStatus: 'idle' | 'loading') => {
    generationRef.current += 1;
    draftTokenRef.current += 1;
    const explanationId = explanationIdRef.current;
    explanationIdRef.current = null;
    if (explanationId) {
      void requestRef
        .current({ type: 'flashcards/cancel-explanation', explanationId })
        .catch(() => undefined);
    }
    if (nextStatus === 'idle') {
      activeItemIdRef.current = null;
      setState(IDLE_STATE);
    }
  }, []);

  const cancel = useCallback((): void => {
    if (isDraftSaving(stateRef.current)) return;
    lastArgsRef.current = null;
    cancelInflight('idle');
  }, [cancelInflight]);

  const cancelForItem = useCallback(
    (itemId: string): void => {
      if (activeItemIdRef.current !== itemId) return;
      const current = stateRef.current;
      if (isDraftSaving(current) || isDraftSaved(current)) return;
      lastArgsRef.current = null;
      cancelInflight('idle');
    },
    [cancelInflight],
  );

  const close = useCallback((): void => {
    if (isDraftSaving(stateRef.current)) return;
    cancel();
  }, [cancel]);

  const runExplain = useCallback(async (args: CardTutorExplainArgs): Promise<void> => {
    cancelInflight('loading');
    const explanationId = createExplanationId();
    const generation = generationRef.current;
    explanationIdRef.current = explanationId;
    activeItemIdRef.current = args.itemId;
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
      draft: null,
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
          draft: null,
        }));
        return;
      }
      const payload = asExplanation(response.data);
      if (!payload || payload.explanationId !== explanationId) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          markdown: null,
          error: {
            code: 'flashcard-selection-provider-failed',
            message: 'flashcard-selection-provider-failed',
          },
          draft: null,
        }));
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
        draft: null,
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
        draft: null,
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
      draftTokenRef.current += 1;
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
    () => ({
      state,
      explain,
      followUp,
      retry,
      cancel,
      cancelForItem,
      close,
      startDraft,
      updateDraft,
      saveDraft,
      cancelDraft,
      registerOnCreated,
    }),
    [
      state,
      explain,
      followUp,
      retry,
      cancel,
      cancelForItem,
      close,
      startDraft,
      updateDraft,
      saveDraft,
      cancelDraft,
      registerOnCreated,
    ],
  );

  return <CardTutorContext.Provider value={value}>{props.children}</CardTutorContext.Provider>;
}
