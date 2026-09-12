/** Frozen subagent result summary. Storage is owned by later Host tasks. */

import type {
  SubagentCopyState,
  SubagentDeliveryIntent,
  SubagentResultAvailability,
  SubagentResultRef,
  ChangeVersionRef,
} from './subagent-delivery.js';
import type {
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
} from './subagent-lifecycle.js';
import type { SubagentReviewRef, SubagentVerificationRef } from './subagent-review.js';

export type SubagentResultReviewStatus =
  | 'not-requested'
  | 'pending'
  | 'approved'
  | 'changes-requested'
  | 'blocked'
  | 'stale';

export type SubagentResultSummary = {
  resultId: string;
  revision: number;
  parentSessionId: string;
  childSessionId: string;
  taskId: string;
  batchRunId: string;
  sourceAttemptId: string | null;
  targetWorkspaceId: string;
  deliveryIntent: SubagentDeliveryIntent;
  legacyManual: boolean;
  candidateGroupId: string | null;
  candidateLineageId: string | null;
  candidateGeneration: number | null;
  predecessorResult: SubagentResultRef | null;
  latestReview: SubagentReviewRef | null;
  reviewStatus: SubagentResultReviewStatus;
  latestVerification: SubagentVerificationRef | null;
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
  childChanges: ChangeVersionRef | null;
  appliedChanges: ChangeVersionRef | null;
  copyState: SubagentCopyState;
  latestOperationId: string | null;
  availability: SubagentResultAvailability;
};

export function emptySubagentResultReviewFields(): Pick<
  SubagentResultSummary,
  | 'candidateLineageId'
  | 'candidateGeneration'
  | 'predecessorResult'
  | 'latestReview'
  | 'reviewStatus'
  | 'latestVerification'
> {
  return {
    candidateLineageId: null,
    candidateGeneration: null,
    predecessorResult: null,
    latestReview: null,
    reviewStatus: 'not-requested',
    latestVerification: null,
  };
}

export function deriveSubagentResultReviewStatus(input: {
  candidateGeneration: number | null;
  lineageHeadGeneration: number | null;
  storedStatus: SubagentResultReviewStatus;
}): SubagentResultReviewStatus {
  if (
    input.candidateGeneration !== null &&
    input.lineageHeadGeneration !== null &&
    input.candidateGeneration < input.lineageHeadGeneration
  ) {
    return 'stale';
  }
  return input.storedStatus === 'stale' ? 'not-requested' : input.storedStatus;
}
