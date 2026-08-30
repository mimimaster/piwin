import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandItemToReviewCards } from './cloze.js';
import { createCardStore } from './card-store.js';
import { computeReviewCardContentVersion } from './study-content-version.js';
import { createStudyServices } from './study-service.js';
import { resetStudyCoordinatorsForTests } from './study-transaction.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const IDENTITY = 'conn-1';
const roots: string[] = [];

afterEach(async () => {
  resetStudyCoordinatorsForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('review-write-service', () => {
  it('increments ReviewState revision on every CardStore.rate write', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-write-'));
    roots.push(piwinRoot);
    const store = createCardStore({ piwinRoot });
    const card = await store.create({ front: 'q', back: 'a' });
    const first = await store.rate(card.id, 'good', NOW);
    const second = await store.rate(card.id, 'hard', NOW);
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
  });

  it('list recovery cannot resurrect ReviewState after a concurrent delete', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-resurrect-'));
    roots.push(piwinRoot);
    const setup = createStudyServices({ piwinRoot, hooks: { now: () => NOW } });
    const item = await setup.cardStore.create({ front: 'due?', back: 'yes' });
    const started = await setup.study.start({
      idempotencyKey: 'start-sched',
      controllerIdentity: IDENTITY,
      mode: 'scheduled',
      scope: { kind: 'all' },
      resumeExisting: true,
    });
    const current = started.current;
    if (!current) throw new Error('expected current scheduled entry');
    const shown = await setup.study.checkpoint({
      idempotencyKey: 'flip-1',
      controllerIdentity: IDENTITY,
      roundId: started.round.roundId,
      expectedRevision: started.round.revision,
      controlEpoch: started.round.controlEpoch,
      entryId: current.entryId,
      contentVersion: current.contentVersion,
      face: 'answer',
    });
    const card = expandItemToReviewCards(item)[0];
    if (!card) throw new Error('expected review card');
    resetStudyCoordinatorsForTests();
    const crashing = createStudyServices({
      piwinRoot,
      hooks: { now: () => NOW, crashAt: 'after-log-durable' },
    });
    await expect(
      crashing.study.rate({
        idempotencyKey: 'rate-unapplied',
        controllerIdentity: IDENTITY,
        roundId: shown.round.roundId,
        expectedRevision: shown.round.revision,
        controlEpoch: shown.round.controlEpoch,
        entryId: current.entryId,
        contentVersion: computeReviewCardContentVersion(card),
        rating: 'good',
        expectedReviewStateRevision: 0,
      }),
    ).rejects.toMatchObject({ name: 'StudyCrashError' });

    resetStudyCoordinatorsForTests();
    let releaseGate: () => void = () => undefined;
    const gateHeld = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let enterGate: () => void = () => undefined;
    const gateEntered = new Promise<void>((resolve) => {
      enterGate = resolve;
    });
    const order: string[] = [];
    const again = createStudyServices({
      piwinRoot,
      hooks: {
        now: () => NOW,
        gate: async (point) => {
          if (point !== 'before-review-state-write') return;
          order.push('recover-inside');
          enterGate();
          await gateHeld;
          order.push('recover-after-gate');
        },
      },
    });
    const listDone = again.cardStore.list().then(() => {
      order.push('list-done');
    });
    await gateEntered;
    const deleteDone = again.cardStore.delete(item.id).then(() => {
      order.push('delete-done');
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(order).toContain('recover-inside');
    expect(order).not.toContain('delete-done');
    releaseGate();
    await Promise.all([listDone, deleteDone]);
    expect(order.indexOf('recover-inside')).toBeLessThan(order.indexOf('delete-done'));
    await expect(again.cardStore.read(item.id)).rejects.toThrow('card not found');
    const leftover = await readdir(join(again.coordinator.flashcardsRoot, 'review')).catch(() => []);
    expect(leftover.filter((name) => name.startsWith(item.id))).toEqual([]);
  });

  it('does not resurrect a deleted card when study rate, old rate, and delete race', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-race-'));
    roots.push(piwinRoot);
    const { cardStore, study, coordinator } = createStudyServices({
      piwinRoot,
      hooks: { now: () => NOW },
    });
    const item = await cardStore.create({ front: 'due?', back: 'yes' });
    const started = await study.start({
      idempotencyKey: 'start-sched',
      controllerIdentity: IDENTITY,
      mode: 'scheduled',
      scope: { kind: 'all' },
      resumeExisting: true,
    });
    const current = started.current;
    if (!current) throw new Error('expected current scheduled entry');
    const shown = await study.checkpoint({
      idempotencyKey: 'flip-1',
      controllerIdentity: IDENTITY,
      roundId: started.round.roundId,
      expectedRevision: started.round.revision,
      controlEpoch: started.round.controlEpoch,
      entryId: current.entryId,
      contentVersion: current.contentVersion,
      face: 'answer',
    });
    const card = expandItemToReviewCards(item)[0];
    if (!card) throw new Error('expected review card');
    const results = await Promise.allSettled([
      study.rate({
        idempotencyKey: 'rate-race',
        controllerIdentity: IDENTITY,
        roundId: shown.round.roundId,
        expectedRevision: shown.round.revision,
        controlEpoch: shown.round.controlEpoch,
        entryId: current.entryId,
        contentVersion: computeReviewCardContentVersion(card),
        rating: 'good',
        expectedReviewStateRevision: 0,
      }),
      cardStore.rate(item.id, 'easy'),
      cardStore.delete(item.id),
      cardStore.list(),
    ]);
    const studyResult = results[0];
    const oldRateResult = results[1];
    const deleteResult = results[2];
    expect(
      [studyResult, oldRateResult, deleteResult].some((result) => result.status === 'fulfilled'),
    ).toBe(true);

    const exists = await coordinator.itemExists(item.id);
    if (!exists) {
      await expect(cardStore.read(item.id)).rejects.toThrow('card not found');
      await study.operation('rate-race');
      await expect(cardStore.read(item.id)).rejects.toThrow('card not found');
      const leftover = await readdir(join(coordinator.flashcardsRoot, 'review')).catch(() => []);
      expect(leftover.filter((name) => name.startsWith(item.id))).toEqual([]);
      return;
    }

    const state = await cardStore.getReviewState(item.id);
    const snap = await study.get(shown.round.roundId, IDENTITY);
    const processed = snap.counts.processed === 1;
    const advanced = state.reps > 0;
    if (processed) {
      expect(advanced).toBe(true);
      expect(state.revision).toBeGreaterThan(0);
    } else if (advanced) {
      expect(oldRateResult.status).toBe('fulfilled');
      expect(studyResult.status).not.toBe('fulfilled');
    }
    if (studyResult.status === 'fulfilled') {
      expect(processed).toBe(true);
      expect(advanced).toBe(true);
    }
  });
});
