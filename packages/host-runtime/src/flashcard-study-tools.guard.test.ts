/**
 * Guard regressions for flashcard_study_write: sequence mode preflight,
 * abort-during-preflight, and scheduled idempotent replay.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  FlashcardStudySnapshot,
  HostPush,
  HostToolRegistration,
  ToolResult,
} from '@piwin/contracts';
import {
  FLASHCARD_STUDY_WRITE_TOOL_NAME,
  flashcardStudyAgentControllerPrincipal,
} from '@piwin/contracts';
import {
  createCardStore,
  createStudyService,
  getFlashcardsRoot,
  getOrCreateStudyCoordinator,
  resetStudyCoordinatorsForTests,
  type StudyService,
} from '@piwin/flashcards';
import { buildFlashcardStudyTools } from './flashcard-study-tools.js';
import { toStudyChangedPush } from './commands/flashcard-study-commands.js';

const SESSION_ID = 'session-study-1';
const NOW = new Date('2026-08-30T12:00:00.000Z');
const roots: string[] = [];

afterEach(async () => {
  resetStudyCoordinatorsForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function principalFor(sessionId = SESSION_ID): string {
  const parsed = flashcardStudyAgentControllerPrincipal(sessionId);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

async function openWorld(options?: {
  onPush?: (push: HostPush) => void;
}): Promise<{
  piwinRoot: string;
  study: StudyService;
  cardStore: ReturnType<typeof createCardStore>;
  write: HostToolRegistration;
}> {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-study-tools-guard-'));
  roots.push(piwinRoot);
  const cardStore = createCardStore({ piwinRoot });
  const coordinator = getOrCreateStudyCoordinator(getFlashcardsRoot(piwinRoot), {
    now: () => NOW,
    ...(options?.onPush
      ? {
          onApplied: (event) => {
            options.onPush?.(toStudyChangedPush(event));
          },
        }
      : {}),
  });
  const study = createStudyService({ coordinator, cards: cardStore });
  const tools = buildFlashcardStudyTools({
    getStudyService: async () => study,
  });
  const write = tools.find((tool) => tool.descriptor.name === FLASHCARD_STUDY_WRITE_TOOL_NAME);
  if (!write) throw new Error('write tool missing');
  return { piwinRoot, study, cardStore, write };
}

async function runTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  options?: {
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<ToolResult> {
  const signal = options?.signal ?? new AbortController().signal;
  const context = {
    sessionId: options?.sessionId ?? SESSION_ID,
    runtimeGenerationId: 'gen-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  };
  if (tool.prepareArgs) {
    const prepared = await tool.prepareArgs(args, context, signal);
    if (!prepared.ok) return prepared.result;
    return tool.execute(prepared.arguments, signal, context);
  }
  return tool.execute(args, signal, context);
}

function requireOk(result: ToolResult): string {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
}

function parseSnapshot(result: ToolResult): FlashcardStudySnapshot {
  return JSON.parse(requireOk(result)) as FlashcardStudySnapshot;
}

async function seedScheduledCard(cardStore: ReturnType<typeof createCardStore>) {
  return cardStore.create({ front: 'Capital of France?', back: 'Paris', deck: 'geo' });
}

async function startScheduled(
  write: HostToolRegistration,
  key = 'start-1',
): Promise<FlashcardStudySnapshot> {
  return parseSnapshot(
    await runTool(write, {
      action: 'start',
      idempotencyKey: key,
      mode: 'scheduled',
      scope: { kind: 'all' },
      resumeExisting: true,
    }),
  );
}

describe('flashcard study write guards', () => {
  it('rejects every per-round write on sequence rounds with zero durable side-effects and no push',
    async () => {
      const pushes: HostPush[] = [];
      const world = await openWorld({ onPush: (push) => pushes.push(push) });
      const seqItem = await world.cardStore.create({
        front: 'Seq Q',
        back: 'Seq secret',
        sequenceId: 'seq-guard',
        position: 1,
      });
      const seqOwner = 'device-sequence-owner';
      const seqStart = await world.study.start({
        idempotencyKey: 'seq-guard-start',
        controllerIdentity: seqOwner,
        mode: 'sequence',
        scope: { kind: 'item', itemId: seqItem.id },
        resumeExisting: false,
      });
      expect(seqStart.round.mode).toBe('sequence');
      expect(seqStart.current).toBeTruthy();

      const capture = async () => {
        const coordinator = getOrCreateStudyCoordinator(getFlashcardsRoot(world.piwinRoot));
        const snap = await world.study.get(seqStart.round.roundId, seqOwner);
        const durable = await coordinator.rounds.read(seqStart.round.roundId);
        if (!durable) throw new Error('sequence round missing from store');
        const reviewCards = await world.cardStore.listReviewCards();
        const review: Record<string, { revision: number; reps: number; due?: string }> = {};
        for (const card of reviewCards) {
          const state = await coordinator.reviewStates.read(card.cardId);
          if (state) {
            review[card.cardId] = {
              revision: state.revision ?? 0,
              reps: state.reps ?? 0,
              ...(state.due ? { due: state.due } : {}),
            };
          }
        }
        return {
          controllerIdentity: durable.controllerIdentity,
          controlEpoch: durable.controlEpoch,
          revision: durable.revision,
          status: durable.status,
          face: durable.face,
          currentEntryId: durable.currentEntryId,
          lastAdvanceOperationId: durable.lastAdvanceOperationId,
          counts: snap.counts,
          entryStates: durable.entries.map((entry) => ({
            entryId: entry.entryId,
            state: entry.state,
            needsReview: entry.needsReview,
            reviewStateRevision: entry.reviewStateRevision ?? null,
            contentVersion: entry.contentVersion,
          })),
          review,
        };
      };

      const before = await capture();
      const pushesBefore = pushes.filter((p) => p.type === 'flashcards/study/changed').length;
      const roundId = seqStart.round.roundId;
      const entryId = seqStart.current!.entryId;
      const contentVersion = seqStart.current!.contentVersion;

      const attempts: Array<{ action: string; args: Record<string, unknown> }> = [
        {
          action: 'claim',
          args: {
            action: 'claim',
            idempotencyKey: 'seq-claim',
            roundId,
            expectedRevision: before.revision,
            expectedControlEpoch: before.controlEpoch,
          },
        },
        {
          action: 'checkpoint',
          args: {
            action: 'checkpoint',
            idempotencyKey: 'seq-checkpoint',
            roundId,
            expectedRevision: before.revision,
            controlEpoch: before.controlEpoch,
            entryId,
            contentVersion,
            face: 'answer',
          },
        },
        {
          action: 'rate',
          args: {
            action: 'rate',
            idempotencyKey: 'seq-rate',
            roundId,
            expectedRevision: before.revision,
            controlEpoch: before.controlEpoch,
            entryId,
            contentVersion,
            rating: 'good',
            expectedReviewStateRevision: seqStart.current!.reviewStateRevision ?? 0,
          },
        },
        {
          action: 'undo',
          args: {
            action: 'undo',
            idempotencyKey: 'seq-undo',
            roundId,
            expectedRevision: before.revision,
            controlEpoch: before.controlEpoch,
            targetOperationId: 'anything',
          },
        },
        {
          action: 'pause',
          args: {
            action: 'pause',
            idempotencyKey: 'seq-pause',
            roundId,
            expectedRevision: before.revision,
            controlEpoch: before.controlEpoch,
          },
        },
        {
          action: 'resume',
          args: {
            action: 'resume',
            idempotencyKey: 'seq-resume',
            roundId,
            expectedRevision: before.revision,
            controlEpoch: before.controlEpoch,
          },
        },
        {
          action: 'end',
          args: {
            action: 'end',
            idempotencyKey: 'seq-end',
            roundId,
            expectedRevision: before.revision,
            controlEpoch: before.controlEpoch,
          },
        },
      ];

      for (const attempt of attempts) {
        const result = await runTool(world.write, attempt.args);
        expect(result.ok, attempt.action).toBe(false);
        if (!result.ok) {
          expect(result.code, attempt.action).toBe('invalid-input');
          expect(result.message, attempt.action).toMatch(/scheduled rounds only/i);
        }
        const after = await capture();
        expect(after, attempt.action).toEqual(before);
        const pushesAfter = pushes.filter((p) => p.type === 'flashcards/study/changed').length;
        expect(pushesAfter, attempt.action).toBe(pushesBefore);
      }

      const stillOwned = await world.study.get(roundId, seqOwner);
      expect(stillOwned.round.controllerIdentity).toBe(seqOwner);
      expect(stillOwned.round.controlEpoch).toBe(before.controlEpoch);
      expect(stillOwned.round.revision).toBe(before.revision);
    },
  );

  it('abort while scheduled-mode preflight is resolving invokes no write mutation', async () => {
    const world = await openWorld();
    await seedScheduledCard(world.cardStore);
    const started = await startScheduled(world.write, 'abort-preflight-start');

    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let getEntered = false;
    const originalGet = world.study.get.bind(world.study);
    world.study.get = async (roundId, identity) => {
      getEntered = true;
      await getGate;
      return originalGet(roundId, identity);
    };

    let claimCalled = false;
    const originalClaim = world.study.claim.bind(world.study);
    world.study.claim = async (input) => {
      claimCalled = true;
      return originalClaim(input);
    };

    const aborted = new AbortController();
    const pending = runTool(
      world.write,
      {
        action: 'claim',
        idempotencyKey: 'abort-during-preflight',
        roundId: started.round.roundId,
        expectedRevision: started.round.revision,
        expectedControlEpoch: started.round.controlEpoch,
      },
      { signal: aborted.signal },
    );

    for (let i = 0; i < 200 && !getEntered; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(getEntered).toBe(true);
    aborted.abort();
    releaseGet();

    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'aborted', cancelled: true });
    expect(claimCalled).toBe(false);

    world.study.get = originalGet;
    const after = await world.study.get(started.round.roundId, principalFor());
    expect(after.round.revision).toBe(started.round.revision);
    expect(after.round.controlEpoch).toBe(started.round.controlEpoch);
    expect(after.round.controllerIdentity).toBe(principalFor());
  });

  it('scheduled duplicate-key replay after revision advanced remains once; mismatch payload rejects',
    async () => {
      const pushes: HostPush[] = [];
      const world = await openWorld({ onPush: (push) => pushes.push(push) });
      await seedScheduledCard(world.cardStore);
      const started = await startScheduled(world.write, 'dup-start');

      const pauseKey = 'dup-pause';
      const paused = parseSnapshot(
        await runTool(world.write, {
          action: 'pause',
          idempotencyKey: pauseKey,
          roundId: started.round.roundId,
          expectedRevision: started.round.revision,
          controlEpoch: started.round.controlEpoch,
        }),
      );
      expect(paused.round.status).toBe('paused');
      const pushesAfterPause = pushes.filter((p) => p.type === 'flashcards/study/changed').length;

      // Advance revision with a different key so a naive CAS would be stale.
      const resumed = parseSnapshot(
        await runTool(world.write, {
          action: 'resume',
          idempotencyKey: 'dup-resume',
          roundId: paused.round.roundId,
          expectedRevision: paused.round.revision,
          controlEpoch: paused.round.controlEpoch,
        }),
      );
      expect(resumed.round.revision).toBeGreaterThan(paused.round.revision);
      const pushesAfterResume = pushes.filter((p) => p.type === 'flashcards/study/changed').length;

      // Same key + same payload as original pause: native idempotent replay, no second apply/push.
      const replay = parseSnapshot(
        await runTool(world.write, {
          action: 'pause',
          idempotencyKey: pauseKey,
          roundId: started.round.roundId,
          expectedRevision: started.round.revision,
          controlEpoch: started.round.controlEpoch,
        }),
      );
      expect(replay.round.revision).toBe(paused.round.revision);
      expect(replay.round.status).toBe('paused');
      expect(pushes.filter((p) => p.type === 'flashcards/study/changed')).toHaveLength(
        pushesAfterResume,
      );

      // Same key, different payload → conflict (do not mint a new key).
      const mismatch = await runTool(world.write, {
        action: 'end',
        idempotencyKey: pauseKey,
        roundId: resumed.round.roundId,
        expectedRevision: resumed.round.revision,
        controlEpoch: resumed.round.controlEpoch,
      });
      expect(mismatch.ok).toBe(false);
      if (!mismatch.ok) expect(mismatch.details?.reason).toBe('StudyOperationConflictError');

      // Live state remains the post-resume round (replay does not roll forward again).
      const live = await world.study.get(resumed.round.roundId, principalFor());
      expect(live.round.revision).toBe(resumed.round.revision);
      expect(live.round.status).toBe('active');
      expect(pushes.filter((p) => p.type === 'flashcards/study/changed')).toHaveLength(
        pushesAfterResume,
      );
      expect(pushesAfterPause).toBeGreaterThanOrEqual(1);
    },
  );
});
