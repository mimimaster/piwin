/**
 * Review-bound apply invariants shared by UI worktree-action and the
 * model-facing apply tool. One writer: result service + coordinator.
 */
import type {
  HostPush,
  SubagentIntegrationStatus,
  SubagentResultRef,
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentReviewRef,
  ToolResult,
} from '@piwin/contracts';
import { isExactReviewTarget, isSameChangeVersionRef } from './subagent-review-context.js';
import { reviewAuthorizesApply } from './subagent-review-service.js';
import { projectLineageHeadGeneration } from './subagent-result-projection.js';
import type {
  SubagentResultApplyInput,
  SubagentResultApplyOutcome,
  SubagentResultService,
} from './subagent-result-service.js';

export const SUBAGENT_RESULT_APPLY_TOOL_NAME = 'piwin_subagent_result_apply';

export type ReviewedApplyInvariantCode = Extract<
  ToolResult,
  { ok: false }
>['code'] | Extract<SubagentResultApplyOutcome, { ok: false }>['code'];

export type ReviewedApplyInvariantResult =
  | { ok: true; summary: SubagentResultSummary }
  | { ok: false; code: ReviewedApplyInvariantCode };

export type ReviewedApplyInvariantInput = {
  summary: SubagentResultSummary | undefined;
  expectedRevision: number;
  parentSessionId?: string;
  approvedBy?: SubagentReviewRef;
  review?: SubagentReviewRecord;
  lineageMembers?: readonly SubagentResultSummary[];
};

export class SubagentApplyOutcomeUnknownError extends Error {
  readonly code = 'apply-outcome-unknown' as const;
  readonly operationId: string;

  constructor(operationId: string, message = 'apply outcome is unknown; reconcile the existing operation') {
    super(message);
    this.name = 'SubagentApplyOutcomeUnknownError';
    this.operationId = operationId;
  }
}

export function isSubagentApplyOutcomeUnknownError(
  error: unknown,
): error is SubagentApplyOutcomeUnknownError {
  return error instanceof SubagentApplyOutcomeUnknownError;
}

export function isApplyAbortOrTimeoutError(error: unknown): boolean {
  if (isSubagentApplyOutcomeUnknownError(error)) return true;
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? String(error.name) : '';
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'IntegrationQueueCancelledError'
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    /aborted|timeout|cancelled before parent mutation|apply outcome is unknown/i.test(
      error.message,
    )
  );
}

export function evaluateReviewedApplyInvariants(
  input: ReviewedApplyInvariantInput,
): ReviewedApplyInvariantResult {
  const summary = input.summary;
  if (!summary) {
    return { ok: false, code: 'not-found' };
  }
  if (summary.revision !== input.expectedRevision) {
    return { ok: false, code: 'stale-revision' };
  }
  if (input.parentSessionId && summary.parentSessionId !== input.parentSessionId) {
    return { ok: false, code: 'review-target-forbidden' };
  }
  if (summary.legacyManual) {
    return { ok: false, code: 'result-not-approved' };
  }
  if (
    summary.executionStatus !== 'completed' ||
    summary.copyState === 'removed' ||
    summary.copyState === 'missing' ||
    !summary.childChanges
  ) {
    return { ok: false, code: 'review-data-expired' };
  }
  if (summary.integrationStatus === 'discarded') {
    return { ok: false, code: 'already-applied' };
  }
  if (isSuperseded(summary, input.lineageMembers)) {
    return { ok: false, code: 'candidate-superseded' };
  }
  if (input.review) {
    const reviewGate = evaluateDurableReview(input.review, summary, input.approvedBy);
    if (!reviewGate.ok) return reviewGate;
  }
  if (!summary.latestReview || summary.reviewStatus === 'not-requested' || summary.reviewStatus === 'pending') {
    return { ok: false, code: 'review-missing' };
  }
  if (!reviewAuthorizesApply(summary)) {
    return { ok: false, code: 'result-not-approved' };
  }
  if (input.approvedBy && !isExactReviewRef(input.approvedBy, summary.latestReview)) {
    return { ok: false, code: 'stale-review' };
  }
  return { ok: true, summary };
}

function evaluateDurableReview(
  review: SubagentReviewRecord,
  summary: SubagentResultSummary,
  approvedBy: SubagentReviewRef | undefined,
): ReviewedApplyInvariantResult {
  if (approvedBy && !isExactReviewRef(approvedBy, { reviewId: review.reviewId, revision: review.revision })) {
    return { ok: false, code: 'stale-review' };
  }
  if (review.decision !== 'approved') {
    return { ok: false, code: 'result-not-approved' };
  }
  if (!isExactReviewTarget(review.targetResult, { resultId: summary.resultId, revision: summary.revision })) {
    return { ok: false, code: 'stale-review' };
  }
  if (!summary.childChanges || !isSameChangeVersionRef(review.targetChanges, summary.childChanges)) {
    return { ok: false, code: 'stale-review' };
  }
  return { ok: true, summary };
}

function isExactReviewRef(left: SubagentReviewRef, right: SubagentReviewRef): boolean {
  return left.reviewId === right.reviewId && left.revision === right.revision;
}

function isSuperseded(
  summary: SubagentResultSummary,
  members: readonly SubagentResultSummary[] | undefined,
): boolean {
  if (summary.reviewStatus === 'stale') return true;
  const lineageId = summary.candidateLineageId;
  if (!lineageId || !members) return false;
  const headGeneration = projectLineageHeadGeneration(
    members.filter((candidate) => candidate.candidateLineageId === lineageId),
  );
  return headGeneration !== null && (summary.candidateGeneration ?? 1) < headGeneration;
}

export type SubagentReviewedApplyInput = {
  parentSessionId: string;
  result: SubagentResultRef;
  approvedBy: SubagentReviewRef;
  idempotencyKey?: string;
  requestHash?: string;
  principal?: string;
  signal?: AbortSignal;
};

export type SubagentReviewedApplySuccess = {
  ok: true;
  operationId: string;
  result: SubagentResultRef;
  appliedChanges: NonNullable<SubagentResultSummary['appliedChanges']>;
  integrationStatus: SubagentIntegrationStatus;
};

export type SubagentReviewedApplyFailure = Extract<ToolResult, { ok: false }>;

export type SubagentReviewedApplyPorts = {
  resultService: SubagentResultService;
  loadReview: (ref: SubagentReviewRef) => Promise<SubagentReviewRecord | undefined>;
  applyResult: SubagentResultApplyInput['applyResult'];
  probeWrite?: () => Promise<
    { ok: true } | { ok: false; code: 'permission-denied' | 'workspace-busy' | 'aborted' }
  >;
  persistApply?: (input: {
    batchRunId: string;
    taskId: string;
    appliedChanges: NonNullable<SubagentResultSummary['appliedChanges']>;
    latestOperationId: string;
  }) => Promise<void>;
  publish?: (message: HostPush) => void;
};

export async function applyReviewedSubagentResult(
  ports: SubagentReviewedApplyPorts,
  input: SubagentReviewedApplyInput,
): Promise<SubagentReviewedApplySuccess | SubagentReviewedApplyFailure> {
  if (input.signal?.aborted) {
    return { ok: false, code: 'aborted', message: 'aborted before apply', cancelled: true };
  }

  const summary = ports.resultService.get(input.result.resultId);
  const review = await ports.loadReview(input.approvedBy);
  if (!review) {
    return applyError('review-missing', 'structured review was not found');
  }
  if (review.parentSessionId !== input.parentSessionId) {
    return applyError('review-target-forbidden', 'review belongs to another parent session');
  }

  const invariants = evaluateReviewedApplyInvariants({
    summary,
    expectedRevision: input.result.revision,
    parentSessionId: input.parentSessionId,
    approvedBy: input.approvedBy,
    review,
    lineageMembers: summary
      ? ports.resultService.list({ parentSessionId: summary.parentSessionId }).items
      : [],
  });
  if (!invariants.ok) {
    return applyError(mapInvariantCode(invariants.code), messageForApplyCode(invariants.code));
  }

  if (ports.probeWrite) {
    const probed = await ports.probeWrite();
    if (!probed.ok) {
      return applyError(
        probed.code === 'aborted' ? 'aborted' : probed.code,
        probed.code === 'workspace-busy'
          ? 'workspace is busy; apply performed no writes'
          : probed.code === 'permission-denied'
            ? 'file-write permission denied; apply performed no writes'
            : 'aborted before apply',
        probed.code === 'aborted',
      );
    }
  }
  if (input.signal?.aborted) {
    return { ok: false, code: 'aborted', message: 'aborted before apply', cancelled: true };
  }

  try {
    const outcome = await ports.resultService.apply({
      resultId: input.result.resultId,
      expectedRevision: input.result.revision,
      applyResult: ports.applyResult,
      parentSessionId: input.parentSessionId,
      approvedBy: input.approvedBy,
      review,
      ...(input.principal ? { principal: input.principal } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.requestHash ? { requestHash: input.requestHash } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!outcome.ok) {
      return applyError(
        mapInvariantCode(outcome.code),
        messageForApplyCode(outcome.code),
        false,
        outcome.operationId,
      );
    }

    const applied = ports.resultService.get(input.result.resultId) ?? invariants.summary;
    const appliedChanges = applied.appliedChanges ?? applied.childChanges;
    if (!appliedChanges) {
      return applyError('review-data-expired', 'applied change version is unavailable');
    }
    if (ports.persistApply) {
      await ports.persistApply({
        batchRunId: applied.batchRunId,
        taskId: applied.taskId,
        appliedChanges,
        latestOperationId: outcome.operationId,
      });
    }
    ports.publish?.({
      type: 'subagent/result-updated',
      parentSessionId: applied.parentSessionId,
      result: applied,
    });
    return {
      ok: true,
      operationId: outcome.operationId,
      result: { resultId: applied.resultId, revision: applied.revision },
      appliedChanges,
      integrationStatus: applied.integrationStatus,
    };
  } catch (error) {
    if (isSubagentApplyOutcomeUnknownError(error)) {
      return applyError('apply-outcome-unknown', error.message, false, error.operationId);
    }
    throw error;
  }
}

function mapInvariantCode(code: ReviewedApplyInvariantCode): Extract<ToolResult, { ok: false }>['code'] {
  if (code === 'not-found') return 'review-target-not-found';
  if (code === 'needs-repair') return 'subagent-needs-integration';
  return code;
}

function messageForApplyCode(code: ReviewedApplyInvariantCode): string {
  switch (code) {
    case 'not-found':
    case 'review-target-not-found':
      return 'result was not found; refresh result state';
    case 'stale-revision':
      return 'result revision is stale';
    case 'already-applied':
      return 'result was already applied';
    case 'candidate-group-selected':
      return 'another candidate in this group was already selected';
    case 'needs-repair':
    case 'subagent-needs-integration':
      return 'integration conflict retained the candidate; needs-integration';
    case 'review-missing':
      return 'structured review is missing; collect a valid reviewer first';
    case 'result-not-approved':
      return 'result is not authorized by an approved review';
    case 'stale-review':
      return 'review does not authorize the current candidate head';
    case 'candidate-superseded':
      return 'result is not the current lineage head';
    case 'review-data-expired':
      return 'frozen apply data is unavailable';
    case 'review-target-forbidden':
      return 'result is outside the current parent session';
    case 'apply-outcome-unknown':
      return 'apply outcome is unknown; reconcile the existing operation';
    case 'workspace-busy':
      return 'workspace is busy; apply performed no writes';
    default:
      return 'apply was refused';
  }
}

function applyError(
  code: Extract<ToolResult, { ok: false }>['code'],
  message: string,
  cancelled = false,
  operationId?: string,
): SubagentReviewedApplyFailure {
  return {
    ok: false,
    code,
    message,
    ...(operationId ? { details: { operationId } } : {}),
    ...(cancelled ? { cancelled: true } : {}),
  };
}
