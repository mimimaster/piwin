import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StudyOperationConflictError,
  StudyStorageError,
} from '@piwin/contracts';
import { expandItemToReviewCards } from './cloze.js';
import { computeItemContentVersion, computeReviewCardContentVersion } from './study-content-version.js';
import { countOperationFiles } from './study-operation-store.js';
import { getStudyOperationsDir, getStudyRoundsDir } from './paths.js';
import { createStudyServices, type StudyServices } from './study-service.js';
import {
  StudyCrashError,
  getOrCreateStudyCoordinator,
  resetStudyCoordinatorsForTests,
  type StudyPersistenceHooks,
} from './study-transaction.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const IDENTITY = 'conn-1';
const roots: string[] = [];

afterEach(async () => {
  resetStudyCoordinatorsForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function openWorld(hooks: StudyPersistenceHooks = {}): Promise<StudyServices & { piwinRoot: string }> {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-study-'));
  roots.push(piwinRoot);
  const services = createStudyServices({
    piwinRoot,
    hooks: { now: () => NOW, ...hooks },
  });
  return { ...services, piwinRoot };
}

async function restart(
  piwinRoot: string,
  hooks: StudyPersistenceHooks = {},
): Promise<StudyServices> {
  resetStudyCoordinatorsForTests();
  return createStudyServices({
    piwinRoot,
    hooks: { now: () => NOW, ...hooks },
  });
}

function arm(world: StudyServices, hooks: StudyPersistenceHooks): void {
  getOrCreateStudyCoordinator(world.coordinator.flashcardsRoot, { now: () => NOW, ...hooks });
}

async function sequenceReady() {
  const world = await openWorld();
  const first = await world.cardStore.create({
    front: 'Q1',
    back: 'A1',
    sequenceId: 'seq-1',
    position: 1,
  });
  await world.cardStore.create({
    front: 'Q2',
    back: 'A2',
    sequenceId: 'seq-1',
    position: 2,
  });
  const started = await world.study.start({
    idempotencyKey: 'start-1',
    controllerIdentity: IDENTITY,
    mode: 'sequence',
    scope: { kind: 'sequence', sequenceId: 'seq-1' },
    resumeExisting: true,
  });
  const entryId = started.current?.entryId;
  if (!entryId) throw new Error('expected current entry');
  return {
    ...world,
    first,
    started,
    entryId,
    contentVersion: computeItemContentVersion(first),
  };
}

async function scheduledReady() {
  const world = await openWorld();
  const item = await world.cardStore.create({ front: 'due?', back: 'yes' });
  const started = await world.study.start({
    idempotencyKey: 'start-sched',
    controllerIdentity: IDENTITY,
    mode: 'scheduled',
    scope: { kind: 'all' },
    resumeExisting: true,
  });
  const current = started.current;
  if (!current) throw new Error('expected current scheduled entry');
  const shown = await world.study.checkpoint({
    idempotencyKey: 'flip-1',
    controllerIdentity: IDENTITY,
    roundId: started.round.roundId,
    expectedRevision: started.round.revision,
    controlEpoch: started.round.controlEpoch,
    entryId: current.entryId,
    contentVersion: current.contentVersion,
    face: 'answer',
  });
  const cards = expandItemToReviewCards(item);
  const card = cards[0];
  if (!card) throw new Error('expected review card');
  return {
    ...world,
    item,
    card,
    started: shown,
    entryId: current.entryId,
    contentVersion: computeReviewCardContentVersion(card),
  };
}

describe('study crash recovery', () => {
  it('crash before log commit leaves no operation and unchanged round', async () => {
    const ctx = await sequenceReady();
    arm(ctx, { crashAt: 'before-log-commit' });
    await expect(
      ctx.study.next({
        idempotencyKey: 'next-1',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const again = await restart(ctx.piwinRoot);
    await expect(again.study.operation('next-1')).resolves.toEqual({ status: 'not-found' });
    const snap = await again.study.get(ctx.started.round.roundId, IDENTITY);
    expect(snap.round.revision).toBe(ctx.started.round.revision);
    expect(snap.round.lastAdvanceOperationId).toBeNull();
    expect(await countOperationFiles(again.coordinator.flashcardsRoot)).toBe(1);
  });

  it('crash after log durable completes projection on restart', async () => {
    const ctx = await sequenceReady();
    arm(ctx, { crashAt: 'after-log-durable' });
    await expect(
      ctx.study.next({
        idempotencyKey: 'next-2',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const again = await restart(ctx.piwinRoot);
    const looked = await again.study.operation('next-2');
    expect(looked.status).toBe('success');
    const snap = await again.study.get(ctx.started.round.roundId, IDENTITY);
    expect(snap.round.lastAdvanceOperationId).toBe('next-2');
    expect(snap.round.revision).toBeGreaterThan(ctx.started.round.revision);
  });

  it('crash after ReviewState written but round not still converges', async () => {
    const ctx = await scheduledReady();
    arm(ctx, { crashAt: 'after-review-state-written' });
    await expect(
      ctx.study.rate({
        idempotencyKey: 'rate-1',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
        rating: 'good',
        expectedReviewStateRevision: 0,
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const again = await restart(ctx.piwinRoot);
    const looked = await again.study.operation('rate-1');
    expect(looked.status).toBe('success');
    const snap = await again.study.get(ctx.started.round.roundId, IDENTITY);
    expect(snap.round.lastAdvanceOperationId).toBe('rate-1');
    const state = await again.cardStore.getReviewState(ctx.item.id);
    expect(state.reps).toBe(1);
    expect(state.revision).toBe(1);
    expect(snap.counts.processed).toBe(1);
  });

  it('crash after applied before ACK returns the same result after restart', async () => {
    const ctx = await sequenceReady();
    arm(ctx, { crashAt: 'before-ack' });
    await expect(
      ctx.study.next({
        idempotencyKey: 'next-ack',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const again = await restart(ctx.piwinRoot);
    const looked = await again.study.operation('next-ack');
    expect(looked.status).toBe('success');
    const retried = await again.study.next({
      idempotencyKey: 'next-ack',
      controllerIdentity: IDENTITY,
      roundId: ctx.started.round.roundId,
      expectedRevision: ctx.started.round.revision,
      controlEpoch: ctx.started.round.controlEpoch,
      entryId: ctx.entryId,
      contentVersion: ctx.contentVersion,
    });
    expect(retried.round.revision).toBe(
      looked.status === 'success' ? looked.snapshot.round.revision : -1,
    );
  });

  it('crash mid-undo restores business fields and keeps versions increasing', async () => {
    const ctx = await scheduledReady();
    const rated = await ctx.study.rate({
      idempotencyKey: 'rate-undo',
      controllerIdentity: IDENTITY,
      roundId: ctx.started.round.roundId,
      expectedRevision: ctx.started.round.revision,
      controlEpoch: ctx.started.round.controlEpoch,
      entryId: ctx.entryId,
      contentVersion: ctx.contentVersion,
      rating: 'good',
      expectedReviewStateRevision: 0,
    });
    resetStudyCoordinatorsForTests();
    const crashing = createStudyServices({
      piwinRoot: ctx.piwinRoot,
      hooks: { now: () => NOW, crashAt: 'mid-undo' },
    });
    await expect(
      crashing.study.undo({
        idempotencyKey: 'undo-1',
        controllerIdentity: IDENTITY,
        roundId: rated.round.roundId,
        expectedRevision: rated.round.revision,
        controlEpoch: rated.round.controlEpoch,
        targetOperationId: 'rate-undo',
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const again = await restart(ctx.piwinRoot);
    const looked = await again.study.operation('undo-1');
    expect(looked.status).toBe('success');
    const snap = await again.study.get(rated.round.roundId, IDENTITY);
    expect(snap.round.currentEntryId).toBe(ctx.entryId);
    expect(snap.round.revision).toBeGreaterThan(rated.round.revision);
    const state = await again.cardStore.getReviewState(ctx.item.id);
    expect(state.reps).toBe(0);
    expect(state.revision).toBeGreaterThan(1);
  });

  it('same key same payload is identical across calls and restart', async () => {
    const ctx = await sequenceReady();
    const input = {
      idempotencyKey: 'next-same',
      controllerIdentity: IDENTITY,
      roundId: ctx.started.round.roundId,
      expectedRevision: ctx.started.round.revision,
      controlEpoch: ctx.started.round.controlEpoch,
      entryId: ctx.entryId,
      contentVersion: ctx.contentVersion,
    };
    const first = await ctx.study.next(input);
    const second = await ctx.study.next(input);
    expect(second).toEqual(first);
    const again = await restart(ctx.piwinRoot);
    const third = await again.study.next(input);
    expect(third.round.revision).toBe(first.round.revision);
    expect(third.round.lastAdvanceOperationId).toBe('next-same');
  });

  it('same key different payload is rejected', async () => {
    const ctx = await sequenceReady();
    await ctx.study.next({
      idempotencyKey: 'next-conflict',
      controllerIdentity: IDENTITY,
      roundId: ctx.started.round.roundId,
      expectedRevision: ctx.started.round.revision,
      controlEpoch: ctx.started.round.controlEpoch,
      entryId: ctx.entryId,
      contentVersion: ctx.contentVersion,
    });
    await expect(
      ctx.study.checkpoint({
        idempotencyKey: 'next-conflict',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
        face: 'answer',
      }),
    ).rejects.toBeInstanceOf(StudyOperationConflictError);
  });

  it('disk full and permission errors are visible and do not reset progress', async () => {
    const full = await sequenceReady();
    arm(full, {
      failWrite: (path) =>
        path.includes(`${join('study', 'operations')}`)
          ? Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
          : undefined,
    });
    const before = await full.study.get(full.started.round.roundId, IDENTITY);
    await expect(
      full.study.next({
        idempotencyKey: 'next-full',
        controllerIdentity: IDENTITY,
        roundId: full.started.round.roundId,
        expectedRevision: full.started.round.revision,
        controlEpoch: full.started.round.controlEpoch,
        entryId: full.entryId,
        contentVersion: full.contentVersion,
      }),
    ).rejects.toBeInstanceOf(StudyStorageError);
    const after = await restart(full.piwinRoot);
    const snap = await after.study.get(full.started.round.roundId, IDENTITY);
    expect(snap.round.revision).toBe(before.round.revision);
    await expect(after.study.operation('next-full')).resolves.toEqual({ status: 'not-found' });

    const denied = await sequenceReady();
    arm(denied, {
      failWrite: (path) =>
        path.includes(`${join('study', 'rounds')}`)
          ? Object.assign(new Error('permission denied'), { code: 'EACCES' })
          : undefined,
    });
    await expect(
      denied.study.next({
        idempotencyKey: 'next-denied',
        controllerIdentity: IDENTITY,
        roundId: denied.started.round.roundId,
        expectedRevision: denied.started.round.revision,
        controlEpoch: denied.started.round.controlEpoch,
        entryId: denied.entryId,
        contentVersion: denied.contentVersion,
      }),
    ).rejects.toBeInstanceOf(StudyStorageError);
  });

  it('corrupt log is isolated and reported without wiping rounds', async () => {
    const ctx = await sequenceReady();
    await ctx.study.next({
      idempotencyKey: 'next-keep',
      controllerIdentity: IDENTITY,
      roundId: ctx.started.round.roundId,
      expectedRevision: ctx.started.round.revision,
      controlEpoch: ctx.started.round.controlEpoch,
      entryId: ctx.entryId,
      contentVersion: ctx.contentVersion,
    });
    const opDir = getStudyOperationsDir(ctx.coordinator.flashcardsRoot);
    const files = (await readdir(opDir)).filter((name) => name.endsWith('.json'));
    const target = files[0];
    if (!target) throw new Error('expected operation file');
    await writeFile(join(opDir, target), '{not-json', 'utf8');

    const again = await restart(ctx.piwinRoot);
    await expect(again.study.get(ctx.started.round.roundId, IDENTITY)).rejects.toBeInstanceOf(
      StudyStorageError,
    );
    const isolated = (await readdir(opDir)).filter((name) => name.includes('.corrupt'));
    expect(isolated.length).toBeGreaterThan(0);
    const roundDir = getStudyRoundsDir(ctx.coordinator.flashcardsRoot);
    const rounds = await readdir(roundDir);
    expect(rounds.some((name) => name.endsWith('.json'))).toBe(true);
  });


  it('does not prune the operation log', async () => {
    const ctx = await sequenceReady();
    const first = await ctx.study.next({
      idempotencyKey: 'next-a',
      controllerIdentity: IDENTITY,
      roundId: ctx.started.round.roundId,
      expectedRevision: ctx.started.round.revision,
      controlEpoch: ctx.started.round.controlEpoch,
      entryId: ctx.entryId,
      contentVersion: ctx.contentVersion,
    });
    const nextEntry = first.current?.entryId;
    if (!nextEntry) throw new Error('expected second entry');
    await ctx.study.next({
      idempotencyKey: 'next-b',
      controllerIdentity: IDENTITY,
      roundId: first.round.roundId,
      expectedRevision: first.round.revision,
      controlEpoch: first.round.controlEpoch,
      entryId: nextEntry,
      contentVersion: computeItemContentVersion(
        await ctx.cardStore.read(first.current?.itemId ?? ''),
      ),
    });
    expect(await countOperationFiles(ctx.coordinator.flashcardsRoot)).toBeGreaterThanOrEqual(3);
  });

  it('recovery of a committed-but-unapplied log fires onApplied once', async () => {
    const ctx = await scheduledReady();
    arm(ctx, { crashAt: 'after-log-durable' });
    await expect(
      ctx.study.rate({
        idempotencyKey: 'rate-push',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
        rating: 'good',
        expectedReviewStateRevision: 0,
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const applied: Array<{ roundId: string; revision: number; reason: string }> = [];
    const again = await restart(ctx.piwinRoot, {
      onApplied: (event) => applied.push(event),
    });
    await again.recover();
    expect(applied).toEqual([
      expect.objectContaining({
        roundId: ctx.started.round.roundId,
        reason: 'rate',
      }),
    ]);
    await again.study.operation('rate-push');
    expect(applied).toHaveLength(1);
  });

  it('operation lookup applies an unapplied commit and fires onApplied', async () => {
    const ctx = await sequenceReady();
    arm(ctx, { crashAt: 'after-log-durable' });
    await expect(
      ctx.study.next({
        idempotencyKey: 'next-push',
        controllerIdentity: IDENTITY,
        roundId: ctx.started.round.roundId,
        expectedRevision: ctx.started.round.revision,
        controlEpoch: ctx.started.round.controlEpoch,
        entryId: ctx.entryId,
        contentVersion: ctx.contentVersion,
      }),
    ).rejects.toBeInstanceOf(StudyCrashError);

    const applied: Array<{ roundId: string; reason: string }> = [];
    const again = await restart(ctx.piwinRoot, {
      onApplied: (event) => applied.push(event),
    });
    const looked = await again.study.operation('next-push');
    expect(looked.status).toBe('success');
    expect(applied).toEqual([
      expect.objectContaining({
        roundId: ctx.started.round.roundId,
        reason: 'next',
      }),
    ]);
  });
});

describe('study service start/get', () => {
  it('resumeExisting serializes the same unfinished round', async () => {
    const world = await openWorld();
    await world.cardStore.create({
      front: 'Q1',
      back: 'A1',
      sequenceId: 'seq-2',
      position: 1,
    });
    const [left, right] = await Promise.all([
      world.study.start({
        idempotencyKey: 'start-a',
        controllerIdentity: IDENTITY,
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq-2' },
        resumeExisting: true,
      }),
      world.study.start({
        idempotencyKey: 'start-b',
        controllerIdentity: IDENTITY,
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq-2' },
        resumeExisting: true,
      }),
    ]);
    expect(left.round.roundId).toBe(right.round.roundId);
  });

  it('get fails visibly for a missing round', async () => {
    const world = await openWorld();
    await expect(world.study.get('round-missing', IDENTITY)).rejects.toMatchObject({
      code: 'StudyRoundNotFoundError',
    });
  });
});

