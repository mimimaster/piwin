import { describe, expect, it } from 'vitest';
import { emptySubagentResultReviewFields, type SubagentResultSummary } from '@piwin/contracts';
import {
  PIWIN_REVIEW_PROVENANCE_MARKER,
  bindSubagentReviewTarget,
  formatSubagentReviewProvenanceBlock,
  isExactReviewTarget,
} from './subagent-review-context.js';

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-child', revision: 1 },
    appliedChanges: null,
    copyState: 'present',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
    ...overrides,
  };
}

describe('bindSubagentReviewTarget', () => {
  const target = { resultId: 'result-1', revision: 1 };

  it('freezes the exact result and change version for a readonly role', () => {
    const bound = bindSubagentReviewTarget({
      parentSessionId: 'parent-1',
      reviewOf: target,
      resolvedIsolation: 'readonly',
      role: 'reviewer',
      getResult: () => makeSummary(),
    });
    expect(bound).toEqual({
      ok: true,
      target: {
        result: { resultId: 'result-1', revision: 1 },
        changes: { changeSetId: 'cs-child', revision: 1 },
      },
    });
  });

  it('rejects missing role or worktree isolation', () => {
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: target,
        resolvedIsolation: 'readonly',
        getResult: () => makeSummary(),
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: target,
        resolvedIsolation: 'worktree',
        role: 'reviewer',
        getResult: () => makeSummary(),
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('rejects missing, foreign, stale, and expired candidates', () => {
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: target,
        resolvedIsolation: 'readonly',
        role: 'reviewer',
        getResult: () => undefined,
      }),
    ).toMatchObject({ ok: false, code: 'review-target-not-found' });
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: { resultId: 'result-1', revision: 2 },
        resolvedIsolation: 'readonly',
        role: 'reviewer',
        getResult: () => makeSummary(),
      }),
    ).toMatchObject({ ok: false, code: 'stale-revision' });
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: target,
        resolvedIsolation: 'readonly',
        role: 'reviewer',
        getResult: () => makeSummary({ parentSessionId: 'other' }),
      }),
    ).toMatchObject({ ok: false, code: 'review-target-forbidden' });
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: target,
        resolvedIsolation: 'readonly',
        role: 'reviewer',
        getResult: () => makeSummary({ childChanges: null }),
      }),
    ).toMatchObject({ ok: false, code: 'review-data-expired' });
    expect(
      bindSubagentReviewTarget({
        parentSessionId: 'parent-1',
        reviewOf: target,
        resolvedIsolation: 'readonly',
        role: 'reviewer',
        getResult: () => makeSummary(),
        hasFrozenChanges: () => false,
      }),
    ).toMatchObject({ ok: false, code: 'review-data-expired' });
  });
});

describe('review provenance', () => {
  it('labels Host-authored evidence without treating it as user text', () => {
    const block = formatSubagentReviewProvenanceBlock({
      result: { resultId: 'result-1', revision: 1 },
      changes: { changeSetId: 'cs-child', revision: 1 },
    });
    expect(block.startsWith(PIWIN_REVIEW_PROVENANCE_MARKER)).toBe(true);
    expect(block).toContain('not user text');
    expect(block).toContain('resultId=result-1');
    expect(isExactReviewTarget({ resultId: 'result-1', revision: 1 }, { resultId: 'result-1', revision: 1 })).toBe(
      true,
    );
    expect(isExactReviewTarget({ resultId: 'result-2', revision: 1 }, { resultId: 'result-1', revision: 1 })).toBe(
      false,
    );
  });
});
