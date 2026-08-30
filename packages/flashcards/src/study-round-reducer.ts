import {
  FLASHCARD_STUDY_ROUND_SCHEMA_VERSION,
  PiwinError,
  StudyContentChangedError,
  StudyControlLostError,
  StudyRevisionConflictError,
  StudyUndoConflictError,
  reviewStateRevision,
  type FlashcardStudyEntry,
  type FlashcardStudyFace,
  type FlashcardStudyMode,
  type FlashcardStudyRound,
  type FlashcardStudyScope,
  type FlashcardStudyUndoImage,
  type ReviewRating,
  type ReviewState,
} from '@piwin/contracts';

export type StudyRoundAction =
  | {
      type: 'checkpoint';
      expectedRevision: number;
      controlEpoch: number;
      entryId: string;
      contentVersion: string;
      face: FlashcardStudyFace;
      needsReview?: boolean;
      now: string;
    }
  | {
      type: 'next';
      expectedRevision: number;
      controlEpoch: number;
      entryId: string;
      contentVersion: string;
      operationId: string;
      now: string;
    }
  | {
      type: 'rate-result';
      expectedRevision: number;
      controlEpoch: number;
      entryId: string;
      contentVersion: string;
      rating: ReviewRating;
      expectedReviewStateRevision: number;
      operationId: string;
      now: string;
      nextReviewState: ReviewState;
      previousReviewState: ReviewState;
    }
  | {
      type: 'undo';
      expectedRevision: number;
      controlEpoch: number;
      targetOperationId: string;
      now: string;
      before: FlashcardStudyUndoImage;
    }
  | {
      type: 'claim';
      expectedRevision: number;
      expectedControlEpoch: number;
      controllerIdentity: string;
      now: string;
    }
  | { type: 'pause'; expectedRevision: number; controlEpoch: number; now: string }
  | { type: 'resume'; expectedRevision: number; controlEpoch: number; now: string }
  | { type: 'end'; expectedRevision: number; controlEpoch: number; now: string }
  | { type: 'invalidate'; entryId: string; now: string };

export type StudyRoundReducerResult = {
  round: FlashcardStudyRound;
  reviewState?: ReviewState;
  undoBefore?: FlashcardStudyUndoImage;
};

export function createStudyRound(input: {
  roundId: string;
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  entries: FlashcardStudyEntry[];
  controllerIdentity: string;
  now: string;
}): FlashcardStudyRound {
  const current = input.entries.find((entry) => entry.state === 'pending');
  return {
    roundId: input.roundId,
    schemaVersion: FLASHCARD_STUDY_ROUND_SCHEMA_VERSION,
    mode: input.mode,
    scope: input.scope,
    status: 'active',
    revision: 0,
    controlEpoch: 1,
    controllerIdentity: input.controllerIdentity,
    createdAt: input.now,
    updatedAt: input.now,
    entries: input.entries.map(cloneEntry),
    currentEntryId: current?.entryId ?? input.entries[0]?.entryId ?? null,
    face: 'question',
    lastAdvanceOperationId: null,
  };
}

export function reduceStudyRound(
  round: FlashcardStudyRound,
  action: StudyRoundAction,
): StudyRoundReducerResult {
  switch (action.type) {
    case 'checkpoint':
      return applyCheckpoint(round, action);
    case 'next':
      return applyNext(round, action);
    case 'rate-result':
      return applyRateResult(round, action);
    case 'undo':
      return applyUndo(round, action);
    case 'claim':
      return applyClaim(round, action);
    case 'pause':
      return applyPause(round, action);
    case 'resume':
      return applyResume(round, action);
    case 'end':
      return applyEnd(round, action);
    case 'invalidate':
      return applyInvalidate(round, action);
  }
}

function applyCheckpoint(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'checkpoint' }>,
): StudyRoundReducerResult {
  assertNotEnded(round);
  assertRevisionAndControl(round, action.expectedRevision, action.controlEpoch);
  const current = requireCurrentEntry(round);
  assertCurrentEntry(current, action.entryId, action.contentVersion);
  const next = cloneRound(round);
  const entry = requireEntry(next, current.entryId);
  next.face = action.face;
  if (action.needsReview !== undefined) entry.needsReview = action.needsReview;
  bumpRevision(next, action.now);
  return { round: next };
}

function applyNext(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'next' }>,
): StudyRoundReducerResult {
  if (round.mode !== 'sequence') {
    throw invalid('next is only valid in sequence mode');
  }
  return processAdvance(round, action, undefined);
}

function applyRateResult(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'rate-result' }>,
): StudyRoundReducerResult {
  if (round.mode !== 'scheduled') {
    throw invalid('rate is only valid in scheduled mode');
  }
  if (round.face !== 'answer') {
    throw invalid('rate requires the answer face');
  }
  const current = requireCurrentEntry(round);
  const expected = current.reviewStateRevision ?? 0;
  if (action.expectedReviewStateRevision !== expected) {
    throw new StudyRevisionConflictError(
      round.roundId,
      action.expectedReviewStateRevision,
      expected,
    );
  }
  return processAdvance(round, action, {
    nextReviewState: action.nextReviewState,
    previousReviewState: action.previousReviewState,
  });
}

function processAdvance(
  round: FlashcardStudyRound,
  action: {
    expectedRevision: number;
    controlEpoch: number;
    entryId: string;
    contentVersion: string;
    operationId: string;
    now: string;
  },
  review?: { nextReviewState: ReviewState; previousReviewState: ReviewState },
): StudyRoundReducerResult {
  assertCanAdvance(round);
  assertRevisionAndControl(round, action.expectedRevision, action.controlEpoch);
  const target = requireEntry(round, action.entryId);
  if (target.state !== 'pending') {
    throw invalid('entry already processed');
  }
  const current = requireCurrentEntry(round);
  assertCurrentEntry(current, action.entryId, action.contentVersion);
  const undoBefore: FlashcardStudyUndoImage = {
    round: cloneRound(round),
    ...(review ? { reviewState: cloneReviewState(review.previousReviewState) } : {}),
  };
  const next = cloneRound(round);
  const entry = requireEntry(next, current.entryId);
  entry.state = 'processed';
  if (review) {
    entry.reviewStateRevision = reviewStateRevision(review.nextReviewState);
  }
  const following = nextPendingAfter(next.entries, entry.entryId);
  next.currentEntryId = following?.entryId ?? entry.entryId;
  next.face = 'question';
  next.lastAdvanceOperationId = action.operationId;
  if (!next.entries.some((item) => item.state === 'pending')) {
    next.status = 'completed';
  }
  bumpRevision(next, action.now);
  return {
    round: next,
    ...(review ? { reviewState: cloneReviewState(review.nextReviewState) } : {}),
    undoBefore,
  };
}

function applyUndo(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'undo' }>,
): StudyRoundReducerResult {
  if (round.status === 'ended') {
    throw new StudyUndoConflictError(round.roundId, 'round already ended');
  }
  assertRevisionAndControl(round, action.expectedRevision, action.controlEpoch);
  if (!round.lastAdvanceOperationId || round.lastAdvanceOperationId !== action.targetOperationId) {
    throw new StudyUndoConflictError(round.roundId, 'target is not the last advance');
  }
  const before = action.before.round;
  const restored = cloneRound(round);
  restored.currentEntryId = before.currentEntryId;
  restored.face = before.face;
  restored.lastAdvanceOperationId = null;
  restored.controllerIdentity = round.controllerIdentity;
  restored.controlEpoch = round.controlEpoch;
  restoreUndoneEntry(restored, before);
  restored.status = round.status === 'completed' ? 'active' : round.status;
  bumpRevision(restored, action.now);

  let reviewState: ReviewState | undefined;
  if (action.before.reviewState) {
    const ratedEntry = round.entries.find((entry) => entry.entryId === before.currentEntryId);
    reviewState = restoreReviewStateBusiness(
      action.before.reviewState,
      (ratedEntry?.reviewStateRevision ?? reviewStateRevision(action.before.reviewState)) + 1,
    );
  }
  return { round: restored, ...(reviewState ? { reviewState } : {}) };
}

function applyClaim(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'claim' }>,
): StudyRoundReducerResult {
  assertNotEnded(round);
  if (action.expectedRevision !== round.revision) {
    throw new StudyRevisionConflictError(round.roundId, action.expectedRevision, round.revision);
  }
  if (action.expectedControlEpoch !== round.controlEpoch) {
    throw new StudyControlLostError(round.roundId);
  }
  const next = cloneRound(round);
  next.controllerIdentity = action.controllerIdentity;
  next.controlEpoch += 1;
  bumpRevision(next, action.now);
  return { round: next };
}

function applyPause(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'pause' }>,
): StudyRoundReducerResult {
  assertNotTerminal(round);
  assertRevisionAndControl(round, action.expectedRevision, action.controlEpoch);
  const next = cloneRound(round);
  next.status = 'paused';
  bumpRevision(next, action.now);
  return { round: next };
}

function applyResume(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'resume' }>,
): StudyRoundReducerResult {
  assertNotEnded(round);
  assertRevisionAndControl(round, action.expectedRevision, action.controlEpoch);
  if (round.status !== 'paused' && round.status !== 'active') {
    throw invalid('resume is not allowed in a terminal round');
  }
  const next = cloneRound(round);
  next.status = 'active';
  bumpRevision(next, action.now);
  return { round: next };
}

function applyEnd(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'end' }>,
): StudyRoundReducerResult {
  assertNotEnded(round);
  assertRevisionAndControl(round, action.expectedRevision, action.controlEpoch);
  const next = cloneRound(round);
  next.status = 'ended';
  bumpRevision(next, action.now);
  return { round: next };
}

function applyInvalidate(
  round: FlashcardStudyRound,
  action: Extract<StudyRoundAction, { type: 'invalidate' }>,
): StudyRoundReducerResult {
  const next = cloneRound(round);
  const entry = requireEntry(next, action.entryId);
  if (entry.state === 'pending') {
    entry.state = 'invalidated';
  }
  if (next.currentEntryId === entry.entryId) {
    const following = nextPendingAfter(next.entries, entry.entryId);
    next.currentEntryId = following?.entryId ?? entry.entryId;
    next.face = 'question';
  }
  if (!next.entries.some((item) => item.state === 'pending')) {
    next.status = next.status === 'ended' ? 'ended' : 'completed';
  }
  bumpRevision(next, action.now);
  return { round: next };
}

function nextPendingAfter(
  entries: readonly FlashcardStudyEntry[],
  entryId: string,
): FlashcardStudyEntry | undefined {
  const index = entries.findIndex((entry) => entry.entryId === entryId);
  for (let cursor = index + 1; cursor < entries.length; cursor += 1) {
    const entry = entries[cursor];
    if (entry?.state === 'pending') return entry;
  }
  return undefined;
}

function assertRevisionAndControl(
  round: FlashcardStudyRound,
  expectedRevision: number,
  controlEpoch: number,
): void {
  if (expectedRevision !== round.revision) {
    throw new StudyRevisionConflictError(round.roundId, expectedRevision, round.revision);
  }
  if (controlEpoch !== round.controlEpoch) {
    throw new StudyControlLostError(round.roundId);
  }
}

function restoreUndoneEntry(round: FlashcardStudyRound, before: FlashcardStudyRound): void {
  const undoneId = before.currentEntryId;
  if (!undoneId) return;
  const beforeEntry = before.entries.find((entry) => entry.entryId === undoneId);
  const currentEntry = round.entries.find((entry) => entry.entryId === undoneId);
  if (!beforeEntry || !currentEntry) return;
  currentEntry.state = beforeEntry.state;
  if (beforeEntry.reviewStateRevision !== undefined) {
    currentEntry.reviewStateRevision = beforeEntry.reviewStateRevision;
  } else {
    delete currentEntry.reviewStateRevision;
  }
}

function assertCanAdvance(round: FlashcardStudyRound): void {
  if (round.status === 'paused') {
    throw invalid('paused round rejects further advance');
  }
  assertNotTerminal(round);
}

function assertNotTerminal(round: FlashcardStudyRound): void {
  if (round.status === 'completed' || round.status === 'ended') {
    throw invalid('terminal round rejects further advance');
  }
}

function assertNotEnded(round: FlashcardStudyRound): void {
  if (round.status === 'ended') {
    throw invalid('terminal round rejects further advance');
  }
}

function requireCurrentEntry(round: FlashcardStudyRound): FlashcardStudyEntry {
  if (!round.currentEntryId) {
    throw invalid('current entry is missing from the round');
  }
  const current = round.entries.find((entry) => entry.entryId === round.currentEntryId);
  if (!current) {
    throw invalid('current entry is missing from the round');
  }
  return current;
}

function requireEntry(round: FlashcardStudyRound, entryId: string): FlashcardStudyEntry {
  const entry = round.entries.find((item) => item.entryId === entryId);
  if (!entry) {
    throw invalid('current entry is missing from the round');
  }
  return entry;
}

function assertCurrentEntry(
  current: FlashcardStudyEntry,
  entryId: string,
  contentVersion: string,
): void {
  if (current.entryId !== entryId) {
    throw invalid('command entryId is not the current entry');
  }
  if (current.contentVersion !== contentVersion) {
    throw new StudyContentChangedError(current.entryId);
  }
}

function bumpRevision(round: FlashcardStudyRound, now: string): void {
  round.revision += 1;
  round.updatedAt = now;
}

function cloneRound(round: FlashcardStudyRound): FlashcardStudyRound {
  return {
    ...round,
    scope: cloneScope(round.scope),
    entries: round.entries.map(cloneEntry),
  };
}

function cloneScope(scope: FlashcardStudyScope): FlashcardStudyScope {
  if (scope.kind === 'selection') {
    return { kind: 'selection', parentRoundId: scope.parentRoundId, itemIds: [...scope.itemIds] };
  }
  return { ...scope };
}

function cloneEntry(entry: FlashcardStudyEntry): FlashcardStudyEntry {
  return { ...entry };
}

function cloneReviewState(state: ReviewState): ReviewState {
  return { ...state };
}

function restoreReviewStateBusiness(restored: ReviewState, revision: number): ReviewState {
  const next: ReviewState = {
    cardId: restored.cardId,
    due: restored.due,
    stability: restored.stability,
    difficulty: restored.difficulty,
    reps: restored.reps,
    lapses: restored.lapses,
    revision,
  };
  if (restored.lastReviewedAt) next.lastReviewedAt = restored.lastReviewedAt;
  return next;
}

function invalid(message: string): PiwinError {
  return new PiwinError('StudyInvalidCommandError', message, { category: 'validation' });
}
