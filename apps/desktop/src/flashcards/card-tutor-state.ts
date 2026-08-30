import type {
  FlashcardCreateInput,
  FlashcardItem,
  FlashcardTutorFace,
  FlashcardTutorIntent,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';
import type { FlashcardDeckOption } from './flashcard-tutor-draft';

export type CardTutorRequest = (command: HostCommand) => Promise<HostResponse>;

export type CardTutorStatus = 'idle' | 'loading' | 'ready' | 'error' | 'drafting';

export type CardTutorError = {
  code: string;
  message: string;
};

export type CardTutorDraftSaveStatus = 'idle' | 'saving' | 'saved';

export type CardTutorDraftState = {
  input: FlashcardCreateInput;
  deckOptions: FlashcardDeckOption[];
  saveStatus: CardTutorDraftSaveStatus;
  error: CardTutorError | null;
  existing: FlashcardItem | null;
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
  draft: CardTutorDraftState | null;
};

export const IDLE_STATE: CardTutorState = {
  status: 'idle',
  explanationId: null,
  itemId: null,
  face: null,
  selectedText: null,
  intent: null,
  markdown: null,
  error: null,
  draft: null,
};

export function isDraftSaving(state: CardTutorState): boolean {
  return state.status === 'drafting' && state.draft?.saveStatus === 'saving';
}

export function isDraftSaved(state: CardTutorState): boolean {
  return state.status === 'drafting' && state.draft?.saveStatus === 'saved';
}

export function draftError(code: string, message: string): CardTutorError {
  return { code, message };
}
