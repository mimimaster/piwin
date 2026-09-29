import { describe, expect, it } from 'vitest';
import type { TurnChangeSummary } from '@piwin/contracts';
import {
  applyTurnChangeSummaries,
  decodeTurnRunIds,
  EMPTY_TURN_CHANGE_INDEX,
  encodeTurnRunIds,
  selectTurnChangeSummaries,
} from './turn-change-index.js';

function summary(overrides: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'at-1',
    sessionId: 's',
    workspaceId: 'ws',
    userMessageId: null,
    runIds: ['run-1'],
    revision: 1,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 1,
    additions: 1,
    deletions: 0,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    ...overrides,
  };
}

describe('turn change index', () => {
  it('maps runs to change sets and ignores an older revision arriving late', () => {
    let index = applyTurnChangeSummaries(EMPTY_TURN_CHANGE_INDEX, [
      summary({ revision: 2, runIds: ['run-1', 'run-2'] }),
    ]);
    index = applyTurnChangeSummaries(index, [summary({ revision: 1, disposition: 'undone' })]);
    expect(selectTurnChangeSummaries(index, ['run-2'])).toEqual([
      expect.objectContaining({ revision: 2, disposition: 'applied' }),
    ]);
  });

  it('returns every change set a turn produced, oldest first', () => {
    const index = applyTurnChangeSummaries(EMPTY_TURN_CHANGE_INDEX, [
      summary({ changeSetId: 'cs-undone', runIds: ['run-1'], disposition: 'undone' }),
      summary({ changeSetId: 'cs-resumed', runIds: ['run-2'] }),
    ]);
    expect(selectTurnChangeSummaries(index, ['run-1', 'run-2']).map((item) => item.changeSetId)).toEqual([
      'cs-undone',
      'cs-resumed',
    ]);
  });

  it('keeps the same index object when nothing changed', () => {
    const index = applyTurnChangeSummaries(EMPTY_TURN_CHANGE_INDEX, [summary()]);
    expect(applyTurnChangeSummaries(index, [])).toBe(index);
  });

  it('encodes run ids stably without blanks or duplicates', () => {
    const encoded = encodeTurnRunIds(['run-1', undefined, 'run-2', 'run-1']);
    expect(encoded).toBe('run-1\nrun-2');
    expect(decodeTurnRunIds(encoded)).toEqual(['run-1', 'run-2']);
    expect(decodeTurnRunIds(undefined)).toEqual([]);
  });
});
