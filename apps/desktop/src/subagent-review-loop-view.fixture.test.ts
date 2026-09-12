import { describe, expect, it } from 'vitest';
import type {
  SubagentInvocation,
  SubagentResultSummary,
  SubagentReviewRecord,
} from '@piwin/contracts';
import {
  deriveSubagentReviewLoopView,
  type SubagentReviewLoopVerificationFact,
} from './subagent-review-loop-view';

const PARENT = 'parent-1';
const LINEAGE = 'lineage-login';

function result(
  overrides: Partial<SubagentResultSummary> & Pick<SubagentResultSummary, 'resultId'>,
): SubagentResultSummary {
  return {
    revision: 1,
    parentSessionId: PARENT,
    childSessionId: 'child-worker',
    taskId: 'task-worker-1',
    batchRunId: 'run-worker-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    candidateLineageId: LINEAGE,
    candidateGeneration: 1,
    predecessorResult: null,
    latestReview: null,
    reviewStatus: 'not-requested',
    latestVerification: null,
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-1', revision: 1 },
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

function invocation(
  overrides: Partial<SubagentInvocation> & Pick<SubagentInvocation, 'id' | 'status'>,
): SubagentInvocation {
  return {
    parentSessionId: PARENT,
    runId: 'run-worker-1',
    taskId: 'task-worker-1',
    task: 'Fix login',
    title: 'Fix login',
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    activity: { kind: 'completed' },
    ...overrides,
  };
}

/** Plan §9.1 fact set: v1 CR → same-worker v2 approved. Apply/verify are layered by the test. */
function section91Facts() {
  const v1 = result({
    resultId: 'result-v1',
    latestReview: { reviewId: 'review-v1', revision: 1 },
    reviewStatus: 'changes-requested',
    revision: 2,
  });
  const v2 = result({
    resultId: 'result-v2',
    taskId: 'task-worker-2',
    batchRunId: 'run-worker-2',
    candidateGeneration: 2,
    predecessorResult: { resultId: 'result-v1', revision: 2 },
    latestReview: { reviewId: 'review-v2', revision: 1 },
    reviewStatus: 'approved',
    childChanges: { changeSetId: 'cs-2', revision: 1 },
    revision: 3,
  });
  const invocations = {
    'inv-worker-v1': invocation({
      id: 'inv-worker-v1',
      status: 'needs-integration',
      childSessionId: 'child-worker',
      role: 'worker',
      candidateLineageId: LINEAGE,
      candidateGeneration: 1,
    }),
    'inv-reviewer-v1': invocation({
      id: 'inv-reviewer-v1',
      status: 'completed',
      runId: 'run-reviewer-1',
      taskId: 'task-reviewer-1',
      childSessionId: 'child-reviewer-1',
      role: 'reviewer',
      reviewTarget: {
        result: { resultId: 'result-v1', revision: 2 },
        changes: { changeSetId: 'cs-1', revision: 1 },
      },
      reviewRef: { reviewId: 'review-v1', revision: 1 },
    }),
    'inv-repair-v2': invocation({
      id: 'inv-repair-v2',
      status: 'needs-integration',
      runId: 'run-worker-2',
      taskId: 'task-worker-2',
      childSessionId: 'child-worker',
      role: 'worker',
      candidateLineageId: LINEAGE,
      candidateGeneration: 2,
      predecessorResult: { resultId: 'result-v1', revision: 2 },
    }),
    'inv-reviewer-v2': invocation({
      id: 'inv-reviewer-v2',
      status: 'completed',
      runId: 'run-reviewer-2',
      taskId: 'task-reviewer-2',
      childSessionId: 'child-reviewer-2',
      role: 'reviewer',
      reviewTarget: {
        result: { resultId: 'result-v2', revision: 3 },
        changes: { changeSetId: 'cs-2', revision: 1 },
      },
      reviewRef: { reviewId: 'review-v2', revision: 1 },
    }),
  };
  const reviews: Record<string, SubagentReviewRecord> = {
    'review-v1': {
      reviewId: 'review-v1',
      revision: 1,
      parentSessionId: PARENT,
      reviewerSessionId: 'child-reviewer-1',
      reviewerRunId: 'run-reviewer-1',
      targetResult: { resultId: 'result-v1', revision: 2 },
      targetChanges: { changeSetId: 'cs-1', revision: 1 },
      decision: 'changes-requested',
      findings: [
        {
          id: 'f-auth',
          severity: 'high',
          title: 'Missing auth check',
          detail: 'Login returns the token without a session guard.',
        },
      ],
      verification: [],
      createdAt: '2026-09-13T00:02:00.000Z',
    },
    'review-v2': {
      reviewId: 'review-v2',
      revision: 1,
      parentSessionId: PARENT,
      reviewerSessionId: 'child-reviewer-2',
      reviewerRunId: 'run-reviewer-2',
      targetResult: { resultId: 'result-v2', revision: 3 },
      targetChanges: { changeSetId: 'cs-2', revision: 1 },
      decision: 'approved',
      findings: [],
      verification: [],
      createdAt: '2026-09-13T00:04:00.000Z',
    },
  };
  return { invocations, results: { 'result-v1': v1, 'result-v2': v2 }, reviews };
}

describe('§9.1 review-loop fixture', () => {
  it('is one connected F1/F2 loop: v1 stale, v2 head, approved/applied/verified stay distinct', () => {
    const facts = section91Facts();
    const approved = deriveSubagentReviewLoopView({ parentSessionId: PARENT, ...facts });
    expect(approved.loops).toHaveLength(1);
    const loop = approved.loops[0];
    if (!loop) throw new Error('expected one review loop');
    expect(loop.headResultId).toBe('result-v2');
    expect(loop.rows.map((row) => row.kind)).toEqual(['candidate', 'review', 'repair', 'review']);
    expect(loop.rows.find((row) => row.invocationId === 'inv-reviewer-v1')?.reviewStale).toBe(true);
    expect(loop.rows.find((row) => row.invocationId === 'inv-worker-v1')?.superseded).toBe(true);
    expect(loop.rows.find((row) => row.invocationId === 'inv-reviewer-v2')?.reviewStale).toBe(false);
    expect(loop).toMatchObject({
      phase: 'approved',
      approved: true,
      applied: false,
      delivered: false,
    });

    const appliedResult = result({
      ...facts.results['result-v2'],
      resultId: 'result-v2',
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
      revision: 4,
    });
    const applied = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: facts.invocations,
      results: { ...facts.results, 'result-v2': appliedResult },
      reviews: facts.reviews,
    });
    expect(applied.loops[0]).toMatchObject({
      phase: 'verifying',
      approved: true,
      applied: true,
      delivered: false,
    });

    const passed: SubagentReviewLoopVerificationFact = {
      verificationId: 'verify-1',
      revision: 1,
      resultId: 'result-v2',
      status: 'passed',
    };
    const delivered = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: facts.invocations,
      results: {
        ...facts.results,
        'result-v2': {
          ...appliedResult,
          latestVerification: { verificationId: 'verify-1', revision: 1 },
          revision: 5,
        },
      },
      reviews: facts.reviews,
      verifications: { 'verify-1': passed },
    });
    expect(delivered.loops[0]).toMatchObject({
      phase: 'delivered',
      approved: true,
      applied: true,
      delivered: true,
    });
    expect(approved.loops[0]?.phase).not.toBe(applied.loops[0]?.phase);
    expect(applied.loops[0]?.phase).not.toBe(delivered.loops[0]?.phase);
  });
});
