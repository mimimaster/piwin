import { describe, expect, it } from 'vitest';
import type {
  SubagentInvocation,
  SubagentResultSummary,
  SubagentReviewFinding,
  SubagentReviewRecord,
} from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import {
  deriveSubagentReviewLoopView,
  mergeSubagentResultRecord,
  preferSubagentResult,
  type SubagentReviewLoopVerificationFact,
} from './subagent-review-loop-view';

const PARENT = 'parent-1';
const WORKER = 'child-worker';
const LINEAGE = 'lineage-login';

function finding(id: string, title: string): SubagentReviewFinding {
  return {
    id,
    severity: 'high',
    title,
    detail: `${title} detail`,
  };
}

function makeResult(
  overrides: Partial<SubagentResultSummary> & Pick<SubagentResultSummary, 'resultId'>,
): SubagentResultSummary {
  return {
    revision: 1,
    parentSessionId: PARENT,
    childSessionId: WORKER,
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

function makeInvocation(
  overrides: Partial<SubagentInvocation> & Pick<SubagentInvocation, 'id' | 'status'>,
): SubagentInvocation {
  return {
    parentSessionId: PARENT,
    runId: 'run-worker-1',
    taskId: 'task-worker-1',
    task: 'Fix login state',
    title: 'Fix login state',
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    activity: { kind: 'completed' },
    ...overrides,
  };
}

/** Mirrors Host `invocationStatusForResult` so retained fixtures cannot hide `needs-integration`. */
function hostInvocationStatusForResult(
  result: Pick<SubagentResultSummary, 'executionStatus' | 'integrationStatus'>,
): SubagentInvocation['status'] {
  if (result.executionStatus === 'completed') {
    if (result.integrationStatus === 'retained' || result.integrationStatus === 'conflict') {
      return 'needs-integration';
    }
    if (result.integrationStatus === 'failed') {
      return 'failed';
    }
    return 'completed';
  }
  if (result.executionStatus === 'cancelled') {
    return 'cancelled';
  }
  if (result.executionStatus === 'queued') {
    return 'queued';
  }
  if (result.executionStatus === 'running') {
    return 'running';
  }
  return 'failed';
}

function hostInvocationActivity(
  result: Pick<SubagentResultSummary, 'executionStatus' | 'integrationStatus'>,
): SubagentInvocation['activity'] {
  const status = hostInvocationStatusForResult(result);
  if (status === 'needs-integration') {
    return {
      kind: 'needs-integration',
      ...(result.integrationStatus === 'conflict'
        ? { message: 'worktree integration conflicted' }
        : {}),
    };
  }
  if (status === 'completed') {
    return { kind: 'completed' };
  }
  if (status === 'cancelled') {
    return { kind: 'cancelled' };
  }
  if (status === 'queued') {
    return { kind: 'queued' };
  }
  if (status === 'running') {
    return { kind: 'thinking' };
  }
  return { kind: 'failed' };
}

function makeHostMappedInvocation(
  result: SubagentResultSummary,
  overrides: Partial<SubagentInvocation> & Pick<SubagentInvocation, 'id'>,
): SubagentInvocation {
  return makeInvocation({
    status: hostInvocationStatusForResult(result),
    activity: hostInvocationActivity(result),
    childSessionId: result.childSessionId,
    runId: result.batchRunId,
    taskId: result.taskId,
    ...overrides,
  });
}

function makeReview(
  overrides: Partial<SubagentReviewRecord> & Pick<SubagentReviewRecord, 'reviewId' | 'decision' | 'targetResult'>,
): SubagentReviewRecord {
  return {
    revision: 1,
    parentSessionId: PARENT,
    reviewerSessionId: 'child-reviewer-1',
    reviewerRunId: 'run-reviewer-1',
    targetChanges: { changeSetId: 'cs-1', revision: 1 },
    findings: [],
    verification: [],
    createdAt: '2026-09-13T00:02:00.000Z',
    ...overrides,
  };
}

function relationFacts(order: 'forward' | 'reverse') {
  const v1 = makeResult({
    resultId: 'result-v1',
    taskId: 'task-worker-1',
    batchRunId: 'run-worker-1',
    candidateGeneration: 1,
    latestReview: { reviewId: 'review-v1', revision: 1 },
    reviewStatus: 'changes-requested',
    revision: 2,
  });
  const v2 = makeResult({
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
  const worker = makeHostMappedInvocation(v1, {
    id: 'inv-worker-v1',
    role: 'worker',
    candidateLineageId: LINEAGE,
    candidateGeneration: 1,
  });
  const reviewerV1 = makeInvocation({
    id: 'inv-reviewer-v1',
    status: 'completed',
    runId: 'run-reviewer-1',
    taskId: 'task-reviewer-1',
    task: 'Review candidate v1',
    title: 'Review candidate v1',
    childSessionId: 'child-reviewer-1',
    role: 'reviewer',
    reviewTarget: {
      result: { resultId: 'result-v1', revision: 2 },
      changes: { changeSetId: 'cs-1', revision: 1 },
    },
    reviewRef: { reviewId: 'review-v1', revision: 1 },
    createdAt: '2026-09-13T00:02:00.000Z',
  });
  const repair = makeHostMappedInvocation(v2, {
    id: 'inv-repair-v2',
    role: 'worker',
    candidateLineageId: LINEAGE,
    candidateGeneration: 2,
    predecessorResult: { resultId: 'result-v1', revision: 2 },
    createdAt: '2026-09-13T00:03:00.000Z',
  });
  const reviewerV2 = makeInvocation({
    id: 'inv-reviewer-v2',
    status: 'completed',
    runId: 'run-reviewer-2',
    taskId: 'task-reviewer-2',
    task: 'Review candidate v2',
    title: 'Review candidate v2',
    childSessionId: 'child-reviewer-2',
    role: 'reviewer',
    reviewTarget: {
      result: { resultId: 'result-v2', revision: 3 },
      changes: { changeSetId: 'cs-2', revision: 1 },
    },
    reviewRef: { reviewId: 'review-v2', revision: 1 },
    createdAt: '2026-09-13T00:04:00.000Z',
  });
  const reviewV1 = makeReview({
    reviewId: 'review-v1',
    decision: 'changes-requested',
    targetResult: { resultId: 'result-v1', revision: 2 },
    findings: [finding('f1', 'Missing null check'), finding('f2', 'Race on token')],
  });
  const reviewV2 = makeReview({
    reviewId: 'review-v2',
    decision: 'approved',
    reviewerSessionId: 'child-reviewer-2',
    reviewerRunId: 'run-reviewer-2',
    targetResult: { resultId: 'result-v2', revision: 3 },
    targetChanges: { changeSetId: 'cs-2', revision: 1 },
    createdAt: '2026-09-13T00:04:00.000Z',
  });

  const invocations =
    order === 'forward'
      ? {
          [worker.id]: worker,
          [reviewerV1.id]: reviewerV1,
          [repair.id]: repair,
          [reviewerV2.id]: reviewerV2,
        }
      : {
          [reviewerV2.id]: reviewerV2,
          [repair.id]: repair,
          [reviewerV1.id]: reviewerV1,
          [worker.id]: worker,
        };
  const results =
    order === 'forward'
      ? { [v1.resultId]: v1, [v2.resultId]: v2 }
      : { [v2.resultId]: v2, [v1.resultId]: v1 };
  const reviews =
    order === 'forward'
      ? { [reviewV1.reviewId]: reviewV1, [reviewV2.reviewId]: reviewV2 }
      : { [reviewV2.reviewId]: reviewV2, [reviewV1.reviewId]: reviewV1 };

  return { invocations, results, reviews, v1, v2 };
}

function relationShape() {
  const view = deriveSubagentReviewLoopView({
    parentSessionId: PARENT,
    ...relationFacts('forward'),
  });
  expect(view.loops).toHaveLength(1);
  const loop = view.loops[0];
  if (loop === undefined) {
    throw new Error('expected a review loop');
  }
  return loop;
}

describe('deriveSubagentReviewLoopView', () => {
  it('joins worker → reviewer → repair → reviewer by ids deterministically', () => {
    const loop = relationShape();
    expect(loop.candidateLineageId).toBe(LINEAGE);
    expect(loop.headResultId).toBe('result-v2');
    expect(loop.rows.map((row) => ({
      kind: row.kind,
      invocationId: row.invocationId,
      resultId: row.resultId,
      predecessorResultId: row.predecessorResultId,
      targetResultId: row.targetResultId,
      findingCount: row.findingCount,
      reviewDecision: row.reviewDecision,
    }))).toEqual([
      {
        kind: 'candidate',
        invocationId: 'inv-worker-v1',
        resultId: 'result-v1',
        predecessorResultId: undefined,
        targetResultId: undefined,
        findingCount: undefined,
        reviewDecision: undefined,
      },
      {
        kind: 'review',
        invocationId: 'inv-reviewer-v1',
        resultId: 'result-v1',
        predecessorResultId: undefined,
        targetResultId: 'result-v1',
        findingCount: 2,
        reviewDecision: 'changes-requested',
      },
      {
        kind: 'repair',
        invocationId: 'inv-repair-v2',
        resultId: 'result-v2',
        predecessorResultId: 'result-v1',
        targetResultId: undefined,
        findingCount: undefined,
        reviewDecision: undefined,
      },
      {
        kind: 'review',
        invocationId: 'inv-reviewer-v2',
        resultId: 'result-v2',
        predecessorResultId: undefined,
        targetResultId: 'result-v2',
        findingCount: 0,
        reviewDecision: 'approved',
      },
    ]);
    expect(loop.phase).toBe('approved');
  });

  it('marks the v1 review stale once v2 is the lineage head', () => {
    const loop = relationShape();
    const v1Review = loop.rows.find((row) => row.invocationId === 'inv-reviewer-v1');
    const v1Candidate = loop.rows.find((row) => row.invocationId === 'inv-worker-v1');
    const v2Review = loop.rows.find((row) => row.invocationId === 'inv-reviewer-v2');
    expect(v1Review?.reviewStale).toBe(true);
    expect(v1Candidate?.superseded).toBe(true);
    expect(v2Review?.reviewStale).toBe(false);
    expect(loop.headResultId).toBe('result-v2');
  });

  it('does not collapse approved, applied, and verified into one phase', () => {
    const { invocations, results, reviews } = relationFacts('forward');
    const approved = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations,
      results,
      reviews,
    });
    expect(approved.loops[0]).toMatchObject({
      phase: 'approved',
      approved: true,
      applied: false,
      delivered: false,
    });

    const appliedResult = makeResult({
      ...results['result-v2'],
      resultId: 'result-v2',
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
      revision: 4,
    });
    const applied = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations,
      results: { ...results, 'result-v2': appliedResult },
      reviews,
    });
    expect(applied.loops[0]).toMatchObject({
      phase: 'verifying',
      approved: true,
      applied: true,
      delivered: false,
    });

    const delivered = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations,
      results: {
        ...results,
        'result-v2': {
          ...appliedResult,
          latestVerification: { verificationId: 'verify-1', revision: 1 },
          revision: 5,
        },
      },
      reviews,
      verifications: {
        'verify-1': {
          verificationId: 'verify-1',
          revision: 1,
          resultId: 'result-v2',
          status: 'passed',
        },
      },
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

  it('produces one projection for reconnect order and duplicate facts', () => {
    const forward = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      ...relationFacts('forward'),
    });
    const reverse = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      ...relationFacts('reverse'),
    });
    expect(reverse).toEqual(forward);

    const { v1, v2, invocations, reviews } = relationFacts('reverse');
    const merged = mergeSubagentResultRecord(
      mergeSubagentResultRecord({ [v2.resultId]: v2 }, v1),
      { ...v2, revision: 3 },
    );
    const afterDuplicates = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations,
      results: merged,
      reviews,
    });
    expect(afterDuplicates).toEqual(forward);
  });

  it('renders legacy candidates without fake reviewer or repair rows', () => {
    const legacyManual = makeResult({
      resultId: 'result-legacy',
      legacyManual: true,
      candidateLineageId: null,
      candidateGeneration: null,
      reviewStatus: 'not-requested',
      deliveryIntent: 'integrate',
    });
    const ordinary = makeResult({
      resultId: 'result-ordinary',
      childSessionId: 'child-ordinary',
      taskId: 'task-ordinary',
      batchRunId: 'run-ordinary',
      candidateLineageId: null,
      candidateGeneration: null,
      reviewStatus: 'not-requested',
    });
    const legacyInv = makeInvocation({
      id: 'inv-legacy',
      status: 'completed',
      childSessionId: WORKER,
      task: 'Manual worktree',
    });
    const ordinaryInv = makeInvocation({
      id: 'inv-ordinary',
      status: 'completed',
      runId: 'run-ordinary',
      taskId: 'task-ordinary',
      childSessionId: 'child-ordinary',
      task: 'Scout repo',
    });

    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [legacyInv.id]: legacyInv, [ordinaryInv.id]: ordinaryInv },
      results: { [legacyManual.resultId]: legacyManual, [ordinary.resultId]: ordinary },
    });

    expect(view.loops).toHaveLength(2);
    for (const loop of view.loops) {
      expect(loop.legacy).toBe(true);
      expect(loop.phase).toBeNull();
      expect(loop.delivered).toBe(false);
      expect(loop.rows.some((row) => row.kind === 'review' || row.kind === 'repair')).toBe(false);
      expect(loop.rows.every((row) => row.kind === 'legacy')).toBe(true);
    }
  });

  it('does not treat applied + failed verification as delivered', () => {
    const result = makeResult({
      resultId: 'result-v1',
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
      latestVerification: { verificationId: 'verify-fail', revision: 1 },
      revision: 6,
    });
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: {
        'inv-worker-v1': makeInvocation({
          id: 'inv-worker-v1',
          status: 'completed',
          childSessionId: WORKER,
          candidateLineageId: LINEAGE,
          candidateGeneration: 1,
        }),
      },
      results: { [result.resultId]: result },
      reviews: {
        'review-v1': makeReview({
          reviewId: 'review-v1',
          decision: 'approved',
          targetResult: { resultId: 'result-v1', revision: 6 },
        }),
      },
      verifications: {
        'verify-fail': {
          verificationId: 'verify-fail',
          revision: 1,
          resultId: 'result-v1',
          status: 'failed',
        },
      },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'blocked',
      applied: true,
      delivered: false,
      attention: true,
    });
  });

  it('stays verifying after apply when verification status is missing', () => {
    const result = makeResult({
      resultId: 'result-v1',
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
      latestVerification: { verificationId: 'verify-ref-only', revision: 1 },
      revision: 5,
    });
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: {
        'inv-worker-v1': makeInvocation({
          id: 'inv-worker-v1',
          status: 'completed',
          childSessionId: WORKER,
          candidateLineageId: LINEAGE,
          candidateGeneration: 1,
        }),
      },
      results: { [result.resultId]: result },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'verifying',
      applied: true,
      delivered: false,
    });
  });

  it('keeps a retained Host needs-integration candidate awaiting-review, not applying', () => {
    const result = makeResult({
      resultId: 'result-v1',
      integrationStatus: 'retained',
    });
    const invocation = makeHostMappedInvocation(result, {
      id: 'inv-worker-v1',
      candidateLineageId: LINEAGE,
      candidateGeneration: 1,
    });
    expect(invocation.status).toBe('needs-integration');
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [invocation.id]: invocation },
      results: { [result.resultId]: result },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'awaiting-review',
      approved: false,
      applied: false,
      delivered: false,
    });
    expect(view.loops[0]?.phase).not.toBe('applying');
  });

  it('keeps an approved retained Host needs-integration candidate approved, not applying', () => {
    const result = makeResult({
      resultId: 'result-v1',
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'retained',
    });
    const invocation = makeHostMappedInvocation(result, {
      id: 'inv-worker-v1',
      candidateLineageId: LINEAGE,
      candidateGeneration: 1,
    });
    expect(invocation.status).toBe('needs-integration');
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [invocation.id]: invocation },
      results: { [result.resultId]: result },
      reviews: {
        'review-v1': makeReview({
          reviewId: 'review-v1',
          decision: 'approved',
          targetResult: { resultId: 'result-v1', revision: 1 },
        }),
      },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'approved',
      approved: true,
      applied: false,
      delivered: false,
    });
    expect(view.loops[0]?.phase).not.toBe('applying');
  });

  it('shows applying only while approved integrate is pending', () => {
    const result = makeResult({
      resultId: 'result-v1',
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'pending',
      latestOperationId: 'op-apply-1',
    });
    const invocation = makeHostMappedInvocation(result, {
      id: 'inv-worker-v1',
      candidateLineageId: LINEAGE,
      candidateGeneration: 1,
    });
    expect(invocation.status).toBe('completed');
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [invocation.id]: invocation },
      results: { [result.resultId]: result },
      reviews: {
        'review-v1': makeReview({
          reviewId: 'review-v1',
          decision: 'approved',
          targetResult: { resultId: 'result-v1', revision: 1 },
        }),
      },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'applying',
      approved: true,
      applied: false,
      delivered: false,
    });
  });

  it('keeps conflict plus Host needs-integration blocked, not applying', () => {
    const result = makeResult({
      resultId: 'result-v1',
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'conflict',
    });
    const invocation = makeHostMappedInvocation(result, {
      id: 'inv-worker-v1',
      candidateLineageId: LINEAGE,
      candidateGeneration: 1,
    });
    expect(invocation.status).toBe('needs-integration');
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [invocation.id]: invocation },
      results: { [result.resultId]: result },
      reviews: {
        'review-v1': makeReview({
          reviewId: 'review-v1',
          decision: 'approved',
          targetResult: { resultId: 'result-v1', revision: 1 },
        }),
      },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'blocked',
      approved: true,
      applied: false,
      delivered: false,
      attention: true,
    });
    expect(view.loops[0]?.phase).not.toBe('applying');
  });

  it('does not treat passed verification without apply as delivered', () => {
    const result = makeResult({
      resultId: 'result-v1',
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      latestVerification: { verificationId: 'verify-early', revision: 1 },
      integrationStatus: 'retained',
    });
    const invocation = makeHostMappedInvocation(result, {
      id: 'inv-worker-v1',
      candidateLineageId: LINEAGE,
      candidateGeneration: 1,
    });
    expect(invocation.status).toBe('needs-integration');
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [invocation.id]: invocation },
      results: { [result.resultId]: result },
      reviews: {
        'review-v1': makeReview({
          reviewId: 'review-v1',
          decision: 'approved',
          targetResult: { resultId: 'result-v1', revision: 1 },
        }),
      },
      verifications: {
        'verify-early': {
          verificationId: 'verify-early',
          revision: 1,
          resultId: 'result-v1',
          status: 'passed',
        },
      },
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'approved',
      approved: true,
      applied: false,
      delivered: false,
    });
    expect(view.loops[0]?.phase).not.toBe('delivered');
  });
});

describe('preferSubagentResult', () => {
  it('ignores a lower revision and does not regress applied or terminal review', () => {
    const stored = makeResult({
      resultId: 'result-v1',
      revision: 8,
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
      latestVerification: { verificationId: 'verify-1', revision: 1 },
    });
    const stale: SubagentResultSummary = {
      ...stored,
      revision: 3,
      reviewStatus: 'pending',
      latestReview: null,
      integrationStatus: 'pending',
      appliedChanges: null,
      latestOperationId: null,
      latestVerification: null,
    };
    expect(preferSubagentResult(stored, stale)).toBe(stored);

    const newerRegression: SubagentResultSummary = {
      ...stored,
      revision: 9,
      reviewStatus: 'not-requested',
      latestReview: null,
      integrationStatus: 'retained',
      appliedChanges: null,
      latestOperationId: null,
      latestVerification: null,
    };
    const protectedResult = preferSubagentResult(stored, newerRegression);
    expect(protectedResult.revision).toBe(9);
    expect(protectedResult.integrationStatus).toBe('applied');
    expect(protectedResult.appliedChanges).toEqual({ changeSetId: 'cs-parent', revision: 1 });
    expect(protectedResult.reviewStatus).toBe('approved');
    expect(protectedResult.latestReview).toEqual({ reviewId: 'review-v1', revision: 1 });
    expect(protectedResult.latestVerification).toEqual({ verificationId: 'verify-1', revision: 1 });
  });
});

describe('chatUiReducer subagent/result-updated', () => {
  function appliedResult(revision: number): SubagentResultSummary {
    return makeResult({
      resultId: 'result-v1',
      revision,
      reviewStatus: 'approved',
      latestReview: { reviewId: 'review-v1', revision: 1 },
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
    });
  }

  it('stores the active-parent result and ignores other parents, older revisions, and duplicates', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: PARENT });
    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: appliedResult(4),
    });
    const afterFirst = state;
    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: 'parent-other',
      result: { ...appliedResult(9), parentSessionId: 'parent-other' },
    });
    expect(state).toBe(afterFirst);

    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: {
        ...appliedResult(2),
        integrationStatus: 'pending',
        reviewStatus: 'pending',
      },
    });
    expect(state.subagentResults['result-v1']?.revision).toBe(4);
    expect(state.subagentResults['result-v1']?.integrationStatus).toBe('applied');

    const afterDuplicate = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: appliedResult(4),
    });
    expect(afterDuplicate).toBe(state);
  });

  it('does not regress applied or terminal review on a newer but incomplete push', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: PARENT });
    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: appliedResult(4),
    });
    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: {
        ...appliedResult(5),
        reviewStatus: 'not-requested',
        latestReview: null,
        integrationStatus: 'retained',
        appliedChanges: null,
        latestOperationId: null,
      },
    });
    expect(state.subagentResults['result-v1']).toMatchObject({
      revision: 5,
      reviewStatus: 'approved',
      integrationStatus: 'applied',
      latestOperationId: 'op-1',
    });
  });

  it('records a delivery-verification fact from task-updated without treating a ref as pass', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: PARENT });
    const fact: SubagentReviewLoopVerificationFact = {
      verificationId: 'verify-1',
      revision: 1,
      resultId: 'result-v1',
      status: 'failed',
    };
    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: {
        ...appliedResult(4),
        latestVerification: { verificationId: 'verify-1', revision: 1 },
      },
    });
    state = chatUiReducer(state, {
      type: 'subagent/task-updated',
      parentSessionId: PARENT,
      runId: 'run-worker-1',
      result: {
        runId: 'run-worker-1',
        taskId: 'task-worker-1',
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'applied',
        deliveryVerification: {
          verificationId: 'verify-1',
          revision: 1,
          parentSessionId: PARENT,
          parentRunId: 'parent-run',
          result: { resultId: 'result-v1', revision: 4 },
          approvedBy: { reviewId: 'review-v1', revision: 1 },
          applyOperationId: 'op-1',
          appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
          status: 'failed',
          checks: [{ label: 'tests', status: 'failed', evidence: '1 failed' }],
          createdAt: '2026-09-13T00:10:00.000Z',
        },
      },
    });
    expect(state.subagentVerifications['verify-1']).toEqual(fact);
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: {},
      results: state.subagentResults,
      verifications: state.subagentVerifications,
    });
    expect(view.loops[0]).toMatchObject({
      phase: 'blocked',
      applied: true,
      delivered: false,
      attention: true,
    });
  });

  it('keeps a review body from task-updated after a later result-updated', () => {
    const review = makeReview({
      reviewId: 'review-v1',
      decision: 'changes-requested',
      targetResult: { resultId: 'result-v1', revision: 4 },
      findings: [finding('f-high', 'Missing null check')],
    });
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: PARENT });
    state = chatUiReducer(state, {
      type: 'subagent/task-updated',
      parentSessionId: PARENT,
      runId: 'run-reviewer-1',
      result: {
        runId: 'run-reviewer-1',
        taskId: 'task-reviewer-1',
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'not-requested',
        review,
      },
    });
    expect(state.subagentReviews['review-v1']?.findings).toEqual(review.findings);
    state = chatUiReducer(state, {
      type: 'subagent/result-updated',
      parentSessionId: PARENT,
      result: {
        ...appliedResult(4),
        latestReview: { reviewId: 'review-v1', revision: 1 },
        reviewStatus: 'changes-requested',
      },
    });
    expect(state.subagentReviews['review-v1']?.findings).toEqual(review.findings);
    state = chatUiReducer(state, {
      type: 'subagent/task-updated',
      parentSessionId: PARENT,
      runId: 'run-reviewer-1',
      result: {
        runId: 'run-reviewer-1',
        taskId: 'task-reviewer-1',
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'not-requested',
      },
    });
    expect(state.subagentReviews['review-v1']?.findings).toEqual(review.findings);
    expect(state.subagentTaskResults['run-reviewer-1:task-reviewer-1']?.review?.findings).toEqual(
      review.findings,
    );
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: {},
      results: state.subagentResults,
      taskResults: state.subagentTaskResults,
    });
    expect(view.loops[0]?.rows.some((row) => row.findingCount === 1)).toBe(true);
  });
});
