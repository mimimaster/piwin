/**
 * Locating and checking what a review may bind to: the reviewer's own run,
 * the frozen candidate files, and whether the candidate is still reviewable.
 * Split from subagent-review-service.ts so the service keeps only the
 * submit/commit flow.
 */
import type {
  ChangeVersionRef,
  SubagentInvocation,
  SubagentResultRef,
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentTaskResult,
  ToolResult,
} from '@piwin/contracts';
import type { SubagentRunStore } from '@piwin/session';
import { isSameChangeVersionRef } from './subagent-review-context.js';
import type { SubagentResultService } from './subagent-result-service.js';

function reviewError(
  code: Extract<ToolResult, { ok: false }>['code'],
  message: string,
): Extract<ToolResult, { ok: false }> {
  return { ok: false, code, message };
}

export function reviewerTaskResultForPublish(
  binding: { runId: string; taskId: string },
  review: SubagentReviewRecord,
  existing: SubagentTaskResult | undefined,
): SubagentTaskResult {
  const reviewRef = { reviewId: review.reviewId, revision: review.revision };
  if (existing) {
    return { ...existing, review, reviewRef };
  }
  return {
    runId: binding.runId,
    taskId: binding.taskId,
    childSessionId: review.reviewerSessionId,
    executionStatus: 'running',
    summaryStatus: 'not-requested',
    integrationStatus: 'not-requested',
    review,
    reviewRef,
  };
}

export function collectFrozenRelativePaths(
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

export type CandidateChangeSize = {
  files: number;
  changedLines: number;
  /** True once either bound is crossed; counting stops early then. */
  exceedsLimit: boolean;
};

/**
 * Size a frozen candidate against a Lead review limit. File count comes from
 * the frozen listing; changed lines are additions + deletions per file. A
 * binary file or one whose diff is unavailable counts as over the line bound,
 * so an unmeasurable candidate never slips past the reviewer requirement.
 */
export async function measureCandidateChangeSize(
  resultService: SubagentResultService,
  resultId: string,
  revision: number,
  limit: { maxFiles: number; maxChangedLines: number },
): Promise<CandidateChangeSize> {
  const fileIds: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const listed = resultService.listFiles({
      resultId,
      revision,
      ...(cursor ? { cursor } : {}),
      limit: 200,
    });
    for (const file of listed.files) fileIds.push(file.fileId);
    if (!listed.nextCursor) break;
    cursor = listed.nextCursor;
  }
  if (fileIds.length > limit.maxFiles) {
    return { files: fileIds.length, changedLines: 0, exceedsLimit: true };
  }
  let changedLines = 0;
  for (const fileId of fileIds) {
    const diff = await resultService.diffFile({ resultId, revision, fileId });
    if (!diff.ok || diff.binary || diff.additions === null || diff.deletions === null) {
      return { files: fileIds.length, changedLines, exceedsLimit: true };
    }
    changedLines += diff.additions + diff.deletions;
    if (changedLines > limit.maxChangedLines) {
      return { files: fileIds.length, changedLines, exceedsLimit: true };
    }
  }
  return { files: fileIds.length, changedLines, exceedsLimit: false };
}

export async function findReviewerBinding(
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

/**
 * The target is the current lineage head, and its frozen data is still the
 * exact change version under review. Returns the summary or a tool failure.
 */
export function checkReviewableTarget(
  resultService: SubagentResultService,
  target: SubagentResultRef,
  changes: ChangeVersionRef,
): SubagentResultSummary | Extract<ToolResult, { ok: false }> {
  const summary = resultService.get(target.resultId);
  if (!summary) {
    return reviewError('review-target-not-found', 'review target was not found');
  }
  if (summary.revision !== target.revision) {
    return reviewError('stale-revision', 'review target revision is stale');
  }
  if (summary.reviewStatus === 'stale') {
    return reviewError('stale-revision', 'review target is not the current lineage head');
  }
  if (
    !summary.childChanges ||
    summary.copyState === 'removed' ||
    summary.copyState === 'missing' ||
    !isSameChangeVersionRef(summary.childChanges, changes)
  ) {
    return reviewError('review-data-expired', 'frozen review data is unavailable');
  }
  return summary;
}
