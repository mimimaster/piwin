import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { cardTutorCopy } from './card-tutor-copy';
import {
  draftError,
  isDraftSaved,
  isDraftSaving,
  type CardTutorDraftState,
  type CardTutorRequest,
  type CardTutorState,
} from './card-tutor-state';
import {
  applyDraftEdits,
  basicDraftMissingFrontOrBack,
  buildTutorCreateInput,
  loadDeckOptions,
  outcomeFromBatchCreateData,
  toBatchCreateCard,
  type FlashcardDraftSource,
} from './flashcard-tutor-draft';

export function useCardTutorDraft(args: {
  stateRef: MutableRefObject<CardTutorState>;
  setState: Dispatch<SetStateAction<CardTutorState>>;
  requestRef: MutableRefObject<CardTutorRequest>;
  localeRef: MutableRefObject<'zh-CN' | 'en'>;
  notifyRef: MutableRefObject<((message: string) => void) | undefined>;
  draftTokenRef: MutableRefObject<number>;
  onCreatedRef: MutableRefObject<(() => void | Promise<void>) | null>;
}): {
  startDraft: (item: FlashcardDraftSource) => void;
  updateDraft: (edits: { front?: string; back?: string; deck?: string }) => void;
  saveDraft: () => Promise<void>;
  cancelDraft: () => void;
  registerOnCreated: (handler: () => void | Promise<void>) => () => void;
} {
  const {
    stateRef,
    setState,
    requestRef,
    localeRef,
    notifyRef,
    draftTokenRef,
    onCreatedRef,
  } = args;

  const startDraft = useCallback(
    (item: FlashcardDraftSource): void => {
      const current = stateRef.current;
      if (current.status === 'drafting') return;
      if (current.status !== 'ready' || current.selectedText === null || current.markdown === null) {
        return;
      }
      const input = buildTutorCreateInput({
        locale: localeRef.current,
        selectedText: current.selectedText,
        explanationMarkdown: current.markdown,
        source: item,
      });
      const deck = input.deck ?? 'General';
      const token = draftTokenRef.current + 1;
      draftTokenRef.current = token;
      setState({
        ...current,
        status: 'drafting',
        draft: {
          input,
          deckOptions: [{ value: deck, label: deck }],
          saveStatus: 'idle',
          error: null,
          existing: null,
        },
      });
      void loadDeckOptions(requestRef.current, deck).then((options) => {
        if (token !== draftTokenRef.current) return;
        setState((prev) => {
          if (prev.status !== 'drafting' || !prev.draft) return prev;
          return { ...prev, draft: { ...prev.draft, deckOptions: options } };
        });
      });
    },
    [draftTokenRef, localeRef, requestRef, setState, stateRef],
  );

  const updateDraft = useCallback(
    (edits: { front?: string; back?: string; deck?: string }): void => {
      setState((prev) => {
        if (prev.status !== 'drafting' || !prev.draft || prev.draft.saveStatus === 'saved') {
          return prev;
        }
        const next = applyDraftEdits(prev.draft.input, {
          front: edits.front ?? prev.draft.input.front ?? '',
          back: edits.back ?? prev.draft.input.back ?? '',
          deck: edits.deck ?? prev.draft.input.deck ?? 'General',
        });
        return {
          ...prev,
          draft: { ...prev.draft, input: next, error: null, existing: null },
        };
      });
    },
    [setState],
  );

  const cancelDraft = useCallback((): void => {
    if (isDraftSaving(stateRef.current) || isDraftSaved(stateRef.current)) return;
    draftTokenRef.current += 1;
    setState((prev) => {
      if (prev.status !== 'drafting' || isDraftSaving(prev)) return prev;
      return { ...prev, status: 'ready', draft: null };
    });
  }, [draftTokenRef, setState, stateRef]);

  const registerOnCreated = useCallback((handler: () => void | Promise<void>): (() => void) => {
    onCreatedRef.current = handler;
    return () => {
      if (onCreatedRef.current === handler) onCreatedRef.current = null;
    };
  }, [onCreatedRef]);

  const saveDraft = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.status !== 'drafting' || !current.draft) return;
    if (current.draft.saveStatus === 'saving' || current.draft.saveStatus === 'saved') return;
    if (basicDraftMissingFrontOrBack(current.draft.input)) {
      setState((prev) => {
        if (prev.status !== 'drafting' || !prev.draft) return prev;
        return {
          ...prev,
          draft: {
            ...prev.draft,
            error: draftError('flashcard-draft-empty', 'flashcard-draft-empty'),
            existing: null,
          },
        };
      });
      return;
    }

    const card = toBatchCreateCard(current.draft.input);
    setState((prev) => {
      if (prev.status !== 'drafting' || !prev.draft) return prev;
      return {
        ...prev,
        draft: { ...prev.draft, saveStatus: 'saving', error: null, existing: null },
      };
    });

    try {
      const response = await requestRef.current({
        type: 'flashcards/batch-create',
        input: { cards: [card] },
      });
      if (stateRef.current.status !== 'drafting' || stateRef.current.draft?.saveStatus !== 'saving') {
        return;
      }
      if (!response.success) {
        const unavailable =
          response.error.toLowerCase().includes('unavailable') ||
          (response.problem?.code ?? '').includes('unavailable');
        setState((prev) => {
          if (prev.status !== 'drafting' || !prev.draft) return prev;
          return {
            ...prev,
            draft: {
              ...prev.draft,
              saveStatus: 'idle',
              error: draftError(
                unavailable ? 'flashcard-draft-host-unavailable' : 'flashcard-draft-failed',
                response.error,
              ),
              existing: null,
            },
          };
        });
        return;
      }

      const outcome = outcomeFromBatchCreateData(response.data);
      if (outcome.kind === 'created') {
        setState((prev) => {
          if (prev.status !== 'drafting' || !prev.draft) return prev;
          return {
            ...prev,
            draft: { ...prev.draft, saveStatus: 'saved', error: null, existing: null },
          };
        });
        const onCreated = onCreatedRef.current;
        if (onCreated) {
          await onCreated();
        } else {
          notifyRef.current?.(cardTutorCopy(localeRef.current).savedCard);
        }
        return;
      }

      if (outcome.kind === 'duplicate') {
        setState((prev) => {
          if (prev.status !== 'drafting' || !prev.draft) return prev;
          const next: CardTutorDraftState = {
            ...prev.draft,
            saveStatus: 'idle',
            error: draftError('flashcard-draft-duplicate', 'flashcard-draft-duplicate'),
            existing: outcome.existing ?? null,
          };
          return { ...prev, draft: next };
        });
        return;
      }

      const validationDetail =
        outcome.kind === 'validation' ? outcome.detail : undefined;
      setState((prev) => {
        if (prev.status !== 'drafting' || !prev.draft) return prev;
        return {
          ...prev,
          draft: {
            ...prev.draft,
            saveStatus: 'idle',
            error: draftError(
              outcome.kind === 'validation' ? 'flashcard-draft-validation' : 'flashcard-draft-failed',
              validationDetail ?? (outcome.kind === 'failed' ? outcome.message : 'flashcard-draft-failed'),
            ),
            existing: null,
          },
        };
      });
    } catch (error) {
      if (stateRef.current.status !== 'drafting') return;
      const message = error instanceof Error ? error.message : 'host unavailable';
      const unavailable = message.toLowerCase().includes('unavailable');
      setState((prev) => {
        if (prev.status !== 'drafting' || !prev.draft) return prev;
        return {
          ...prev,
          draft: {
            ...prev.draft,
            saveStatus: 'idle',
            error: draftError(
              unavailable ? 'flashcard-draft-host-unavailable' : 'flashcard-draft-failed',
              message,
            ),
            existing: null,
          },
        };
      });
    }
  }, [localeRef, notifyRef, onCreatedRef, requestRef, setState, stateRef]);

  return { startDraft, updateDraft, saveDraft, cancelDraft, registerOnCreated };
}
