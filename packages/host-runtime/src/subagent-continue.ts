/**
 * Review-bound model continuation. Shell `subagent/continue` stays on the
 * extracted prep path and is not upgraded to these checks.
 */
import { formatError } from '@piwin/contracts';
import type {
  SubagentResultRef,
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentReviewRef,
} from '@piwin/contracts';
import { awaitAcceptedBatch, observeAcceptedBatch } from './subagent-accepted-batch.js';
import { SubagentControlError, type SubagentControlDeps } from './host-runtime-subagent-start.js';
import {
  buildReviewedContinuationTask,
  type PreparedSubagentContinuation,
} from './subagent-continuation-prep.js';
import { projectLineageHeadGeneration } from './subagent-result-projection.js';
import { isExactReviewTarget } from './subagent-review-context.js';

export const SUBAGENT_CONTINUE_TOOL_NAME = 'piwin_subagent_continue';
export const SUBAGENT_MAX_MODEL_REPAIRS = 2;
export const PIWIN_CONTINUE_FINDINGS_MARKER = '[piwin-continue-findings]';

export type SubagentReviewedContinueInput = {
  childSessionId: string;
  expectedResult: SubagentResultRef;
  review: SubagentReviewRef;
  task: string;
  invocationId: string;
  parentRunId: string;
  parentToolCallId?: string;
  signal?: AbortSignal;
};

export type SubagentContinuePorts = {
  prepareContinuation: (childSessionId: string) => Promise<PreparedSubagentContinuation>;
  getResult: (resultId: string) => SubagentResultSummary | undefined;
  listResults: (parentSessionId: string) => SubagentResultSummary[];
  loadReview: (ref: SubagentReviewRef) => Promise<SubagentReviewRecord | undefined>;
  isAdmissionClosed: (runId: string) => boolean;
};

function modelRepairCount(generation: number | null | undefined): number {
  return Math.max(0, (generation ?? 1) - 1);
}

export function formatSubagentContinueFindingsBlock(input: {
  review: SubagentReviewRecord;
  result: SubagentResultRef;
}): string {
  return [
    PIWIN_CONTINUE_FINDINGS_MARKER,
    'Host-authored review findings. This is not user text and does not grant apply authority.',
    `reviewId=${input.review.reviewId}`,
    `reviewRevision=${String(input.review.revision)}`,
    `resultId=${input.result.resultId}`,
    `resultRevision=${String(input.result.revision)}`,
    `decision=${input.review.decision}`,
    'findings:',
    ...input.review.findings.map(
      (finding) => `- [${finding.severity}] ${finding.title}: ${finding.detail}`,
    ),
  ].join('\n');
}

export async function startReviewedContinuation(
  deps: SubagentControlDeps & SubagentContinuePorts,
  parentSessionId: string,
  input: SubagentReviewedContinueInput,
): Promise<{ runId: string; invocationId: string }> {
  await deps.whenReady();
  const parentRunId = deps.getParentRunId();
  if (parentRunId && deps.getDelegationMode(parentRunId) === 'disabled') {
    throw new Error(
      'subagent-delegation-disabled: model-facing delegation is disabled for this turn',
    );
  }
  if (!parentRunId || parentRunId !== input.parentRunId) {
    throw new SubagentControlError('invalid-input', 'continuation must run on the current parent run');
  }

  let summary = requireContinuationHead(deps, parentSessionId, input);
  const review = await loadAuthorizingReview(deps, input);
  if (!isExactReviewTarget(review.targetResult, input.expectedResult)) {
    throw new SubagentControlError('stale-review', 'review does not target the expected result');
  }

  let prepared: PreparedSubagentContinuation;
  try {
    prepared = await deps.prepareContinuation(input.childSessionId);
  } catch (error) {
    const message = formatError(error);
    if (message.includes('worktree')) {
      throw new SubagentControlError('continuation-worktree-missing', message);
    }
    throw error;
  }
  if (prepared.child.parentSessionId !== parentSessionId) {
    throw new SubagentControlError(
      'invalid-input',
      'subagent child belongs to another parent session',
    );
  }
  if (prepared.continuationWorkspaceLease.mode !== 'worktree') {
    throw new SubagentControlError(
      'continuation-worktree-missing',
      'retained worktree lease is unavailable; start no replacement silently',
    );
  }

  await Promise.resolve();
  throwIfCancelled(deps, input);

  const admission = await deps.schemeAdmissionGate.acquire(parentRunId, input.signal);
  const releaseAdmission = (): void => {
    admission?.release();
  };
  let observingRelease = false;
  try {
    throwIfCancelled(deps, input);
    summary = requireContinuationHead(deps, parentSessionId, input);
    const findings = formatSubagentContinueFindingsBlock({
      review,
      result: input.expectedResult,
    });
    const task = buildReviewedContinuationTask(prepared, {
      invocationId: input.invocationId,
      parentRunId: input.parentRunId,
      ...(input.parentToolCallId ? { parentToolCallId: input.parentToolCallId } : {}),
      task: `${findings}\n\n---\n${input.task}`,
      candidateLineageId: summary.candidateLineageId ?? summary.resultId,
      candidateGeneration: (summary.candidateGeneration ?? 1) + 1,
      predecessorResult: { resultId: summary.resultId, revision: summary.revision },
      reviewRef: { reviewId: review.reviewId, revision: review.revision },
    });
    const handle = deps.orchestrator.startBatch(
      {
        parentSessionId,
        tasks: [task],
        maxConcurrency: 1,
        failurePolicy: 'continue',
      },
      parentRunId,
    );
    observeAcceptedBatch(deps, { handle, releaseAdmission });
    observingRelease = true;
    await awaitAcceptedBatch(deps, handle, input.signal);
    return { runId: handle.runId, invocationId: input.invocationId };
  } catch (error) {
    if (!observingRelease) {
      releaseAdmission();
    }
    throw error;
  }
}

function requireContinuationHead(
  deps: SubagentContinuePorts,
  parentSessionId: string,
  input: SubagentReviewedContinueInput,
): SubagentResultSummary {
  const summary = deps.getResult(input.expectedResult.resultId);
  if (!summary) {
    throw new SubagentControlError(
      'review-target-not-found',
      'expected result was not found; refresh result state',
    );
  }
  if (summary.revision !== input.expectedResult.revision) {
    throw new SubagentControlError('stale-revision', 'expected result revision is stale');
  }
  if (summary.parentSessionId !== parentSessionId) {
    throw new SubagentControlError(
      'review-target-forbidden',
      'expected result is outside the current parent session',
    );
  }
  if (summary.childSessionId !== input.childSessionId) {
    throw new SubagentControlError(
      'review-target-forbidden',
      'expected result does not belong to this child',
    );
  }
  rejectIfSuperseded(deps, parentSessionId, summary);
  rejectIfReviewDoesNotAuthorize(input, summary);
  if (modelRepairCount(summary.candidateGeneration) >= SUBAGENT_MAX_MODEL_REPAIRS) {
    throw new SubagentControlError(
      'repair-limit-reached',
      'two model continuations have already been used for this lineage',
    );
  }
  return summary;
}

async function loadAuthorizingReview(
  deps: SubagentContinuePorts,
  input: SubagentReviewedContinueInput,
): Promise<SubagentReviewRecord> {
  const review = await deps.loadReview(input.review);
  if (!review) {
    throw new SubagentControlError('review-missing', 'structured review was not found');
  }
  if (review.decision !== 'changes-requested') {
    throw new SubagentControlError(
      'stale-review',
      'review does not authorize continuation of this candidate',
    );
  }
  return review;
}

function rejectIfReviewDoesNotAuthorize(
  input: SubagentReviewedContinueInput,
  summary: SubagentResultSummary,
): void {
  const latest = summary.latestReview;
  if (
    summary.reviewStatus !== 'changes-requested' ||
    !latest ||
    latest.reviewId !== input.review.reviewId ||
    latest.revision !== input.review.revision
  ) {
    throw new SubagentControlError(
      'stale-review',
      'review does not authorize continuation of this candidate',
    );
  }
}

function rejectIfSuperseded(
  deps: SubagentContinuePorts,
  parentSessionId: string,
  summary: SubagentResultSummary,
): void {
  if (summary.reviewStatus === 'stale') {
    throw new SubagentControlError(
      'candidate-superseded',
      'expected result is not the current lineage head',
    );
  }
  const lineageId = summary.candidateLineageId;
  if (!lineageId) return;
  const members = deps
    .listResults(parentSessionId)
    .filter((candidate) => candidate.candidateLineageId === lineageId);
  const headGeneration = projectLineageHeadGeneration(members);
  if (headGeneration !== null && (summary.candidateGeneration ?? 1) < headGeneration) {
    throw new SubagentControlError(
      'candidate-superseded',
      'expected result is not the current lineage head',
    );
  }
}

function throwIfCancelled(
  deps: SubagentContinuePorts,
  input: SubagentReviewedContinueInput,
): void {
  if (input.signal?.aborted || deps.isAdmissionClosed(input.parentRunId)) {
    throw new SubagentControlError('aborted', 'aborted before continuation acceptance', true);
  }
}
