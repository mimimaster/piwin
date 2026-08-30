import { describe, expect, it } from 'vitest';
import {
  StudyContentChangedError,
  StudyControlLostError,
  StudyRevisionConflictError,
  StudyUndoConflictError,
  computeFlashcardStudyCounts,
  type FlashcardStudyEntry,
  type FlashcardStudyRound,
  type ReviewState,
} from '@piwin/contracts';
import { expandItemToReviewCards } from './cloze.js';
import { createInitialReviewState } from './scheduler.js';
import { buildScheduledEntries, buildSequenceEntries } from './study-sequence.js';
import { createStudyRound, reduceStudyRound } from './study-round-reducer.js';

const NOW = '2026-08-30T12:00:00.000Z';
const LATER = '2026-08-30T12:01:00.000Z';

function basicItem(id: string, position?: number) {
  return {
    id,
    model: 'basic' as const,
    deck: 'General',
    front: id,
    back: `back-${id}`,
    createdAt: NOW,
    sequenceId: 'seq-1',
    ...(position === undefined ? {} : { position }),
  };
}

function sequenceRound(entries?: FlashcardStudyEntry[]): FlashcardStudyRound {
  const resolved =
    entries ??
    buildSequenceEntries(
      [basicItem('item-1', 1), basicItem('item-2', 2), basicItem('item-3', 3)],
      'cv-1',
    );
  return createStudyRound({
    roundId: 'round-1',
    mode: 'sequence',
    scope: { kind: 'sequence', sequenceId: 'seq-1' },
    entries: resolved,
    controllerIdentity: 'conn-1',
    now: NOW,
  });
}

function scheduledRound(): { round: FlashcardStudyRound; states: Map<string, ReviewState> } {
  const item = {
    id: 'mito',
    model: 'cloze' as const,
    deck: 'General',
    text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
    createdAt: NOW,
  };
  const cards = expandItemToReviewCards(item);
  const states = new Map<string, ReviewState>();
  for (const card of cards) {
    states.set(card.cardId, createInitialReviewState(card.cardId, new Date(NOW)));
  }
  const round = createStudyRound({
    roundId: 'round-sched',
    mode: 'scheduled',
    scope: { kind: 'all' },
    entries: buildScheduledEntries(cards, states, 'cv-1'),
    controllerIdentity: 'conn-1',
    now: NOW,
  });
  return { round, states };
}

describe('createStudyRound counts', () => {
  it('starts the first card at 0 processed and does not fill the bar on the last unrated card', () => {
    const round = sequenceRound();
    const counts = computeFlashcardStudyCounts(round.entries);
    expect(counts).toEqual({ total: 3, processed: 0, invalidated: 0, remaining: 3 });
    expect(round.currentEntryId).toBe(round.entries[0]?.entryId);
    expect(round.face).toBe('question');
  });
});

describe('checkpoint', () => {
  it('flips without incrementing processed and does not become the undo target', () => {
    const started = sequenceRound();
    const flipped = reduceStudyRound(started, {
      type: 'checkpoint',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: started.currentEntryId ?? '',
      contentVersion: 'cv-1',
      face: 'answer',
      needsReview: true,
      now: LATER,
    });
    expect(computeFlashcardStudyCounts(flipped.round.entries).processed).toBe(0);
    expect(flipped.round.face).toBe('answer');
    expect(flipped.round.entries[0]?.needsReview).toBe(true);
    expect(flipped.round.lastAdvanceOperationId).toBeNull();
    expect(flipped.round.revision).toBeGreaterThan(started.revision);
  });
});

describe('next', () => {
  it('does not modify ReviewState and processes each entry at most once', () => {
    const started = sequenceRound();
    const first = reduceStudyRound(started, {
      type: 'next',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: started.currentEntryId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-next-1',
      now: LATER,
    });
    expect(first.reviewState).toBeUndefined();
    expect(computeFlashcardStudyCounts(first.round.entries).processed).toBe(1);
    expect(first.round.currentEntryId).toBe(started.entries[1]?.entryId);
    expect(first.round.face).toBe('question');

    expect(() =>
      reduceStudyRound(first.round, {
        type: 'next',
        expectedRevision: first.round.revision,
        controlEpoch: first.round.controlEpoch,
        entryId: started.entries[0]?.entryId ?? '',
        contentVersion: 'cv-1',
        operationId: 'op-next-repeat',
        now: LATER,
      }),
    ).toThrow(/already processed/i);

    const lastUnrated = first.round;
    const counts = computeFlashcardStudyCounts(lastUnrated.entries);
    expect(counts.remaining).toBe(2);
    expect(counts.processed + counts.remaining).toBe(counts.total);
  });

  it('rejects terminal advance', () => {
    let round = sequenceRound();
    for (const [index, entry] of round.entries.entries()) {
      const result = reduceStudyRound(round, {
        type: 'next',
        expectedRevision: round.revision,
        controlEpoch: round.controlEpoch,
        entryId: entry.entryId,
        contentVersion: 'cv-1',
        operationId: `op-next-${index}`,
        now: LATER,
      });
      round = result.round;
    }
    expect(round.status).toBe('completed');
    expect(computeFlashcardStudyCounts(round.entries).remaining).toBe(0);
    expect(() =>
      reduceStudyRound(round, {
        type: 'next',
        expectedRevision: round.revision,
        controlEpoch: round.controlEpoch,
        entryId: round.currentEntryId ?? '',
        contentVersion: 'cv-1',
        operationId: 'op-too-late',
        now: LATER,
      }),
    ).toThrow(/terminal/i);
  });
});

describe('rate-result', () => {
  it('requires the answer face and does not cross cloze holes', () => {
    const { round, states } = scheduledRound();
    const first = round.entries[0];
    const second = round.entries[1];
    if (!first?.cardId || !second) throw new Error('expected two cloze entries');

    const previous = states.get(first.cardId)!;
    expect(() =>
      reduceStudyRound(round, {
        type: 'rate-result',
        expectedRevision: round.revision,
        controlEpoch: round.controlEpoch,
        entryId: first.entryId,
        contentVersion: 'cv-1',
        rating: 'good',
        expectedReviewStateRevision: 0,
        operationId: 'op-rate-face',
        now: LATER,
        nextReviewState: { ...previous, reps: 1, revision: 1 },
        previousReviewState: previous,
      }),
    ).toThrow(/answer face/i);

    const shown = reduceStudyRound(round, {
      type: 'checkpoint',
      expectedRevision: round.revision,
      controlEpoch: round.controlEpoch,
      entryId: first.entryId,
      contentVersion: 'cv-1',
      face: 'answer',
      now: LATER,
    });
    const rated = reduceStudyRound(shown.round, {
      type: 'rate-result',
      expectedRevision: shown.round.revision,
      controlEpoch: shown.round.controlEpoch,
      entryId: first.entryId,
      contentVersion: 'cv-1',
      rating: 'good',
      expectedReviewStateRevision: 0,
      operationId: 'op-rate-1',
      now: LATER,
      nextReviewState: { ...states.get(first.cardId)!, reps: 1, revision: 1 },
      previousReviewState: states.get(first.cardId)!,
    });
    expect(rated.round.entries[0]?.state).toBe('processed');
    expect(rated.round.entries[1]?.state).toBe('pending');
    expect(rated.round.currentEntryId).toBe(second.entryId);
    expect(rated.reviewState?.cardId).toBe(first.cardId);
    expect(rated.round.entries[1]?.cardId).not.toBe(first.cardId);
  });
});

describe('undo', () => {
  it('reverses the last next, then re-advance does not double-count', () => {
    const started = sequenceRound();
    const advanced = reduceStudyRound(started, {
      type: 'next',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: started.currentEntryId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-next-1',
      now: LATER,
    });
    expect(advanced.undoBefore).toBeDefined();
    const undone = reduceStudyRound(advanced.round, {
      type: 'undo',
      expectedRevision: advanced.round.revision,
      controlEpoch: advanced.round.controlEpoch,
      targetOperationId: 'op-next-1',
      now: LATER,
      before: advanced.undoBefore!,
    });
    expect(undone.round.currentEntryId).toBe(started.currentEntryId);
    expect(computeFlashcardStudyCounts(undone.round.entries).processed).toBe(0);
    expect(undone.round.lastAdvanceOperationId).toBeNull();
    expect(undone.round.revision).toBeGreaterThan(advanced.round.revision);

    const again = reduceStudyRound(undone.round, {
      type: 'next',
      expectedRevision: undone.round.revision,
      controlEpoch: undone.round.controlEpoch,
      entryId: undone.round.currentEntryId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-next-2',
      now: LATER,
    });
    expect(computeFlashcardStudyCounts(again.round.entries).processed).toBe(1);
  });

  it('returns a completed round to in-progress and restores scheduled ReviewState business fields', () => {
    const started = sequenceRound(buildSequenceEntries([basicItem('only', 1)], 'cv-1'));
    const completed = reduceStudyRound(started, {
      type: 'next',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: started.currentEntryId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-last',
      now: LATER,
    });
    expect(completed.round.status).toBe('completed');
    const resumed = reduceStudyRound(completed.round, {
      type: 'undo',
      expectedRevision: completed.round.revision,
      controlEpoch: completed.round.controlEpoch,
      targetOperationId: 'op-last',
      now: LATER,
      before: completed.undoBefore!,
    });
    expect(resumed.round.status).toBe('active');
    expect(computeFlashcardStudyCounts(resumed.round.entries).remaining).toBe(1);

    const { round, states } = scheduledRound();
    const first = round.entries[0];
    if (!first?.cardId) throw new Error('expected cloze entry');
    const shown = reduceStudyRound(round, {
      type: 'checkpoint',
      expectedRevision: round.revision,
      controlEpoch: round.controlEpoch,
      entryId: first.entryId,
      contentVersion: 'cv-1',
      face: 'answer',
      now: LATER,
    });
    const beforeState = states.get(first.cardId)!;
    const rated = reduceStudyRound(shown.round, {
      type: 'rate-result',
      expectedRevision: shown.round.revision,
      controlEpoch: shown.round.controlEpoch,
      entryId: first.entryId,
      contentVersion: 'cv-1',
      rating: 'good',
      expectedReviewStateRevision: 0,
      operationId: 'op-rate-undo',
      now: LATER,
      nextReviewState: { ...beforeState, reps: 1, due: '2026-09-01T00:00:00.000Z', revision: 1 },
      previousReviewState: beforeState,
    });
    const undoneRate = reduceStudyRound(rated.round, {
      type: 'undo',
      expectedRevision: rated.round.revision,
      controlEpoch: rated.round.controlEpoch,
      targetOperationId: 'op-rate-undo',
      now: LATER,
      before: rated.undoBefore!,
    });
    expect(undoneRate.reviewState?.reps).toBe(0);
    expect(undoneRate.reviewState?.due).toBe(beforeState.due);
    expect(undoneRate.reviewState?.revision).toBeGreaterThan(rated.reviewState?.revision ?? 0);
    expect(undoneRate.round.entries[0]?.reviewStateRevision).toBe(undoneRate.reviewState?.revision);
    expect(undoneRate.round.entries[0]?.reviewStateRevision).not.toBe(0);
  });

  it('keeps a later needsReview mark on the new card when undoing the previous next', () => {
    const started = sequenceRound();
    const firstId = started.currentEntryId;
    const advanced = reduceStudyRound(started, {
      type: 'next',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: firstId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-next-1',
      now: LATER,
    });
    const marked = reduceStudyRound(advanced.round, {
      type: 'checkpoint',
      expectedRevision: advanced.round.revision,
      controlEpoch: advanced.round.controlEpoch,
      entryId: advanced.round.currentEntryId ?? '',
      contentVersion: 'cv-1',
      face: 'question',
      needsReview: true,
      now: LATER,
    });
    const secondId = advanced.round.currentEntryId;
    expect(secondId).not.toBe(firstId);
    const undone = reduceStudyRound(marked.round, {
      type: 'undo',
      expectedRevision: marked.round.revision,
      controlEpoch: marked.round.controlEpoch,
      targetOperationId: 'op-next-1',
      now: LATER,
      before: advanced.undoBefore!,
    });
    expect(undone.round.currentEntryId).toBe(firstId);
    expect(undone.round.entries.find((entry) => entry.entryId === firstId)?.state).toBe('pending');
    expect(undone.round.entries.find((entry) => entry.entryId === secondId)?.needsReview).toBe(true);
    expect(undone.round.status).toBe('active');
  });

  it('stays paused when undoing after a later pause', () => {
    const started = sequenceRound();
    const firstId = started.currentEntryId;
    const advanced = reduceStudyRound(started, {
      type: 'next',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: firstId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-next-1',
      now: LATER,
    });
    const paused = reduceStudyRound(advanced.round, {
      type: 'pause',
      expectedRevision: advanced.round.revision,
      controlEpoch: advanced.round.controlEpoch,
      now: LATER,
    });
    const undone = reduceStudyRound(paused.round, {
      type: 'undo',
      expectedRevision: paused.round.revision,
      controlEpoch: paused.round.controlEpoch,
      targetOperationId: 'op-next-1',
      now: LATER,
      before: advanced.undoBefore!,
    });
    expect(undone.round.status).toBe('paused');
    expect(undone.round.currentEntryId).toBe(firstId);
    expect(computeFlashcardStudyCounts(undone.round.entries).processed).toBe(0);
  });

  it('checkpoint and claim do not restore an old controller or rewind versions', () => {
    const started = sequenceRound();
    const advanced = reduceStudyRound(started, {
      type: 'next',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      entryId: started.currentEntryId ?? '',
      contentVersion: 'cv-1',
      operationId: 'op-next-1',
      now: LATER,
    });
    const claimed = reduceStudyRound(advanced.round, {
      type: 'claim',
      expectedRevision: advanced.round.revision,
      expectedControlEpoch: advanced.round.controlEpoch,
      controllerIdentity: 'conn-2',
      now: LATER,
    });
    expect(claimed.round.controllerIdentity).toBe('conn-2');
    expect(claimed.round.controlEpoch).toBeGreaterThan(advanced.round.controlEpoch);
    expect(claimed.round.lastAdvanceOperationId).toBe('op-next-1');

    const undone = reduceStudyRound(claimed.round, {
      type: 'undo',
      expectedRevision: claimed.round.revision,
      controlEpoch: claimed.round.controlEpoch,
      targetOperationId: 'op-next-1',
      now: LATER,
      before: advanced.undoBefore!,
    });
    expect(undone.round.controllerIdentity).toBe('conn-2');
    expect(undone.round.controlEpoch).toBe(claimed.round.controlEpoch);
    expect(undone.round.revision).toBeGreaterThan(claimed.round.revision);
  });
});

describe('validation and terminal guards', () => {
  it('rejects revision/control/content mismatches, missing current entry, and ended advance', () => {
    const started = sequenceRound();
    expect(() =>
      reduceStudyRound(started, {
        type: 'next',
        expectedRevision: started.revision + 1,
        controlEpoch: started.controlEpoch,
        entryId: started.currentEntryId ?? '',
        contentVersion: 'cv-1',
        operationId: 'op-stale',
        now: LATER,
      }),
    ).toThrow(StudyRevisionConflictError);

    expect(() =>
      reduceStudyRound(started, {
        type: 'next',
        expectedRevision: started.revision,
        controlEpoch: started.controlEpoch + 1,
        entryId: started.currentEntryId ?? '',
        contentVersion: 'cv-1',
        operationId: 'op-lost',
        now: LATER,
      }),
    ).toThrow(StudyControlLostError);

    expect(() =>
      reduceStudyRound(started, {
        type: 'next',
        expectedRevision: started.revision,
        controlEpoch: started.controlEpoch,
        entryId: started.currentEntryId ?? '',
        contentVersion: 'cv-stale',
        operationId: 'op-content',
        now: LATER,
      }),
    ).toThrow(StudyContentChangedError);

    const orphan = { ...started, currentEntryId: null };
    expect(() =>
      reduceStudyRound(orphan, {
        type: 'next',
        expectedRevision: orphan.revision,
        controlEpoch: orphan.controlEpoch,
        entryId: 'se-item-1',
        contentVersion: 'cv-1',
        operationId: 'op-missing',
        now: LATER,
      }),
    ).toThrow(/current entry/i);

    const ended = reduceStudyRound(started, {
      type: 'end',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      now: LATER,
    });
    expect(ended.round.status).toBe('ended');
    expect(() =>
      reduceStudyRound(ended.round, {
        type: 'next',
        expectedRevision: ended.round.revision,
        controlEpoch: ended.round.controlEpoch,
        entryId: ended.round.currentEntryId ?? '',
        contentVersion: 'cv-1',
        operationId: 'op-ended',
        now: LATER,
      }),
    ).toThrow(/terminal/i);

    expect(() =>
      reduceStudyRound(ended.round, {
        type: 'undo',
        expectedRevision: ended.round.revision,
        controlEpoch: ended.round.controlEpoch,
        targetOperationId: 'missing',
        now: LATER,
        before: { round: started },
      }),
    ).toThrow(StudyUndoConflictError);
  });

  it('rejects next and rate while paused', () => {
    const started = sequenceRound();
    const paused = reduceStudyRound(started, {
      type: 'pause',
      expectedRevision: started.revision,
      controlEpoch: started.controlEpoch,
      now: LATER,
    });
    expect(() =>
      reduceStudyRound(paused.round, {
        type: 'next',
        expectedRevision: paused.round.revision,
        controlEpoch: paused.round.controlEpoch,
        entryId: paused.round.currentEntryId ?? '',
        contentVersion: 'cv-1',
        operationId: 'op-paused-next',
        now: LATER,
      }),
    ).toThrow(/paused/i);

    const { round, states } = scheduledRound();
    const first = round.entries[0];
    const cardId = first?.cardId;
    if (!first || !cardId) throw new Error('expected cloze entry');
    const previous = states.get(cardId);
    if (!previous) throw new Error('expected review state');
    const shown = reduceStudyRound(round, {
      type: 'checkpoint',
      expectedRevision: round.revision,
      controlEpoch: round.controlEpoch,
      entryId: first.entryId,
      contentVersion: 'cv-1',
      face: 'answer',
      now: LATER,
    });
    const pausedRate = reduceStudyRound(shown.round, {
      type: 'pause',
      expectedRevision: shown.round.revision,
      controlEpoch: shown.round.controlEpoch,
      now: LATER,
    });
    expect(pausedRate.round.currentEntryId).toBe(first.entryId);
    expect(pausedRate.round.face).toBe('answer');
    expect(() =>
      reduceStudyRound(pausedRate.round, {
        type: 'rate-result',
        expectedRevision: pausedRate.round.revision,
        controlEpoch: pausedRate.round.controlEpoch,
        entryId: first.entryId,
        contentVersion: 'cv-1',
        rating: 'good',
        expectedReviewStateRevision: 0,
        operationId: 'op-paused-rate',
        now: LATER,
        nextReviewState: { ...previous, reps: 1, revision: 1 },
        previousReviewState: previous,
      }),
    ).toThrow(/paused/i);
  });

  it('treats invalidated as not learning', () => {
    const started = sequenceRound();
    const invalidated = reduceStudyRound(started, {
      type: 'invalidate',
      entryId: started.currentEntryId ?? '',
      now: LATER,
    });
    const counts = computeFlashcardStudyCounts(invalidated.round.entries);
    expect(counts.invalidated).toBe(1);
    expect(counts.processed).toBe(0);
    expect(counts.remaining).toBe(2);
    expect(invalidated.round.currentEntryId).toBe(started.entries[1]?.entryId);
  });
});
