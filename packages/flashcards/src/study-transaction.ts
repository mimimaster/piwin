/**
 * flashcardsRoot serial lock, operation-log commit point, projection apply, recovery.
 * Must not depend on host-runtime.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  PiwinError,
  StudyOperationConflictError,
  StudyStorageError,
  type FlashcardStudyOperationResult,
  type FlashcardStudyRound,
  type FlashcardStudyUndoImage,
  type ReviewState,
} from '@piwin/contracts';
import { parseReviewCardId } from './cloze.js';
import {
  getCardsDir,
  getReviewDir,
  sanitizeCardId,
} from './paths.js';
import { createReviewStateStore, type ReviewStateStore } from './review-state-store.js';
import { digestIdempotencyKey } from './study-content-version.js';
import {
  createStudyOperationStore,
  type DurableStudyCommandType,
  type DurableStudyOperation,
  type StudyOperationStore,
} from './study-operation-store.js';
import { createStudyRoundStore, type StudyRoundStore } from './study-round-store.js';

export type StudyCrashPoint =
  | 'before-log-commit'
  | 'after-log-durable'
  | 'after-review-state-written'
  | 'after-round-written'
  | 'after-applied'
  | 'before-ack'
  | 'mid-undo';

export class StudyCrashError extends Error {
  readonly point: StudyCrashPoint;

  constructor(point: StudyCrashPoint) {
    super(`injected crash at ${point}`);
    this.name = 'StudyCrashError';
    this.point = point;
  }
}

export type StudyApplyGatePoint = 'before-review-state-write';

export type StudyPersistenceHooks = {
  now?: () => Date;
  crashAt?: StudyCrashPoint | ((point: StudyCrashPoint, info: { commandType?: string }) => boolean);
  failWrite?: (path: string) => Error | undefined;
  onApplied?: (event: { roundId: string; revision: number; reason: DurableStudyCommandType }) => void;
  /** Test-only barrier inside projection; production leaves this unset. */
  gate?: (point: StudyApplyGatePoint) => void | Promise<void>;
};

export type OperationDraft = {
  idempotencyKey: string;
  payloadDigest: string;
  commandType: DurableStudyCommandType;
  hostTimestamp: string;
  beforeRevision: number;
  afterRevision: number;
  result: FlashcardStudyOperationResult;
  undoBefore?: FlashcardStudyUndoImage;
  undoAfter?: FlashcardStudyUndoImage;
  reviewStateRevisionBefore?: number;
  reviewStateRevisionAfter?: number;
  targetRound?: FlashcardStudyRound;
  targetReviewState?: ReviewState;
  principalId?: string;
};

export type StudyCoordinator = {
  flashcardsRoot: string;
  now: () => Date;
  reviewStates: ReviewStateStore;
  rounds: StudyRoundStore;
  operations: StudyOperationStore;
  runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  ensureRecovered: () => Promise<void>;
  recover: () => Promise<void>;
  commit: (draft: OperationDraft) => Promise<DurableStudyOperation>;
  lookup: (idempotencyKey: string, payloadDigest: string) => Promise<DurableStudyOperation | null>;
  lookupByKey: (idempotencyKey: string) => Promise<DurableStudyOperation | null>;
  itemExists: (itemId: string) => Promise<boolean>;
  writeTargetReviewState: (state: ReviewState) => Promise<void>;
};

const held = new AsyncLocalStorage<true>();
const coordinators = new Map<string, StudyCoordinator>();

export function getOrCreateStudyCoordinator(
  flashcardsRoot: string,
  hooks: StudyPersistenceHooks = {},
): StudyCoordinator {
  const root = resolve(flashcardsRoot);
  const existing = coordinators.get(root);
  if (existing) {
    mergeHooks(existing, hooks);
    return existing;
  }
  const created = createStudyCoordinator(root, { ...hooks });
  coordinators.set(root, created);
  return created;
}

export function resetStudyCoordinatorsForTests(): void {
  coordinators.clear();
}

function mergeHooks(coordinator: StudyCoordinator, incoming: StudyPersistenceHooks): void {
  const current = (coordinator as unknown as { hooks: StudyPersistenceHooks }).hooks;
  if (!current) return;
  if (incoming.now) current.now = incoming.now;
  if (incoming.crashAt !== undefined) current.crashAt = incoming.crashAt;
  if (incoming.failWrite) current.failWrite = incoming.failWrite;
  if (incoming.onApplied) current.onApplied = incoming.onApplied;
  if (incoming.gate) current.gate = incoming.gate;
}

function createStudyCoordinator(
  flashcardsRoot: string,
  hooks: StudyPersistenceHooks,
): StudyCoordinator {
  const reviewDir = getReviewDir(flashcardsRoot);
  const cardsDir = getCardsDir(flashcardsRoot);
  const writeHooks = () => (hooks.failWrite ? { failWrite: hooks.failWrite } : undefined);
  let tail: Promise<unknown> = Promise.resolve();

  const reviewStates = createReviewStateStore({
    flashcardsRoot,
    reviewDir,
    ensureDirs: async () => {
      await mkdir(reviewDir, { recursive: true });
    },
    writeHooks,
  });
  const rounds = createStudyRoundStore({ flashcardsRoot, writeHooks });
  const operations = createStudyOperationStore({ flashcardsRoot, writeHooks });

  function now(): Date {
    return hooks.now ? hooks.now() : new Date();
  }

  function crash(point: StudyCrashPoint, commandType?: string): void {
    const at = hooks.crashAt;
    if (!at) return;
    const info = commandType === undefined ? {} : { commandType };
    const hit = typeof at === 'function' ? at(point, info) : at === point;
    if (hit) throw new StudyCrashError(point);
  }

  async function itemExists(itemId: string): Promise<boolean> {
    try {
      sanitizeCardId(itemId);
      await access(join(cardsDir, `${itemId}.md`));
      return true;
    } catch {
      return false;
    }
  }

  async function writeTargetReviewState(state: ReviewState): Promise<void> {
    const { itemId } = parseReviewCardId(state.cardId);
    const exists = await itemExists(itemId);
    await hooks.gate?.('before-review-state-write');
    if (exists && (await itemExists(itemId))) {
      await reviewStates.write(state);
    }
  }

  function notifyApplied(record: DurableStudyOperation): void {
    const roundId = record.targetRound?.roundId;
    if (!roundId || !hooks.onApplied) return;
    hooks.onApplied({
      roundId,
      revision: record.targetRound?.revision ?? record.afterRevision,
      reason: record.commandType,
    });
  }

  async function applyProjection(record: DurableStudyOperation): Promise<void> {
    if (record.targetReviewState) {
      await writeTargetReviewState(record.targetReviewState);
      crash('after-review-state-written', record.commandType);
      if (record.commandType === 'undo') crash('mid-undo', record.commandType);
    }
    if (record.targetRound) {
      await rounds.write(record.targetRound);
      crash('after-round-written', record.commandType);
    }
  }

  async function recoverUnlocked(): Promise<void> {
    try {
      await rounds.ensureDir();
      await operations.ensureDir();
      await rounds.cleanupTemps();
      await operations.cleanupTemps();
      const records = await operations.listInOrder();
      for (const record of records) {
        if (record.applied) continue;
        await applyProjection(record);
        await operations.markApplied(record);
        notifyApplied(record);
      }
    } catch (error) {
      throw wrapStorage(error);
    }
  }

  function runExclusive<T>(work: () => Promise<T>): Promise<T> {
    if (held.getStore()) return work();
    const run = tail.then(
      () =>
        held.run(true, async () => {
          await recoverUnlocked();
          return work();
        }),
      () =>
        held.run(true, async () => {
          await recoverUnlocked();
          return work();
        }),
    );
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function ensureRecovered(): Promise<void> {
    await runExclusive(async () => undefined);
  }

  async function recover(): Promise<void> {
    await ensureRecovered();
  }

  async function lookupByKey(idempotencyKey: string): Promise<DurableStudyOperation | null> {
    return operations.findByIdempotencyKey(idempotencyKey);
  }

  async function lookupUnlocked(
    idempotencyKey: string,
    payloadDigest: string,
  ): Promise<DurableStudyOperation | null> {
    const existing = await operations.findByIdempotencyKey(idempotencyKey);
    if (!existing) return null;
    if (existing.payloadDigest !== payloadDigest) {
      throw new StudyOperationConflictError(idempotencyKey);
    }
    if (!existing.applied) {
      await applyProjection(existing);
      await operations.markApplied(existing);
      existing.applied = true;
      notifyApplied(existing);
    }
    return existing;
  }

  async function lookup(
    idempotencyKey: string,
    payloadDigest: string,
  ): Promise<DurableStudyOperation | null> {
    return runExclusive(() => lookupUnlocked(idempotencyKey, payloadDigest));
  }

  async function commit(draft: OperationDraft): Promise<DurableStudyOperation> {
    crash('before-log-commit', draft.commandType);
    const keyHash = digestIdempotencyKey(draft.idempotencyKey);
    const sequence = await operations.nextSequence();
    const record: DurableStudyOperation = {
      schemaVersion: 1,
      sequence,
      idempotencyKey: draft.idempotencyKey,
      keyHash,
      payloadDigest: draft.payloadDigest,
      commandType: draft.commandType,
      hostTimestamp: draft.hostTimestamp,
      applied: false,
      beforeRevision: draft.beforeRevision,
      afterRevision: draft.afterRevision,
      result: draft.result,
      ...(draft.undoBefore ? { undoBefore: draft.undoBefore } : {}),
      ...(draft.undoAfter ? { undoAfter: draft.undoAfter } : {}),
      ...(draft.reviewStateRevisionBefore !== undefined
        ? { reviewStateRevisionBefore: draft.reviewStateRevisionBefore }
        : {}),
      ...(draft.reviewStateRevisionAfter !== undefined
        ? { reviewStateRevisionAfter: draft.reviewStateRevisionAfter }
        : {}),
      ...(draft.targetRound ? { targetRound: draft.targetRound } : {}),
      ...(draft.targetReviewState ? { targetReviewState: draft.targetReviewState } : {}),
      ...(draft.principalId ? { principalId: draft.principalId } : {}),
    };
    try {
      await operations.write(record);
    } catch (error) {
      throw wrapStorage(error);
    }
    crash('after-log-durable', draft.commandType);
    try {
      await applyProjection(record);
      const applied = await operations.markApplied(record);
      crash('after-applied', draft.commandType);
      notifyApplied(applied);
      crash('before-ack', draft.commandType);
      return applied;
    } catch (error) {
      throw wrapStorage(error);
    }
  }

  const coordinator: StudyCoordinator = {
    flashcardsRoot,
    now,
    reviewStates,
    rounds,
    operations,
    runExclusive,
    ensureRecovered,
    recover,
    commit,
    lookup,
    lookupByKey,
    itemExists,
    writeTargetReviewState,
  };
  (coordinator as unknown as { hooks: StudyPersistenceHooks }).hooks = hooks;
  return coordinator;
}

export function wrapStorage(error: unknown): Error {
  if (error instanceof StudyCrashError) return error;
  if (error instanceof PiwinError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new StudyStorageError(detail);
}
