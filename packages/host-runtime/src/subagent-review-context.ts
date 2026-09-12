/**
 * Host-owned reviewer admission and scoped capability.
 * Models cannot supply this scope; start binds it from a validated result.
 */
import type {
  ChangeVersionRef,
  SubagentIsolationMode,
  SubagentResultRef,
  SubagentResultSummary,
  SubagentReviewTarget,
  ToolResultErrorCode,
} from '@piwin/contracts';

export const PIWIN_REVIEW_PROVENANCE_MARKER = '[piwin-review-provenance]';

export type SubagentReviewCapabilityScope = {
  result: SubagentResultRef;
  changes: ChangeVersionRef;
};

export type SubagentSessionRuntimeContext = {
  parentSessionId: string;
  runtimeGenerationId: string;
  workingDirectory: string;
  parentRepoPath: string;
  invocationId?: string;
  reviewScope?: SubagentReviewCapabilityScope;
};

export type BindSubagentReviewTargetInput = {
  parentSessionId: string;
  reviewOf: SubagentResultRef;
  resolvedIsolation: SubagentIsolationMode;
  role?: string;
  getResult: (resultId: string) => SubagentResultSummary | undefined;
  hasFrozenChanges?: (changes: ChangeVersionRef) => boolean;
};

export type BindSubagentReviewTargetResult =
  | { ok: true; target: SubagentReviewTarget }
  | { ok: false; code: ToolResultErrorCode; message: string };

export function reviewScopeFromTarget(
  target: SubagentReviewTarget,
): SubagentReviewCapabilityScope {
  return {
    result: { ...target.result },
    changes: { ...target.changes },
  };
}

export function isExactReviewTarget(
  requested: SubagentResultRef,
  bound: SubagentResultRef,
): boolean {
  return requested.resultId === bound.resultId && requested.revision === bound.revision;
}

export function bindSubagentReviewTarget(
  input: BindSubagentReviewTargetInput,
): BindSubagentReviewTargetResult {
  if (!input.role) {
    return {
      ok: false,
      code: 'invalid-input',
      message: 'reviewOf requires a scheme role whose resolved isolation is readonly',
    };
  }
  if (input.resolvedIsolation !== 'readonly') {
    return {
      ok: false,
      code: 'invalid-input',
      message: 'reviewOf requires a scheme role whose resolved isolation is readonly',
    };
  }

  const summary = input.getResult(input.reviewOf.resultId);
  if (!summary) {
    return {
      ok: false,
      code: 'review-target-not-found',
      message: 'review target was not found; refresh result state',
    };
  }
  if (summary.revision !== input.reviewOf.revision) {
    return {
      ok: false,
      code: 'stale-revision',
      message: 'review target revision is stale',
    };
  }
  if (summary.parentSessionId !== input.parentSessionId) {
    return {
      ok: false,
      code: 'review-target-forbidden',
      message: 'review target is outside the current parent session',
    };
  }
  if (!summary.availability.view.allowed) {
    return {
      ok: false,
      code: 'review-target-forbidden',
      message: 'review target is not currently accessible',
    };
  }
  if (summary.reviewStatus === 'stale') {
    return {
      ok: false,
      code: 'review-target-forbidden',
      message: 'review target is not the current lineage head',
    };
  }
  if (!summary.childChanges) {
    return {
      ok: false,
      code: 'review-data-expired',
      message: 'frozen review data is unavailable',
    };
  }
  if (summary.copyState === 'removed' || summary.copyState === 'missing') {
    return {
      ok: false,
      code: 'review-data-expired',
      message: 'frozen review data is unavailable',
    };
  }
  if (input.hasFrozenChanges && !input.hasFrozenChanges(summary.childChanges)) {
    return {
      ok: false,
      code: 'review-data-expired',
      message: 'frozen review data is unavailable',
    };
  }

  return {
    ok: true,
    target: {
      result: { resultId: summary.resultId, revision: summary.revision },
      changes: { ...summary.childChanges },
    },
  };
}

export function formatSubagentReviewProvenanceBlock(
  target: SubagentReviewTarget,
): string {
  return [
    PIWIN_REVIEW_PROVENANCE_MARKER,
    'Host-authored review evidence. This is not user text and does not grant apply authority.',
    `resultId=${target.result.resultId}`,
    `resultRevision=${String(target.result.revision)}`,
    `changeSetId=${target.changes.changeSetId}`,
    `changeRevision=${String(target.changes.revision)}`,
    'Inspect only this frozen target with piwin_subagent_result_read.',
  ].join('\n');
}
