import {
  StudyStorageError,
  reviewStateRevision,
  type FlashcardItem,
  type FlashcardStudyEntry,
  type FlashcardStudyRound,
  type ReviewState,
} from '@piwin/contracts';
import { expandItemToReviewCards, itemToDisplayCard } from './cloze.js';
import { isNewState } from './scheduler.js';
import { computeItemContentVersion, computeReviewCardContentVersion } from './study-content-version.js';
import { reduceStudyRound } from './study-round-reducer.js';

export type ReconcileResult = {
  round: FlashcardStudyRound;
  changed: boolean;
};

export function reconcileStudyRound(input: {
  round: FlashcardStudyRound;
  items: ReadonlyMap<string, FlashcardItem>;
  states: ReadonlyMap<string, ReviewState | null>;
  now: Date;
}): ReconcileResult {
  let round = cloneRound(input.round);
  let changed = false;
  const nowIso = input.now.toISOString();

  for (const entry of round.entries) {
    if (entry.state !== 'pending') continue;
    const item = input.items.get(entry.itemId);
    if (!item) {
      round = reduceStudyRound(round, { type: 'invalidate', entryId: entry.entryId, now: nowIso }).round;
      changed = true;
      continue;
    }
    if (round.mode === 'scheduled') {
      const ordinal = entry.ordinal;
      if (ordinal === undefined || entry.cardId === undefined) {
        round = reduceStudyRound(round, { type: 'invalidate', entryId: entry.entryId, now: nowIso }).round;
        changed = true;
        continue;
      }
      const card = expandItemToReviewCards(item).find((review) => review.ordinal === ordinal);
      if (!card) {
        round = reduceStudyRound(round, { type: 'invalidate', entryId: entry.entryId, now: nowIso }).round;
        changed = true;
        continue;
      }
      const state = input.states.get(entry.cardId);
      if (state === undefined || state === null) {
        throw new StudyStorageError(`missing or corrupt ReviewState for ${entry.cardId}`);
      }
      const liveVersion = computeReviewCardContentVersion(card);
      if (liveVersion !== entry.contentVersion) {
        const target = requireEntry(round, entry.entryId);
        target.contentVersion = liveVersion;
        if (round.currentEntryId === entry.entryId) round.face = 'question';
        round.revision += 1;
        round.updatedAt = nowIso;
        changed = true;
      }
      const captured = entry.reviewStateRevision ?? 0;
      const liveRevision = reviewStateRevision(state);
      if (liveRevision !== captured) {
        const stillDue = isNewState(state) || new Date(state.due) <= input.now;
        if (!stillDue) {
          round = reduceStudyRound(round, { type: 'invalidate', entryId: entry.entryId, now: nowIso }).round;
          changed = true;
        } else {
          const target = requireEntry(round, entry.entryId);
          target.reviewStateRevision = liveRevision;
          if (round.currentEntryId === entry.entryId) round.face = 'question';
          round.revision += 1;
          round.updatedAt = nowIso;
          changed = true;
        }
      }
      continue;
    }

    const display = itemToDisplayCard(item);
    if (!display) {
      round = reduceStudyRound(round, { type: 'invalidate', entryId: entry.entryId, now: nowIso }).round;
      changed = true;
      continue;
    }
    const liveVersion = computeItemContentVersion(item);
    if (liveVersion !== entry.contentVersion) {
      const target = requireEntry(round, entry.entryId);
      target.contentVersion = liveVersion;
      if (round.currentEntryId === entry.entryId) round.face = 'question';
      round.revision += 1;
      round.updatedAt = nowIso;
      changed = true;
    }
  }

  return { round, changed };
}

function requireEntry(round: FlashcardStudyRound, entryId: string): FlashcardStudyEntry {
  const entry = round.entries.find((item) => item.entryId === entryId);
  if (!entry) {
    throw new StudyStorageError(`reconcile missing entry ${entryId}`);
  }
  return entry;
}

function cloneRound(round: FlashcardStudyRound): FlashcardStudyRound {
  return {
    ...round,
    scope:
      round.scope.kind === 'selection'
        ? { ...round.scope, itemIds: [...round.scope.itemIds] }
        : { ...round.scope },
    entries: round.entries.map((entry) => ({ ...entry })),
  };
}
