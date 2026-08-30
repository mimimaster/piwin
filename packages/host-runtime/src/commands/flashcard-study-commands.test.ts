import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStudyServices, resetStudyCoordinatorsForTests } from '@piwin/flashcards';
import type { HostResponse } from '@piwin/contracts';
import {
  handleFlashcardStudyCommand,
  sanitizeCatalogPage,
  toStudyChangedPush,
  type FlashcardStudyCommandContext,
} from './flashcard-study-commands.js';
import { isKnowledgeCommand } from './knowledge-commands.js';

const IDENTITY = 'device-a';
const OTHER = 'device-b';
const roots: string[] = [];

afterEach(async () => {
  resetStudyCoordinatorsForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function openContext(
  identity = IDENTITY,
  idempotencyKey?: string,
): Promise<FlashcardStudyCommandContext & { piwinRoot: string }> {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-study-host-'));
  roots.push(piwinRoot);
  const services = createStudyServices({ piwinRoot });
  return {
    piwinRoot,
    getStudyService: async () => services.study,
    controllerIdentity: identity,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function dataOf(response: HostResponse | null): Record<string, unknown> {
  if (!response || !response.success || !response.data || typeof response.data !== 'object') {
    throw new Error(`expected success data, got ${JSON.stringify(response)}`);
  }
  return response.data as Record<string, unknown>;
}

describe('flashcard study host commands', () => {
  it('does not dump study types into knowledge routing', () => {
    expect(isKnowledgeCommand({ type: 'flashcards/study/catalog', limit: 20 })).toBe(false);
    expect(isKnowledgeCommand({ type: 'flashcards/decks' })).toBe(true);
  });

  it('global push payload is summary-only', () => {
    const push = toStudyChangedPush({ roundId: 'round-1', revision: 3, reason: 'next' });
    expect(push).toEqual({
      type: 'flashcards/study/changed',
      roundId: 'round-1',
      revision: 3,
      reason: 'next',
    });
    expect(JSON.stringify(push)).not.toMatch(/front|back|source/);
  });

  it('start resumeExisting returns the same unfinished round', async () => {
    const context = await openContext();
    const store = createStudyServices({ piwinRoot: context.piwinRoot }).cardStore;
    const item = await store.create({
      front: 'Q1',
      back: 'secret-answer',
      sequenceId: 'seq-1',
      position: 1,
    });
    await store.create({ front: 'Q2', back: 'A2', sequenceId: 'seq-1', position: 2 });

    const started = await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq-1' },
        resumeExisting: true,
      },
      'r2',
      { ...context, idempotencyKey: 'start-seq' },
    );
    const firstData = dataOf(started);
    const round = firstData.round as { roundId: string; revision: number };
    expect(round.roundId).toMatch(/^round-/);
    expect((firstData.current as { itemId: string }).itemId).toBe(item.id);

    const resumed = await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq-1' },
        resumeExisting: true,
      },
      'r3',
      { ...context, idempotencyKey: 'start-seq-2' },
    );
    expect((dataOf(resumed).round as { roundId: string }).roundId).toBe(round.roundId);
  });

  it('claim raises epoch and rejects the previous controller', async () => {
    const context = await openContext(IDENTITY, 'start-claim');
    const store = createStudyServices({ piwinRoot: context.piwinRoot }).cardStore;
    const item = await store.create({ front: 'Q', back: 'A' });
    const started = dataOf(
      await handleFlashcardStudyCommand(
        {
          type: 'flashcards/study/start',
          mode: 'sequence',
          scope: { kind: 'item', itemId: item.id },
          resumeExisting: true,
        },
        'r1',
        { ...context, controllerIdentity: IDENTITY, idempotencyKey: 'start-claim' },
      ),
    );
    const round = started.round as { roundId: string; revision: number; controlEpoch: number };
    const current = started.current as { entryId: string; contentVersion: string };

    const claimed = dataOf(
      await handleFlashcardStudyCommand(
        {
          type: 'flashcards/study/claim',
          roundId: round.roundId,
          expectedRevision: round.revision,
          expectedControlEpoch: round.controlEpoch,
        },
        'r2',
        { ...context, controllerIdentity: OTHER, idempotencyKey: 'claim-1' },
      ),
    );
    const claimedRound = claimed.round as { controlEpoch: number; revision: number };
    expect(claimedRound.controlEpoch).toBe(round.controlEpoch + 1);

    const rejected = await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/next',
        roundId: round.roundId,
        expectedRevision: claimedRound.revision,
        controlEpoch: round.controlEpoch,
        entryId: current.entryId,
        contentVersion: current.contentVersion,
      },
      'r3',
      { ...context, controllerIdentity: IDENTITY, idempotencyKey: 'next-stale-epoch' },
    );
    expect(rejected?.success).toBe(false);
    expect(rejected && 'problem' in rejected ? rejected.problem?.code : undefined).toBe(
      'StudyControlLostError',
    );
  });

  it('rejects a stale expectedRevision', async () => {
    const context = await openContext(IDENTITY, 'start-rev');
    const store = createStudyServices({ piwinRoot: context.piwinRoot }).cardStore;
    const item = await store.create({ front: 'Q1', back: 'A1', sequenceId: 'seq', position: 1 });
    await store.create({ front: 'Q2', back: 'A2', sequenceId: 'seq', position: 2 });
    const started = dataOf(
      await handleFlashcardStudyCommand(
        {
          type: 'flashcards/study/start',
          mode: 'sequence',
          scope: { kind: 'sequence', sequenceId: 'seq' },
          resumeExisting: true,
        },
        'r1',
        { ...context, idempotencyKey: 'start-rev' },
      ),
    );
    const round = started.round as { roundId: string; revision: number; controlEpoch: number };
    const current = started.current as { entryId: string; contentVersion: string; itemId: string };
    expect(current.itemId).toBe(item.id);

    await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/next',
        roundId: round.roundId,
        expectedRevision: round.revision,
        controlEpoch: round.controlEpoch,
        entryId: current.entryId,
        contentVersion: current.contentVersion,
      },
      'r2',
      { ...context, idempotencyKey: 'next-1' },
    );

    const stale = await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/next',
        roundId: round.roundId,
        expectedRevision: round.revision,
        controlEpoch: round.controlEpoch,
        entryId: current.entryId,
        contentVersion: current.contentVersion,
      },
      'r3',
      { ...context, idempotencyKey: 'next-stale-rev' },
    );
    expect(stale?.success).toBe(false);
    expect(stale && 'problem' in stale ? stale.problem?.code : undefined).toBe(
      'StudyRevisionConflictError',
    );
  });

  it('retries the same key and payload as the original result', async () => {
    const context = await openContext(IDENTITY, 'start-idemp');
    const store = createStudyServices({ piwinRoot: context.piwinRoot }).cardStore;
    await store.create({ front: 'Q1', back: 'A1', sequenceId: 'seq', position: 1 });
    await store.create({ front: 'Q2', back: 'A2', sequenceId: 'seq', position: 2 });
    const started = dataOf(
      await handleFlashcardStudyCommand(
        {
          type: 'flashcards/study/start',
          mode: 'sequence',
          scope: { kind: 'sequence', sequenceId: 'seq' },
          resumeExisting: true,
        },
        'r1',
        { ...context, idempotencyKey: 'start-idemp' },
      ),
    );
    const round = started.round as { roundId: string; revision: number; controlEpoch: number };
    const current = started.current as { entryId: string; contentVersion: string };
    const command = {
      type: 'flashcards/study/next' as const,
      roundId: round.roundId,
      expectedRevision: round.revision,
      controlEpoch: round.controlEpoch,
      entryId: current.entryId,
      contentVersion: current.contentVersion,
    };
    const first = dataOf(
      await handleFlashcardStudyCommand(command, 'r2', { ...context, idempotencyKey: 'next-same' }),
    );
    const retry = dataOf(
      await handleFlashcardStudyCommand(command, 'r3', { ...context, idempotencyKey: 'next-same' }),
    );
    expect(retry).toEqual(first);

    const lookup = dataOf(
      await handleFlashcardStudyCommand(
        { type: 'flashcards/study/operation', idempotencyKey: 'next-same' },
        'r4',
        context,
      ),
    );
    expect(lookup.status).toBe('success');
    expect(lookup.snapshot).toEqual(first);
  });

  it('catalog omits Host absolute paths and answers', async () => {
    const context = await openContext();
    const store = createStudyServices({ piwinRoot: context.piwinRoot }).cardStore;
    await store.create({
      front: 'What is mitosis?',
      back: 'cell-division-answer-must-not-leak',
      sourceFile: '/Users/secret/notes.md',
      sourceFolder: '/Users/secret',
    });
    const response = await handleFlashcardStudyCommand(
      { type: 'flashcards/study/catalog', limit: 20 },
      'r1',
      context,
    );
    const page = dataOf(response);
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('/Users/secret');
    expect(serialized).not.toContain('cell-division-answer-must-not-leak');
    expect(serialized).not.toContain('"sourceFile"');
    const sanitized = sanitizeCatalogPage({
      tiles: [
        {
          kind: 'single',
          id: 'x',
          count: 1,
          preview: 'What is mitosis?',
        },
      ],
      dueCount: 0,
      newCount: 1,
      unfinishedRounds: [],
    });
    expect(sanitized.tiles[0]?.preview).toBe('What is mitosis?');
  });

  it('operation lookup is principal-scoped and sanitizes snapshots', async () => {
    const context = await openContext(IDENTITY, 'start-op');
    const store = createStudyServices({ piwinRoot: context.piwinRoot }).cardStore;
    await store.create({
      front: 'owner-question',
      back: 'owner-answer-secret',
      sequenceId: 'seq',
      position: 1,
    });
    await store.create({ front: 'Q2', back: 'A2', sequenceId: 'seq', position: 2 });
    const started = dataOf(
      await handleFlashcardStudyCommand(
        {
          type: 'flashcards/study/start',
          mode: 'sequence',
          scope: { kind: 'sequence', sequenceId: 'seq' },
          resumeExisting: true,
        },
        'r1',
        { ...context, idempotencyKey: 'start-op' },
      ),
    );
    const round = started.round as { roundId: string; revision: number; controlEpoch: number };
    const current = started.current as { entryId: string; contentVersion: string };
    await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/next',
        roundId: round.roundId,
        expectedRevision: round.revision,
        controlEpoch: round.controlEpoch,
        entryId: current.entryId,
        contentVersion: current.contentVersion,
      },
      'r2',
      { ...context, idempotencyKey: 'next-owned' },
    );

    const owner = dataOf(
      await handleFlashcardStudyCommand(
        { type: 'flashcards/study/operation', idempotencyKey: 'next-owned' },
        'r3',
        { ...context, controllerIdentity: IDENTITY },
      ),
    );
    expect(owner.status).toBe('success');

    const other = await handleFlashcardStudyCommand(
      { type: 'flashcards/study/operation', idempotencyKey: 'next-owned' },
      'r4',
      { ...context, controllerIdentity: OTHER },
    );
    const otherData = dataOf(other);
    expect(otherData.status).toBe('not-found');
    const serialized = JSON.stringify(other);
    expect(serialized).not.toContain('owner-question');
    expect(serialized).not.toContain('owner-answer-secret');
  });

  it('mutations without an envelope key fail closed', async () => {
    const context = await openContext(IDENTITY);
    const response = await handleFlashcardStudyCommand(
      {
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'item', itemId: 'item-1' },
        resumeExisting: true,
      },
      'r1',
      context,
    );
    expect(response?.success).toBe(false);
    expect(response && 'problem' in response ? response.problem?.code : undefined).toBe(
      'idempotency-key-required',
    );
  });
});
