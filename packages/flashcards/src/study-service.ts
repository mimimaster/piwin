import {
  StudyOperationConflictError,
  StudyRoundNotFoundError,
  StudyStorageError,
  StudyUndoConflictError,
  isFlashcardStudyModeScopeCompatible,
  reviewStateRevision,
  type FlashcardStudyCatalogPage,
  type FlashcardStudyMode,
  type FlashcardStudyOperationResult,
  type FlashcardStudyRound,
  type FlashcardStudyScope,
  type FlashcardStudySnapshot,
  type ReviewRating,
} from '@piwin/contracts';
import { createCardStore, type CardStore } from './card-store.js';
import { parseReviewCardId } from './cloze.js';
import { getFlashcardsRoot } from './paths.js';
import { applyRatingToReviewState, createReviewWriteService } from './review-write-service.js';
import { buildStudyCatalogPage } from './study-catalog.js';
import { digestPayload } from './study-content-version.js';
import { createStudyRound, reduceStudyRound } from './study-round-reducer.js';
import {
  buildStartEntries,
  loadRoundOrThrow,
  newRoundId,
  reconcileAndPersist,
  requireUndoBefore,
  snapshotOf,
  type StudyCardAccess,
} from './study-service-support.js';
import {
  getOrCreateStudyCoordinator,
  wrapStorage,
  type StudyCoordinator,
  type StudyPersistenceHooks,
} from './study-transaction.js';

export type StudyMutationContext = {
  idempotencyKey: string;
  controllerIdentity: string;
};

export type StudyStartInput = StudyMutationContext & {
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  resumeExisting?: boolean;
};

export type StudyRoundMutation = StudyMutationContext & {
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
};

export type StudyService = {
  catalog: (input: {
    scopeFilter?: FlashcardStudyScope;
    query?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<FlashcardStudyCatalogPage>;
  start: (input: StudyStartInput) => Promise<FlashcardStudySnapshot>;
  get: (roundId: string, controllerIdentity: string) => Promise<FlashcardStudySnapshot>;
  claim: (input: StudyRoundMutation) => Promise<FlashcardStudySnapshot>;
  checkpoint: (
    input: StudyRoundMutation & {
      entryId: string;
      contentVersion: string;
      face: 'question' | 'answer';
      needsReview?: boolean;
    },
  ) => Promise<FlashcardStudySnapshot>;
  next: (
    input: StudyRoundMutation & { entryId: string; contentVersion: string },
  ) => Promise<FlashcardStudySnapshot>;
  rate: (
    input: StudyRoundMutation & {
      entryId: string;
      contentVersion: string;
      rating: ReviewRating;
      expectedReviewStateRevision: number;
    },
  ) => Promise<FlashcardStudySnapshot>;
  undo: (input: StudyRoundMutation & { targetOperationId: string }) => Promise<FlashcardStudySnapshot>;
  pause: (input: StudyRoundMutation) => Promise<FlashcardStudySnapshot>;
  resume: (input: StudyRoundMutation) => Promise<FlashcardStudySnapshot>;
  end: (input: StudyRoundMutation) => Promise<FlashcardStudySnapshot>;
  operation: (idempotencyKey: string) => Promise<FlashcardStudyOperationResult>;
};

export type StudyServiceOptions = {
  coordinator: StudyCoordinator;
  cards: StudyCardAccess;
};

export type StudyServices = {
  cardStore: CardStore;
  study: StudyService;
  coordinator: StudyCoordinator;
  recover: () => Promise<void>;
};

export function createStudyServices(options: {
  piwinRoot: string;
  hooks?: StudyPersistenceHooks;
}): StudyServices {
  const flashcardsRoot = getFlashcardsRoot(options.piwinRoot);
  const coordinator = getOrCreateStudyCoordinator(flashcardsRoot, options.hooks ?? {});
  const cardStore = createCardStore({ piwinRoot: options.piwinRoot });
  return {
    cardStore,
    study: createStudyService({ coordinator, cards: cardStore }),
    coordinator,
    recover: () => coordinator.ensureRecovered(),
  };
}

export function createStudyService(options: StudyServiceOptions): StudyService {
  const { coordinator, cards } = options;
  const reviewWrites = createReviewWriteService(coordinator);

  async function finishIdempotent(
    idempotencyKey: string,
    payload: unknown,
  ): Promise<FlashcardStudySnapshot | null> {
    const existing = await coordinator.lookup(idempotencyKey, digestPayload(payload));
    if (!existing) return null;
    if (existing.result.status === 'success') return existing.result.snapshot;
    throw new StudyOperationConflictError(idempotencyKey);
  }

  async function commitSnapshot(input: {
    idempotencyKey: string;
    payload: unknown;
    commandType: Parameters<StudyCoordinator['commit']>[0]['commandType'];
    before: FlashcardStudyRound;
    reduced: ReturnType<typeof reduceStudyRound>;
    controllerIdentity: string;
  }): Promise<FlashcardStudySnapshot> {
    const snapshot = await snapshotOf(
      coordinator,
      cards,
      input.reduced.round,
      input.controllerIdentity,
    );
    const record = await coordinator.commit({
      idempotencyKey: input.idempotencyKey,
      payloadDigest: digestPayload(input.payload),
      commandType: input.commandType,
      hostTimestamp: input.reduced.round.updatedAt,
      beforeRevision: input.before.revision,
      afterRevision: input.reduced.round.revision,
      result: { status: 'success', snapshot },
      ...(input.reduced.undoBefore ? { undoBefore: input.reduced.undoBefore } : {}),
      ...(input.commandType === 'next' || input.commandType === 'rate'
        ? {
            undoAfter: {
              round: input.reduced.round,
              ...(input.reduced.reviewState ? { reviewState: input.reduced.reviewState } : {}),
            },
          }
        : {}),
      ...(input.reduced.reviewState
        ? {
            reviewStateRevisionBefore: reviewStateRevision(
              input.reduced.undoBefore?.reviewState ?? input.reduced.reviewState,
            ),
            reviewStateRevisionAfter: reviewStateRevision(input.reduced.reviewState),
            targetReviewState: input.reduced.reviewState,
          }
        : {}),
      targetRound: input.reduced.round,
    });
    if (record.result.status !== 'success') {
      throw new StudyOperationConflictError(input.idempotencyKey);
    }
    return record.result.snapshot;
  }

  async function mutateRound<T extends { roundId: string; idempotencyKey: string }>(
    input: T,
    payload: unknown,
    commandType: Parameters<StudyCoordinator['commit']>[0]['commandType'],
    apply: (round: FlashcardStudyRound) => ReturnType<typeof reduceStudyRound> | Promise<ReturnType<typeof reduceStudyRound>>,
    controllerIdentity: string,
  ): Promise<FlashcardStudySnapshot> {
    return coordinator.runExclusive(async () => {
      const replay = await finishIdempotent(input.idempotencyKey, payload);
      if (replay) return replay;
      const loaded = await reconcileAndPersist(
        coordinator,
        cards,
        await loadRoundOrThrow(coordinator, input.roundId),
      );
      const reduced = await apply(loaded);
      return commitSnapshot({
        idempotencyKey: input.idempotencyKey,
        payload,
        commandType,
        before: loaded,
        reduced,
        controllerIdentity,
      });
    });
  }

  return {
    async catalog(input) {
      return coordinator.runExclusive(async () => {
        const items = await cards.list();
        const reviewCards = await cards.listReviewCards();
        const states = new Map();
        for (const card of reviewCards) {
          const state = await coordinator.reviewStates.read(card.cardId);
          if (state) states.set(card.cardId, state);
        }
        const unfinishedRounds = await coordinator.rounds.listUnfinished();
        return buildStudyCatalogPage({
          items,
          reviewCards,
          states,
          unfinishedRounds,
          ...(input.scopeFilter ? { scopeFilter: input.scopeFilter } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          now: coordinator.now(),
        });
      });
    },

    async start(input) {
      const resumeExisting = input.resumeExisting !== false;
      const payload = {
        type: 'start',
        mode: input.mode,
        scope: input.scope,
        resumeExisting,
      };
      return coordinator.runExclusive(async () => {
        const replay = await finishIdempotent(input.idempotencyKey, payload);
        if (replay) return replay;
        if (!isFlashcardStudyModeScopeCompatible(input.mode, input.scope)) {
          throw new StudyStorageError('illegal mode-scope combination');
        }
        let round: FlashcardStudyRound | null = null;
        if (resumeExisting) {
          round = await coordinator.rounds.findLatestUnfinished(input.mode, input.scope);
        }
        if (!round) {
          const now = coordinator.now().toISOString();
          round = createStudyRound({
            roundId: newRoundId(),
            mode: input.mode,
            scope: input.scope,
            entries: await buildStartEntries(
              coordinator,
              cards,
              input.mode,
              input.scope,
              reviewWrites,
            ),
            controllerIdentity: input.controllerIdentity,
            now,
          });
        } else {
          round = await reconcileAndPersist(coordinator, cards, round);
        }
        const snapshot = await snapshotOf(coordinator, cards, round, input.controllerIdentity);
        await coordinator.commit({
          idempotencyKey: input.idempotencyKey,
          payloadDigest: digestPayload(payload),
          commandType: 'start',
          hostTimestamp: round.updatedAt,
          beforeRevision: resumeExisting && round.revision > 0 ? round.revision : 0,
          afterRevision: round.revision,
          result: { status: 'success', snapshot },
          targetRound: round,
        });
        return snapshot;
      });
    },

    async get(roundId, controllerIdentity) {
      return coordinator.runExclusive(async () => {
        const round = await reconcileAndPersist(
          coordinator,
          cards,
          await loadRoundOrThrow(coordinator, roundId),
        );
        return snapshotOf(coordinator, cards, round, controllerIdentity);
      });
    },

    async claim(input) {
      const payload = {
        type: 'claim',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        expectedControlEpoch: input.controlEpoch,
      };
      return mutateRound(
        input,
        payload,
        'claim',
        (round) =>
          reduceStudyRound(round, {
            type: 'claim',
            expectedRevision: input.expectedRevision,
            expectedControlEpoch: input.controlEpoch,
            controllerIdentity: input.controllerIdentity,
            now: coordinator.now().toISOString(),
          }),
        input.controllerIdentity,
      );
    },

    async checkpoint(input) {
      const payload = {
        type: 'checkpoint',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        entryId: input.entryId,
        contentVersion: input.contentVersion,
        face: input.face,
        ...(input.needsReview !== undefined ? { needsReview: input.needsReview } : {}),
      };
      return mutateRound(
        input,
        payload,
        'checkpoint',
        (round) =>
          reduceStudyRound(round, {
            type: 'checkpoint',
            expectedRevision: input.expectedRevision,
            controlEpoch: input.controlEpoch,
            entryId: input.entryId,
            contentVersion: input.contentVersion,
            face: input.face,
            ...(input.needsReview !== undefined ? { needsReview: input.needsReview } : {}),
            now: coordinator.now().toISOString(),
          }),
        input.controllerIdentity,
      );
    },

    async next(input) {
      const payload = {
        type: 'next',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        entryId: input.entryId,
        contentVersion: input.contentVersion,
      };
      return mutateRound(
        input,
        payload,
        'next',
        (round) =>
          reduceStudyRound(round, {
            type: 'next',
            expectedRevision: input.expectedRevision,
            controlEpoch: input.controlEpoch,
            entryId: input.entryId,
            contentVersion: input.contentVersion,
            operationId: input.idempotencyKey,
            now: coordinator.now().toISOString(),
          }),
        input.controllerIdentity,
      );
    },

    async rate(input) {
      const payload = {
        type: 'rate',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        entryId: input.entryId,
        contentVersion: input.contentVersion,
        rating: input.rating,
        expectedReviewStateRevision: input.expectedReviewStateRevision,
      };
      return mutateRound(
        input,
        payload,
        'rate',
        async (round) => {
          const entry = round.entries.find((item) => item.entryId === input.entryId);
          const cardId = entry?.cardId;
          if (!entry || !cardId) throw new StudyRoundNotFoundError(input.roundId);
          if (!(await coordinator.itemExists(entry.itemId))) {
            throw new StudyUndoConflictError(round.roundId, 'card was deleted');
          }
          const current = await coordinator.reviewStates.read(cardId);
          if (!current) {
            throw wrapStorage(new Error(`missing or corrupt ReviewState for ${cardId}`));
          }
          const nextState = applyRatingToReviewState(current, input.rating, coordinator.now());
          return reduceStudyRound(round, {
            type: 'rate-result',
            expectedRevision: input.expectedRevision,
            controlEpoch: input.controlEpoch,
            entryId: input.entryId,
            contentVersion: input.contentVersion,
            rating: input.rating,
            expectedReviewStateRevision: input.expectedReviewStateRevision,
            operationId: input.idempotencyKey,
            now: coordinator.now().toISOString(),
            nextReviewState: nextState,
            previousReviewState: current,
          });
        },
        input.controllerIdentity,
      );
    },

    async undo(input) {
      const payload = {
        type: 'undo',
        roundId: input.roundId,
        expectedRevision: input.expectedRevision,
        controlEpoch: input.controlEpoch,
        targetOperationId: input.targetOperationId,
      };
      return mutateRound(
        input,
        payload,
        'undo',
        async (round) => {
          const { record: last, undoBefore } = await requireUndoBefore(
            coordinator,
            round,
            input.targetOperationId,
          );
          const beforeState = undoBefore.reviewState;
          if (beforeState) {
            const { itemId } = parseReviewCardId(beforeState.cardId);
            if (!(await coordinator.itemExists(itemId))) {
              throw new StudyUndoConflictError(round.roundId, 'card was deleted');
            }
            const current = await coordinator.reviewStates.read(beforeState.cardId);
            if (!current) {
              throw new StudyUndoConflictError(round.roundId, 'ReviewState missing');
            }
            const expected = last.reviewStateRevisionAfter ?? reviewStateRevision(current);
            if (reviewStateRevision(current) !== expected) {
              throw new StudyUndoConflictError(round.roundId, 'ReviewState changed by another writer');
            }
          }
          return reduceStudyRound(round, {
            type: 'undo',
            expectedRevision: input.expectedRevision,
            controlEpoch: input.controlEpoch,
            targetOperationId: input.targetOperationId,
            now: coordinator.now().toISOString(),
            before: undoBefore,
          });
        },
        input.controllerIdentity,
      );
    },

    async pause(input) {
      return mutateSimple(input, 'pause');
    },
    async resume(input) {
      return mutateSimple(input, 'resume');
    },
    async end(input) {
      return mutateSimple(input, 'end');
    },

    async operation(idempotencyKey) {
      return coordinator.runExclusive(async () => {
        const record = await coordinator.lookupByKey(idempotencyKey);
        if (!record) return { status: 'not-found' };
        if (!record.applied) {
          const finished = await coordinator.lookup(idempotencyKey, record.payloadDigest);
          return finished?.result ?? record.result;
        }
        return record.result;
      });
    },
  };

  function mutateSimple(input: StudyRoundMutation, type: 'pause' | 'resume' | 'end') {
    const payload = {
      type,
      roundId: input.roundId,
      expectedRevision: input.expectedRevision,
      controlEpoch: input.controlEpoch,
    };
    return mutateRound(
      input,
      payload,
      type,
      (round) =>
        reduceStudyRound(round, {
          type,
          expectedRevision: input.expectedRevision,
          controlEpoch: input.controlEpoch,
          now: coordinator.now().toISOString(),
        }),
      input.controllerIdentity,
    );
  }
}


