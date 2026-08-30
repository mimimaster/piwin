import {
  computeFlashcardStudyCounts,
  type FlashcardItem,
  type FlashcardStudyContentProjection,
  type FlashcardStudyNextShell,
  type FlashcardStudyRound,
  type FlashcardStudySnapshot,
  type ReviewState,
} from '@piwin/contracts';
import { expandItemToReviewCards, itemToDisplayCard } from './cloze.js';

export function buildStudySnapshot(input: {
  round: FlashcardStudyRound;
  items: ReadonlyMap<string, FlashcardItem>;
  states: ReadonlyMap<string, ReviewState>;
  controllerIdentity: string;
}): FlashcardStudySnapshot {
  const { round } = input;
  const currentEntry = round.currentEntryId
    ? round.entries.find((entry) => entry.entryId === round.currentEntryId)
    : undefined;
  const current = currentEntry ? projectEntry(round, currentEntry, input.items) : undefined;
  const nextPending = currentEntry
    ? round.entries.find(
        (entry, index) =>
          entry.state === 'pending' &&
          index > round.entries.findIndex((item) => item.entryId === currentEntry.entryId),
      )
    : round.entries.find((entry) => entry.state === 'pending');
  const snapshot: FlashcardStudySnapshot = {
    round: {
      roundId: round.roundId,
      schemaVersion: round.schemaVersion,
      mode: round.mode,
      scope: round.scope,
      status: round.status,
      revision: round.revision,
      controlEpoch: round.controlEpoch,
      controllerIdentity: round.controllerIdentity,
      createdAt: round.createdAt,
      updatedAt: round.updatedAt,
      currentEntryId: round.currentEntryId,
      face: round.face,
      lastAdvanceOperationId: round.lastAdvanceOperationId,
    },
    counts: computeFlashcardStudyCounts(round.entries),
    canUndo: round.lastAdvanceOperationId !== null,
    access: {
      hasControl: input.controllerIdentity === round.controllerIdentity,
      controllerIdentity: round.controllerIdentity,
      controlEpoch: round.controlEpoch,
    },
  };
  if (current) snapshot.current = current;
  if (nextPending) snapshot.nextShell = toNextShell(nextPending);
  if (currentEntry?.cardId) {
    const due = input.states.get(currentEntry.cardId)?.due;
    if (due) snapshot.nextDueAt = due;
  }
  return snapshot;
}

function projectEntry(
  round: FlashcardStudyRound,
  entry: FlashcardStudyRound['entries'][number],
  items: ReadonlyMap<string, FlashcardItem>,
): FlashcardStudyContentProjection | undefined {
  const item = items.get(entry.itemId);
  if (!item) return undefined;
  const card =
    round.mode === 'scheduled' && entry.ordinal !== undefined
      ? expandItemToReviewCards(item).find((review) => review.ordinal === entry.ordinal)
      : itemToDisplayCard(item);
  if (!card) return undefined;
  const projection: FlashcardStudyContentProjection = {
    entryId: entry.entryId,
    itemId: entry.itemId,
    contentVersion: entry.contentVersion,
    model: card.model,
    deck: card.deck,
    face: round.face,
    front: card.front,
    back: card.back,
    needsReview: entry.needsReview,
  };
  if (entry.cardId) projection.cardId = entry.cardId;
  if (entry.ordinal !== undefined) projection.ordinal = entry.ordinal;
  if (entry.reviewStateRevision !== undefined) {
    projection.reviewStateRevision = entry.reviewStateRevision;
  }
  if (card.model === 'cloze' && entry.ordinal !== undefined) {
    const siblings = expandItemToReviewCards(item);
    projection.siblingOrdinal = entry.ordinal;
    projection.siblingCount = siblings.length;
  }
  const sourceTitle = sourceTitleFromFile(item.sourceFile);
  if (sourceTitle) projection.sourceTitle = sourceTitle;
  if (item.sourceExcerpt) projection.sourceExcerpt = item.sourceExcerpt;
  if (item.tags) projection.tags = item.tags;
  if (item.sequenceId) projection.sequenceId = item.sequenceId;
  return projection;
}

function sourceTitleFromFile(sourceFile: string | undefined): string | undefined {
  const trimmed = sourceFile?.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(/[/\\]/).filter((part) => part.length > 0);
  const base = parts[parts.length - 1];
  return base || undefined;
}

function toNextShell(entry: FlashcardStudyRound['entries'][number]): FlashcardStudyNextShell {
  const shell: FlashcardStudyNextShell = {
    entryId: entry.entryId,
    itemId: entry.itemId,
    contentVersion: entry.contentVersion,
  };
  if (entry.cardId) shell.cardId = entry.cardId;
  if (entry.ordinal !== undefined) shell.ordinal = entry.ordinal;
  return shell;
}
