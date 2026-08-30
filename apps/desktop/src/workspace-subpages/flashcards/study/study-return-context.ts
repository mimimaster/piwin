import type { FlashcardStudyMode, FlashcardStudyScope } from '@piwin/contracts';

export type FlashcardStudyReturnContext = {
  selectedDeck: string;
  search: string;
  scrollTop: number;
  focusTileId: string | null;
};

export type FlashcardStudyResumePointer = {
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  roundId: string;
};

const RETURN_KEY = 'piwin.desktop.flashcardStudy.returnContext';
const RESUME_KEY = 'piwin.desktop.flashcardStudy.resume';

const memory = new Map<string, string>();

function storage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // fall through to memory
  }
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

function readJson<T>(key: string): T | null {
  const raw = storage().getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function captureStudyReturnContext(input: {
  selectedDeck: string;
  search: string;
  scrollTop: number;
  focusTileId: string | null;
}): FlashcardStudyReturnContext {
  return {
    selectedDeck: input.selectedDeck,
    search: input.search,
    scrollTop: Number.isFinite(input.scrollTop) ? input.scrollTop : 0,
    focusTileId: input.focusTileId,
  };
}

export function saveStudyReturnContext(context: FlashcardStudyReturnContext): void {
  try {
    storage().setItem(RETURN_KEY, JSON.stringify(context));
  } catch {
    // ignore
  }
}

export function loadStudyReturnContext(): FlashcardStudyReturnContext | null {
  const value = readJson<FlashcardStudyReturnContext>(RETURN_KEY);
  if (!value || typeof value.selectedDeck !== 'string' || typeof value.search !== 'string') {
    return null;
  }
  return {
    selectedDeck: value.selectedDeck,
    search: value.search,
    scrollTop: typeof value.scrollTop === 'number' ? value.scrollTop : 0,
    focusTileId: typeof value.focusTileId === 'string' ? value.focusTileId : null,
  };
}

export function clearStudyReturnContext(): void {
  storage().removeItem(RETURN_KEY);
}

export function saveStudyResumePointer(pointer: FlashcardStudyResumePointer): void {
  try {
    storage().setItem(RESUME_KEY, JSON.stringify(pointer));
  } catch {
    // ignore
  }
}

export function loadStudyResumePointer(): FlashcardStudyResumePointer | null {
  const value = readJson<FlashcardStudyResumePointer>(RESUME_KEY);
  if (!value || (value.mode !== 'sequence' && value.mode !== 'scheduled')) return null;
  if (!value.scope || typeof value.roundId !== 'string') return null;
  return value;
}

export function clearStudyResumePointer(): void {
  storage().removeItem(RESUME_KEY);
}

export function sameStudyScope(left: FlashcardStudyScope, right: FlashcardStudyScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'item' && right.kind === 'item') return left.itemId === right.itemId;
  if (left.kind === 'sequence' && right.kind === 'sequence') {
    return left.sequenceId === right.sequenceId;
  }
  if (left.kind === 'deck' && right.kind === 'deck') return left.deck === right.deck;
  if (left.kind === 'all' && right.kind === 'all') return true;
  if (left.kind === 'selection' && right.kind === 'selection') {
    return (
      left.parentRoundId === right.parentRoundId &&
      left.itemIds.length === right.itemIds.length &&
      left.itemIds.every((id, index) => id === right.itemIds[index])
    );
  }
  return false;
}
