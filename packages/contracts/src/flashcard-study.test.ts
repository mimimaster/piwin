import { describe, expect, it } from 'vitest';
import type { HostCommand, HostPush } from './ipc.js';
import { remoteCommandRequiresIdempotencyKey } from './remote-idempotency.js';
import type { ReviewState } from './flashcards.js';
import { reviewStateRevision } from './flashcards.js';
import {
  FLASHCARD_STUDY_ROUND_SCHEMA_VERSION,
  StudyContentChangedError,
  StudyControlLostError,
  StudyOperationConflictError,
  StudyRevisionConflictError,
  StudyRoundNotFoundError,
  StudyStorageError,
  StudyUndoConflictError,
  isFlashcardStudyModeScopeCompatible,
  validateFlashcardStudyCounts,
  validateFlashcardStudyRound,
  type FlashcardStudyRound,
} from './flashcard-study.js';
import {
  FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT,
  FLASHCARD_STUDY_CATALOG_MAX_LIMIT,
  FLASHCARD_STUDY_COMMAND_TYPES,
  FLASHCARD_STUDY_MUTATION_TYPES,
  parseFlashcardStudyCommand,
} from './flashcard-study-commands.js';

const NOW = '2026-08-30T12:00:00.000Z';

function round(overrides: Partial<FlashcardStudyRound> = {}): FlashcardStudyRound {
  return {
    roundId: 'round-1',
    schemaVersion: FLASHCARD_STUDY_ROUND_SCHEMA_VERSION,
    mode: 'sequence',
    scope: { kind: 'item', itemId: 'item-1' },
    status: 'active',
    revision: 1,
    controlEpoch: 1,
    controllerIdentity: 'conn-1',
    createdAt: NOW,
    updatedAt: NOW,
    entries: [
      {
        entryId: 'entry-1',
        itemId: 'item-1',
        contentVersion: 'cv-1',
        state: 'pending',
        needsReview: false,
      },
    ],
    currentEntryId: 'entry-1',
    face: 'question',
    lastAdvanceOperationId: null,
    ...overrides,
  };
}

describe('ReviewState.revision', () => {
  it('defaults missing revision to 0', () => {
    const legacy: ReviewState = {
      cardId: 'card-1',
      due: NOW,
      stability: 0,
      difficulty: 0,
      reps: 0,
      lapses: 0,
    };
    expect(legacy.revision).toBeUndefined();
    expect(reviewStateRevision(legacy)).toBe(0);
    expect(reviewStateRevision({ ...legacy, revision: 4 })).toBe(4);
  });
});

describe('mode-scope compatibility', () => {
  it('allows sequence item / sequence / selection only', () => {
    expect(isFlashcardStudyModeScopeCompatible('sequence', { kind: 'item', itemId: 'item-1' })).toBe(
      true,
    );
    expect(
      isFlashcardStudyModeScopeCompatible('sequence', { kind: 'sequence', sequenceId: 'seq-1' }),
    ).toBe(true);
    expect(
      isFlashcardStudyModeScopeCompatible('sequence', {
        kind: 'selection',
        parentRoundId: 'round-1',
        itemIds: ['item-1'],
      }),
    ).toBe(true);
    expect(isFlashcardStudyModeScopeCompatible('sequence', { kind: 'all' })).toBe(false);
    expect(isFlashcardStudyModeScopeCompatible('sequence', { kind: 'deck', deck: 'srs' })).toBe(
      false,
    );
  });

  it('allows scheduled all / deck only', () => {
    expect(isFlashcardStudyModeScopeCompatible('scheduled', { kind: 'all' })).toBe(true);
    expect(isFlashcardStudyModeScopeCompatible('scheduled', { kind: 'deck', deck: 'srs' })).toBe(
      true,
    );
    expect(isFlashcardStudyModeScopeCompatible('scheduled', { kind: 'item', itemId: 'item-1' })).toBe(
      false,
    );
    expect(
      isFlashcardStudyModeScopeCompatible('scheduled', { kind: 'sequence', sequenceId: 'seq-1' }),
    ).toBe(false);
    expect(
      isFlashcardStudyModeScopeCompatible('scheduled', {
        kind: 'selection',
        parentRoundId: 'round-1',
        itemIds: ['item-1'],
      }),
    ).toBe(false);
  });
});

describe('parseFlashcardStudyCommand', () => {
  it('parses every flashcards/study/* command', () => {
    const catalog = parseFlashcardStudyCommand({
      type: 'flashcards/study/catalog',
      query: 'cache',
      limit: 20,
    });
    expect(catalog).toEqual({
      ok: true,
      value: { type: 'flashcards/study/catalog', query: 'cache', limit: 20 },
    });

    const start = parseFlashcardStudyCommand({
      type: 'flashcards/study/start',
      mode: 'sequence',
      scope: { kind: 'item', itemId: 'item-1' },
    });
    expect(start).toEqual({
      ok: true,
      value: {
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'item', itemId: 'item-1' },
        resumeExisting: true,
      },
    });

    for (const type of [
      'flashcards/study/get',
      'flashcards/study/claim',
      'flashcards/study/checkpoint',
      'flashcards/study/next',
      'flashcards/study/rate',
      'flashcards/study/undo',
      'flashcards/study/pause',
      'flashcards/study/resume',
      'flashcards/study/end',
      'flashcards/study/operation',
    ] as const) {
      expect(FLASHCARD_STUDY_COMMAND_TYPES).toContain(type);
    }
  });

  it('rejects illegal mode-scope combinations', () => {
    const sequenceAll = parseFlashcardStudyCommand({
      type: 'flashcards/study/start',
      mode: 'sequence',
      scope: { kind: 'all' },
    });
    expect(sequenceAll.ok).toBe(false);
    if (!sequenceAll.ok) expect(sequenceAll.error).toMatch(/mode-scope/i);

    const scheduledItem = parseFlashcardStudyCommand({
      type: 'flashcards/study/start',
      mode: 'scheduled',
      scope: { kind: 'item', itemId: 'item-1' },
    });
    expect(scheduledItem.ok).toBe(false);
  });

  it('rejects illegal ratings', () => {
    const parsed = parseFlashcardStudyCommand({
      type: 'flashcards/study/rate',
      roundId: 'round-1',
      expectedRevision: 1,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      rating: 'maybe',
      expectedReviewStateRevision: 0,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/rating/i);
  });

  it('rejects path-like ids, cursors, and decks', () => {
    expect(
      parseFlashcardStudyCommand({
        type: 'flashcards/study/get',
        roundId: '../secret',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyCommand({
        type: 'flashcards/study/get',
        roundId: 'rounds/round-1',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyCommand({
        type: 'flashcards/study/catalog',
        cursor: '..\\tiles',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyCommand({
        type: 'flashcards/study/start',
        mode: 'scheduled',
        scope: { kind: 'deck', deck: '../../etc' },
      }).ok,
    ).toBe(false);
  });

  it('clamps catalog limit to the Host ceiling', () => {
    const omitted = parseFlashcardStudyCommand({ type: 'flashcards/study/catalog' });
    expect(omitted).toEqual({
      ok: true,
      value: { type: 'flashcards/study/catalog', limit: FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT },
    });

    const tooBig = parseFlashcardStudyCommand({
      type: 'flashcards/study/catalog',
      limit: 10_000,
    });
    expect(tooBig).toEqual({
      ok: true,
      value: { type: 'flashcards/study/catalog', limit: FLASHCARD_STUDY_CATALOG_MAX_LIMIT },
    });

    const zero = parseFlashcardStudyCommand({ type: 'flashcards/study/catalog', limit: 0 });
    expect(zero.ok).toBe(false);
  });

  it('parses checkpoint / next / rate public fields', () => {
    const checkpoint = parseFlashcardStudyCommand({
      type: 'flashcards/study/checkpoint',
      roundId: 'round-1',
      expectedRevision: 2,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      face: 'answer',
      needsReview: true,
    });
    expect(checkpoint).toEqual({
      ok: true,
      value: {
        type: 'flashcards/study/checkpoint',
        roundId: 'round-1',
        expectedRevision: 2,
        controlEpoch: 1,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
        face: 'answer',
        needsReview: true,
      },
    });

    const rate = parseFlashcardStudyCommand({
      type: 'flashcards/study/rate',
      roundId: 'round-1',
      expectedRevision: 2,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      rating: 'good',
      expectedReviewStateRevision: 0,
    });
    expect(rate.ok).toBe(true);
  });
});

describe('round and count validation', () => {
  it('rejects out-of-range counts', () => {
    expect(validateFlashcardStudyCounts({ total: 3, processed: 2, invalidated: 2, remaining: -1 })).toEqual(
      expect.arrayContaining([expect.stringMatching(/remaining/i)]),
    );
    expect(validateFlashcardStudyCounts({ total: 2, processed: 3, invalidated: 0, remaining: 0 })).toEqual(
      expect.arrayContaining([expect.stringMatching(/processed/i)]),
    );
    expect(validateFlashcardStudyCounts({ total: 2, processed: 1, invalidated: 0, remaining: 1 })).toEqual(
      [],
    );
  });

  it('rejects a missing current entry', () => {
    const issues = validateFlashcardStudyRound(
      round({ currentEntryId: 'entry-missing' }),
    );
    expect(issues.some((issue) => /current entry/i.test(issue))).toBe(true);
  });

  it('accepts a well-formed active round', () => {
    expect(validateFlashcardStudyRound(round())).toEqual([]);
  });
});

describe('stable study errors', () => {
  it('exposes the spec error names', () => {
    expect(new StudyRoundNotFoundError('round-1').name).toBe('StudyRoundNotFoundError');
    expect(new StudyRevisionConflictError('round-1', 1, 2).name).toBe('StudyRevisionConflictError');
    expect(new StudyControlLostError('round-1').name).toBe('StudyControlLostError');
    expect(new StudyContentChangedError('entry-1').name).toBe('StudyContentChangedError');
    expect(new StudyUndoConflictError('round-1').name).toBe('StudyUndoConflictError');
    expect(new StudyOperationConflictError('key-1').name).toBe('StudyOperationConflictError');
    expect(new StudyStorageError('disk full').name).toBe('StudyStorageError');
  });
});

describe('IPC wiring', () => {
  it('accepts study commands on HostCommand and the changed push', () => {
    const command: HostCommand = {
      type: 'flashcards/study/start',
      mode: 'scheduled',
      scope: { kind: 'all' },
      resumeExisting: true,
    };
    const push: HostPush = {
      type: 'flashcards/study/changed',
      roundId: 'round-1',
      revision: 3,
      reason: 'rate',
    };
    expect(command.type).toBe('flashcards/study/start');
    expect(push.type).toBe('flashcards/study/changed');
  });

  it('requires an idempotency key for study mutations, not catalog/get/operation', () => {
    for (const type of FLASHCARD_STUDY_MUTATION_TYPES) {
      expect(remoteCommandRequiresIdempotencyKey(type)).toBe(true);
    }
    expect(remoteCommandRequiresIdempotencyKey('flashcards/study/catalog')).toBe(false);
    expect(remoteCommandRequiresIdempotencyKey('flashcards/study/get')).toBe(false);
    expect(remoteCommandRequiresIdempotencyKey('flashcards/study/operation')).toBe(false);
  });
});
