import type { FlashcardStudyMode, FlashcardStudyScope } from '@piwin/contracts';

export type MobileStudyReturnSource = 'catalog' | 'chat';

export type MobileFlashcardStudyReturnContext = {
  source: MobileStudyReturnSource;
  selectedDeck: string;
  search: string;
  scrollTop: number;
  focusTileId: string | null;
};

const RETURN_KEY = 'piwin.mobile.flashcardStudy.returnContext';
const memory = new Map<string, string>();

function storage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // fall through
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

export function captureMobileStudyReturnContext(input: {
  source: MobileStudyReturnSource;
  selectedDeck: string;
  search: string;
  scrollTop: number;
  focusTileId: string | null;
}): MobileFlashcardStudyReturnContext {
  return {
    source: input.source,
    selectedDeck: input.selectedDeck,
    search: input.search,
    scrollTop: Number.isFinite(input.scrollTop) ? input.scrollTop : 0,
    focusTileId: input.focusTileId,
  };
}

export function saveMobileStudyReturnContext(context: MobileFlashcardStudyReturnContext): void {
  try {
    storage().setItem(RETURN_KEY, JSON.stringify(context));
  } catch {
    // ignore
  }
}

export function loadMobileStudyReturnContext(): MobileFlashcardStudyReturnContext | null {
  const value = readJson<MobileFlashcardStudyReturnContext>(RETURN_KEY);
  if (!value || (value.source !== 'catalog' && value.source !== 'chat')) return null;
  if (typeof value.selectedDeck !== 'string' || typeof value.search !== 'string') return null;
  return {
    source: value.source,
    selectedDeck: value.selectedDeck,
    search: value.search,
    scrollTop: typeof value.scrollTop === 'number' ? value.scrollTop : 0,
    focusTileId: typeof value.focusTileId === 'string' ? value.focusTileId : null,
  };
}

export function clearMobileStudyReturnContext(): void {
  storage().removeItem(RETURN_KEY);
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

export function studyScopeForTile(tile: {
  kind: 'single' | 'set';
  id: string;
  sequenceId?: string;
}): FlashcardStudyScope {
  if (tile.kind === 'set') {
    return { kind: 'sequence', sequenceId: tile.sequenceId ?? tile.id };
  }
  return { kind: 'item', itemId: tile.id };
}

export function scheduledScopeForDeck(selectedDeck: string): FlashcardStudyScope {
  if (selectedDeck === 'all') return { kind: 'all' };
  return { kind: 'deck', deck: selectedDeck };
}

export function describeStudyScope(
  mode: FlashcardStudyMode,
  scope: FlashcardStudyScope,
): string {
  if (mode === 'scheduled') {
    return scope.kind === 'deck' ? scope.deck : '待复习';
  }
  if (scope.kind === 'item') return '单张';
  if (scope.kind === 'sequence') return '卡套';
  if (scope.kind === 'selection') return '巩固子集';
  return '顺序复习';
}
