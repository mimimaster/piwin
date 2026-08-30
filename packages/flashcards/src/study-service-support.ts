import { randomUUID } from 'node:crypto';
import {
  StudyRoundNotFoundError,
  StudyStorageError,
  StudyUndoConflictError,
  type FlashcardItem,
  type FlashcardStudyEntry,
  type FlashcardStudyMode,
  type FlashcardStudyRound,
  type FlashcardStudyScope,
  type ReviewState,
} from '@piwin/contracts';
import type { CardStore } from './card-store.js';
import { buildReviewQueue } from './queue.js';
import type { ReviewWriteService } from './review-write-service.js';
import {
  computeItemContentVersion,
  computeReviewCardContentVersion,
} from './study-content-version.js';
import { reconcileStudyRound } from './study-reconcile.js';
import {
  buildScheduledEntries,
  buildSequenceEntries,
  captureSequenceMembers,
  selectParentMembersPreservingOrder,
} from './study-sequence.js';
import { buildStudySnapshot } from './study-snapshot.js';
import type { StudyCoordinator } from './study-transaction.js';

export type StudyCardAccess = Pick<CardStore, 'list' | 'listReviewCards' | 'read'>;

export function newRoundId(): string {
  return `round-${randomUUID()}`;
}

export async function readItemMap(
  cards: StudyCardAccess,
  itemIds: Iterable<string>,
): Promise<Map<string, FlashcardItem>> {
  const items = new Map<string, FlashcardItem>();
  for (const itemId of itemIds) {
    try {
      items.set(itemId, await cards.read(itemId));
    } catch {
      // Missing cards stay absent; reconcile invalidates pending entries.
    }
  }
  return items;
}

export async function readStateMap(
  coordinator: StudyCoordinator,
  cardIds: Iterable<string>,
): Promise<Map<string, ReviewState | null>> {
  const states = new Map<string, ReviewState | null>();
  for (const cardId of cardIds) {
    states.set(cardId, await coordinator.reviewStates.read(cardId));
  }
  return states;
}

export async function loadRoundOrThrow(
  coordinator: StudyCoordinator,
  roundId: string,
): Promise<FlashcardStudyRound> {
  const round = await coordinator.rounds.read(roundId);
  if (!round) throw new StudyRoundNotFoundError(roundId);
  return round;
}

export async function loadRoundContext(
  coordinator: StudyCoordinator,
  cards: StudyCardAccess,
  round: FlashcardStudyRound,
): Promise<{
  items: Map<string, FlashcardItem>;
  states: Map<string, ReviewState | null>;
  presentStates: Map<string, ReviewState>;
}> {
  const items = await readItemMap(
    cards,
    round.entries.map((entry) => entry.itemId),
  );
  const cardIds = round.entries
    .map((entry) => entry.cardId)
    .filter((cardId): cardId is string => typeof cardId === 'string');
  const states = await readStateMap(coordinator, cardIds);
  const presentStates = new Map<string, ReviewState>();
  for (const [cardId, state] of states) {
    if (state) presentStates.set(cardId, state);
  }
  return { items, states, presentStates };
}

export async function reconcileAndPersist(
  coordinator: StudyCoordinator,
  cards: StudyCardAccess,
  round: FlashcardStudyRound,
): Promise<FlashcardStudyRound> {
  const { items, states } = await loadRoundContext(coordinator, cards, round);
  const reconciled = reconcileStudyRound({
    round,
    items,
    states,
    now: coordinator.now(),
  });
  if (reconciled.changed) {
    await coordinator.rounds.write(reconciled.round);
  }
  return reconciled.round;
}

export async function snapshotOf(
  coordinator: StudyCoordinator,
  cards: StudyCardAccess,
  round: FlashcardStudyRound,
  controllerIdentity: string,
) {
  const { items, presentStates } = await loadRoundContext(coordinator, cards, round);
  return buildStudySnapshot({
    round,
    items,
    states: presentStates,
    controllerIdentity,
  });
}

export async function buildStartEntries(
  coordinator: StudyCoordinator,
  cards: StudyCardAccess,
  mode: FlashcardStudyMode,
  scope: FlashcardStudyScope,
  reviewWrites: ReviewWriteService,
): Promise<FlashcardStudyEntry[]> {
  if (mode === 'sequence') {
    const items = await resolveSequenceItems(coordinator, cards, scope);
    return buildSequenceEntries(items, computeItemContentVersion);
  }
  if (scope.kind !== 'all' && scope.kind !== 'deck') {
    throw new StudyStorageError('scheduled start requires all or deck scope');
  }
  const filter = scope.kind === 'deck' ? { deck: scope.deck } : undefined;
  const reviewCards = await cards.listReviewCards(filter);
  const states = new Map<string, ReviewState>();
  for (const card of reviewCards) {
    states.set(card.cardId, await reviewWrites.getOrInit(card.cardId, coordinator.now()));
  }
  const queue = buildReviewQueue({
    cards: reviewCards,
    states,
    now: coordinator.now(),
    ...(scope.kind === 'deck' ? { deck: scope.deck } : {}),
  });
  return buildScheduledEntries(
    queue.map((item) => item.card),
    states,
    computeReviewCardContentVersion,
  );
}

async function resolveSequenceItems(
  coordinator: StudyCoordinator,
  cards: StudyCardAccess,
  scope: FlashcardStudyScope,
): Promise<FlashcardItem[]> {
  if (scope.kind === 'item') {
    return [await cards.read(scope.itemId)];
  }
  if (scope.kind === 'sequence') {
    const all = await cards.list();
    return captureSequenceMembers(all, scope.sequenceId);
  }
  if (scope.kind !== 'selection') {
    throw new StudyStorageError('sequence start requires item, sequence, or selection scope');
  }
  const parent = await loadRoundOrThrow(coordinator, scope.parentRoundId);
  const parentIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of parent.entries) {
    if (seen.has(entry.itemId)) continue;
    seen.add(entry.itemId);
    parentIds.push(entry.itemId);
  }
  const selected = selectParentMembersPreservingOrder(parentIds, scope.itemIds);
  if (!selected.ok) {
    throw new StudyStorageError(selected.error);
  }
  const items: FlashcardItem[] = [];
  for (const itemId of selected.itemIds) {
    items.push(await cards.read(itemId));
  }
  return items;
}

export async function requireUndoBefore(
  coordinator: StudyCoordinator,
  round: FlashcardStudyRound,
  targetOperationId: string,
) {
  const record = await coordinator.lookupByKey(targetOperationId);
  const undoBefore = record?.undoBefore;
  if (!record || !undoBefore) {
    throw new StudyUndoConflictError(round.roundId, 'last advance has no undo image');
  }
  return { record, undoBefore };
}
