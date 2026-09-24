/**
 * Durable structured review submission. Manifests are the source of truth;
 * the result service is only a projection cache.
 */
import { randomUUID } from 'node:crypto';
import type {
  HostPush,
  SubagentReviewDecision,
  SubagentReviewFinding,
  SubagentReviewRecord,
  SubagentReviewRef,
  SubagentResultRef,
  SubagentResultSummary,
  ToolResult,
} from '@piwin/contracts';
import {
  validateSubagentReviewBounds,
  validateSubagentReviewDecision,
} from '@piwin/contracts';
import type { SubagentRunStore } from '@piwin/session';
import {
  isExactReviewTarget,
  isSameChangeVersionRef,
  type SubagentReviewCapabilityScope,
} from './subagent-review-context.js';
import type { SubagentResultService } from './subagent-result-service.js';
import {
  checkReviewableTarget,
  collectFrozenRelativePaths,
  findReviewerBinding,
  reviewerTaskResultForPublish,
} from './subagent-review-target.js';

export type SubagentReviewSubmitInput = {
  reviewerSessionId: string;
  invocationId?: string;
  scope: SubagentReviewCapabilityScope;
  target: SubagentResultRef;
  decision: SubagentReviewDecision;
  findings: SubagentReviewFinding[];
  verification: SubagentReviewRecord['verification'];
};

/**
 * The Lead's own review of a candidate whose task grants `lead` authority.
 * No capability scope: the Host checks the candidate belongs to this parent
 * and was admitted for Lead review.
 */
export type SubagentLeadReviewSubmitInput = {
  parentSessionId: string;
  parentRunId: string;
  target: SubagentResultRef;
  decision: SubagentReviewDecision;
  findings: SubagentReviewFinding[];
  verification: SubagentReviewRecord['verification'];
};

export type SubagentReviewSubmitResult =
  | { ok: true; record: SubagentReviewRecord; duplicate: boolean }
  | Extract<ToolResult, { ok: false }>;

export type SubagentReviewObservation = {
  reviewRef: SubagentReviewRef;
  reviewDecision: SubagentReviewDecision;
};

export type SubagentReviewService = {
  submit(input: SubagentReviewSubmitInput): Promise<SubagentReviewSubmitResult>;
  submitLead(input: SubagentLeadReviewSubmitInput): Promise<SubagentReviewSubmitResult>;
};

export type SubagentReviewServiceOptions = {
  runStore: SubagentRunStore;
  resultService: SubagentResultService;
  publish?: (message: HostPush) => void;
  now?: () => Date;
  createId?: () => string;
};

function reviewError(
  code: Extract<ToolResult, { ok: false }>['code'],
  message: string,
): Extract<ToolResult, { ok: false }> {
  return { ok: false, code, message };
}

export function reviewAuthorizesApply(
  summary: Pick<SubagentResultSummary, 'latestReview' | 'reviewStatus'>,
): boolean {
  return summary.reviewStatus === 'approved' && summary.latestReview !== null;
}

export function reviewObservationFromRecord(
  review: SubagentReviewRecord,
): SubagentReviewObservation {
  return {
    reviewRef: { reviewId: review.reviewId, revision: review.revision },
    reviewDecision: review.decision,
  };
}

/**
 * Asks only for the manifest shape this read actually touches, so any store
 * that can hand back reviewed tasks qualifies — including in-memory fakes.
 */
export type PersistedReviewManifestReader = {
  loadManifest: (
    runId: string,
  ) => Promise<{ tasks: readonly { review?: SubagentReviewRecord }[] } | undefined>;
};

export async function loadPersistedReviewObservation(
  store: PersistedReviewManifestReader,
  runId: string,
): Promise<SubagentReviewObservation | undefined> {
  const manifest = await store.loadManifest(runId);
  const task = manifest?.tasks.find((candidate) => candidate.review);
  if (task?.review) return reviewObservationFromRecord(task.review);
  return undefined;
}

export async function findPersistedReview(
  store: Pick<SubagentRunStore, 'listManifests'>,
  ref: SubagentReviewRef,
): Promise<SubagentReviewRecord | undefined> {
  for (const manifest of await store.listManifests()) {
    for (const task of manifest.tasks) {
      const review = task.review;
      if (
        review &&
        review.reviewId === ref.reviewId &&
        review.revision === ref.revision
      ) {
        return review;
      }
    }
  }
  return undefined;
}

export function createSubagentReviewService(
  options: SubagentReviewServiceOptions,
): SubagentReviewService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => randomUUID());

  return {
    async submit(input) {
      if (!isExactReviewTarget(input.target, input.scope.result)) {
        return reviewError('review-target-forbidden', 'result is outside this reviewer scope');
      }

      const binding = await findReviewerBinding(options.runStore, {
        reviewerSessionId: input.reviewerSessionId,
        ...(input.invocationId ? { invocationId: input.invocationId } : {}),
      });
      if (!binding) {
        return reviewError('review-target-not-found', 'reviewer run was not found');
      }

      const manifest = await options.runStore.loadManifest(binding.runId);
      const task = manifest?.tasks.find((candidate) => candidate.id === binding.taskId);
      if (!task?.reviewTarget) {
        return reviewError('review-target-forbidden', 'this run is not bound to a review target');
      }
      if (!isExactReviewTarget(input.target, task.reviewTarget.result)) {
        return reviewError('review-target-forbidden', 'result is outside this reviewer scope');
      }
      if (!isSameChangeVersionRef(task.reviewTarget.changes, input.scope.changes)) {
        return reviewError('review-data-expired', 'frozen review data is unavailable');
      }

      const summary = checkReviewableTarget(options.resultService, input.target, input.scope.changes);
      if (!('resultId' in summary)) return summary;

      return commitReview(summary, binding, {
        reviewerSessionId: input.reviewerSessionId,
        reviewerRunId: binding.runId,
        targetChanges: { ...input.scope.changes },
        decision: input.decision,
        findings: input.findings,
        verification: input.verification,
      });
    },

    async submitLead(input) {
      const current = options.resultService.get(input.target.resultId);
      if (!current) {
        return reviewError('review-target-not-found', 'review target was not found');
      }
      if (current.parentSessionId !== input.parentSessionId) {
        return reviewError('review-target-forbidden', 'result belongs to another parent session');
      }
      const manifest = await options.runStore.loadManifest(current.batchRunId);
      const task = manifest?.tasks.find((candidate) => candidate.id === current.taskId);
      if (task?.reviewAuthority !== 'lead') {
        return reviewError(
          'review-target-forbidden',
          'this candidate requires an independent reviewer; start one with reviewOf',
        );
      }
      if (!current.childChanges) {
        return reviewError('review-data-expired', 'frozen review data is unavailable');
      }
      const summary = checkReviewableTarget(
        options.resultService,
        input.target,
        current.childChanges,
      );
      if (!('resultId' in summary)) return summary;

      // Stored on the candidate's own task: there is no reviewer run, and the
      // one-review-per-task rule then means one Lead decision per candidate.
      return commitReview(
        summary,
        { runId: summary.batchRunId, taskId: summary.taskId },
        {
          reviewerSessionId: input.parentSessionId,
          reviewerRunId: input.parentRunId,
          authority: 'lead',
          targetChanges: { ...current.childChanges },
          decision: input.decision,
          findings: input.findings,
          verification: input.verification,
        },
      );
    },
  };

  async function commitReview(
    summary: SubagentResultSummary,
    binding: { runId: string; taskId: string },
    draft: Pick<
      SubagentReviewRecord,
      'reviewerSessionId' | 'reviewerRunId' | 'authority' | 'targetChanges' | 'decision' | 'findings' | 'verification'
    >,
  ): Promise<SubagentReviewSubmitResult> {
    const decisionCheck = validateSubagentReviewDecision({
      decision: draft.decision,
      findings: draft.findings,
    });
    if (!decisionCheck.ok) {
      return reviewError('invalid-input', decisionCheck.issues[0]?.message ?? 'invalid review decision');
    }
    const frozenRelativePaths = collectFrozenRelativePaths(
      options.resultService,
      summary.resultId,
      draft.targetChanges.revision,
    );
    const bounds = validateSubagentReviewBounds({
      findings: draft.findings,
      verification: draft.verification,
      // Optional under exactOptionalPropertyTypes: omit it rather than
      // passing an explicit undefined when the listing could not be read.
      ...(frozenRelativePaths === undefined ? {} : { frozenRelativePaths }),
    });
    if (!bounds.ok) {
      return reviewError('invalid-input', bounds.issues[0]?.message ?? 'review exceeds bounds');
    }

    const record: SubagentReviewRecord = {
      reviewId: createId(),
      revision: 1,
      parentSessionId: summary.parentSessionId,
      reviewerSessionId: draft.reviewerSessionId,
      reviewerRunId: draft.reviewerRunId,
      ...(draft.authority ? { authority: draft.authority } : {}),
      targetResult: { resultId: summary.resultId, revision: summary.revision },
      targetChanges: { ...draft.targetChanges },
      decision: draft.decision,
      findings: draft.findings,
      verification: draft.verification,
      createdAt: now().toISOString(),
    };

    const persisted = await options.runStore.persistReviewerDecision(
      binding.runId,
      binding.taskId,
      record,
    );
    if (!persisted.ok) {
      if (persisted.code !== 'conflict') {
        return reviewError('review-target-not-found', 'reviewer run was not found');
      }
      return reviewError(
        'invalid-input',
        draft.authority === 'lead'
          ? 'a different Lead decision is already recorded for this candidate; send the sidekick a new brief instead'
          : 'this reviewer run already submitted a different review',
      );
    }

    const duplicate = persisted.record.reviewId !== record.reviewId ||
      persisted.record.createdAt !== record.createdAt;
    const stored = persisted.record;
    const reviewRef = { reviewId: stored.reviewId, revision: stored.revision };

    const nextSummary: SubagentResultSummary = {
      ...summary,
      latestReview: reviewRef,
      reviewStatus: stored.decision,
    };
    options.resultService.register(nextSummary);
    await options.runStore.projectResultReview(
      summary.batchRunId,
      summary.taskId,
      reviewRef,
      stored.decision,
    );

    options.publish?.({
      type: 'subagent/result-updated',
      parentSessionId: summary.parentSessionId,
      result: options.resultService.get(summary.resultId) ?? nextSummary,
    });

    const refreshed = await options.runStore.loadManifest(binding.runId);
    options.publish?.({
      type: 'subagent/task-updated',
      runId: binding.runId,
      parentSessionId: summary.parentSessionId,
      result: reviewerTaskResultForPublish(
        binding,
        stored,
        refreshed?.results[binding.taskId],
      ),
    });
    const invocation = Object.values(refreshed?.invocations ?? {}).find(
      (candidate) => candidate.taskId === binding.taskId,
    );
    if (invocation) {
      options.publish?.({
        type: 'subagent/invocation-updated',
        parentSessionId: invocation.parentSessionId,
        invocation,
      });
    }

    return { ok: true, record: stored, duplicate };
  }
}
