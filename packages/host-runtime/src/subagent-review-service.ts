/**
 * Durable structured review submission. Manifests are the source of truth;
 * the result service is only a projection cache.
 */
import { randomUUID } from 'node:crypto';
import type {
  HostPush,
  SubagentInvocation,
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

export type SubagentReviewSubmitInput = {
  reviewerSessionId: string;
  invocationId?: string;
  scope: SubagentReviewCapabilityScope;
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

export async function loadPersistedReviewObservation(
  store: Pick<SubagentRunStore, 'loadManifest'>,
  runId: string,
): Promise<SubagentReviewObservation | undefined> {
  const manifest = await store.loadManifest(runId);
  const task = manifest?.tasks.find((candidate) => candidate.review) ??
    manifest?.tasks.find((candidate) => candidate.reviewRef);
  if (task?.review) return reviewObservationFromRecord(task.review);
  return undefined;
}

function collectFrozenRelativePaths(
  resultService: SubagentResultService,
  resultId: string,
  revision: number,
): string[] | undefined {
  const paths: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const listed = resultService.listFiles({
      resultId,
      revision,
      ...(cursor ? { cursor } : {}),
      limit: 200,
    });
    for (const file of listed.files) paths.push(file.relativePath);
    if (!listed.nextCursor) break;
    cursor = listed.nextCursor;
  }
  return paths.length > 0 ? paths : undefined;
}

async function findReviewerBinding(
  store: SubagentRunStore,
  input: { reviewerSessionId: string; invocationId?: string },
): Promise<
  | { runId: string; taskId: string; invocation?: SubagentInvocation }
  | undefined
> {
  for (const manifest of await store.listManifests()) {
    if (input.invocationId) {
      const invocation = manifest.invocations[input.invocationId];
      if (invocation) {
        return { runId: manifest.runId, taskId: invocation.taskId, invocation };
      }
      const task = manifest.tasks.find((candidate) => candidate.invocationId === input.invocationId);
      if (task) {
        return {
          runId: manifest.runId,
          taskId: task.id,
          ...(task.invocationId && manifest.invocations[task.invocationId]
            ? { invocation: manifest.invocations[task.invocationId] }
            : {}),
        };
      }
    }
    const byChild = Object.values(manifest.invocations).find(
      (candidate) => candidate.childSessionId === input.reviewerSessionId,
    );
    if (byChild) {
      return { runId: manifest.runId, taskId: byChild.taskId, invocation: byChild };
    }
    const result = Object.values(manifest.results).find(
      (candidate) => candidate.childSessionId === input.reviewerSessionId,
    );
    if (result) {
      return { runId: manifest.runId, taskId: result.taskId };
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

      const summary = options.resultService.get(input.target.resultId);
      if (!summary) {
        return reviewError('review-target-not-found', 'review target was not found');
      }
      if (summary.revision !== input.target.revision) {
        return reviewError('stale-revision', 'review target revision is stale');
      }
      if (summary.reviewStatus === 'stale') {
        return reviewError('stale-revision', 'review target is not the current lineage head');
      }
      if (
        !summary.childChanges ||
        summary.copyState === 'removed' ||
        summary.copyState === 'missing' ||
        !isSameChangeVersionRef(summary.childChanges, input.scope.changes)
      ) {
        return reviewError('review-data-expired', 'frozen review data is unavailable');
      }

      const decisionCheck = validateSubagentReviewDecision({
        decision: input.decision,
        findings: input.findings,
      });
      if (!decisionCheck.ok) {
        return reviewError('invalid-input', decisionCheck.issues[0]?.message ?? 'invalid review decision');
      }
      const bounds = validateSubagentReviewBounds({
        findings: input.findings,
        verification: input.verification,
        frozenRelativePaths: collectFrozenRelativePaths(
          options.resultService,
          summary.resultId,
          summary.childChanges.revision,
        ),
      });
      if (!bounds.ok) {
        return reviewError('invalid-input', bounds.issues[0]?.message ?? 'review exceeds bounds');
      }

      const record: SubagentReviewRecord = {
        reviewId: createId(),
        revision: 1,
        parentSessionId: summary.parentSessionId,
        reviewerSessionId: input.reviewerSessionId,
        reviewerRunId: binding.runId,
        targetResult: { ...input.scope.result },
        targetChanges: { ...input.scope.changes },
        decision: input.decision,
        findings: input.findings,
        verification: input.verification,
        createdAt: now().toISOString(),
      };

      const persisted = await options.runStore.persistReviewerDecision(
        binding.runId,
        binding.taskId,
        record,
      );
      if (!persisted.ok) {
        return persisted.code === 'conflict'
          ? reviewError('invalid-input', 'this reviewer run already submitted a different review')
          : reviewError('review-target-not-found', 'reviewer run was not found');
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
    },
  };
}
