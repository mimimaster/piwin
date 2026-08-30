import type { FlashcardStudyMode, FlashcardStudyScope } from '@piwin/contracts';
import type { FlashcardTile } from '../group-flashcard-tiles';
import type { FlashcardStudyEntry } from './use-flashcard-study';

export function studyScopeForTile(tile: FlashcardTile): FlashcardStudyScope {
  if (tile.kind === 'set') return { kind: 'sequence', sequenceId: tile.sequenceId };
  return { kind: 'item', itemId: tile.card.id };
}

export function scheduledScopeForDeck(selectedDeck: string): FlashcardStudyScope {
  if (selectedDeck === 'all') return { kind: 'all' };
  return { kind: 'deck', deck: selectedDeck };
}

export function createStudyEntry(input: {
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  resumeExisting?: boolean;
  roundId?: string;
}): FlashcardStudyEntry {
  const entry: FlashcardStudyEntry = {
    mode: input.mode,
    scope: input.scope,
    resumeExisting: input.resumeExisting !== false,
  };
  if (input.roundId) entry.roundId = input.roundId;
  return entry;
}
