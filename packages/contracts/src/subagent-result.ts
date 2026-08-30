/** Frozen subagent result summary. Storage is owned by later Host tasks. */

import type {
  SubagentCopyState,
  SubagentDeliveryIntent,
  SubagentResultAvailability,
  ChangeVersionRef,
} from './subagent-delivery.js';
import type {
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
} from './subagent-lifecycle.js';

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
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
  childChanges: ChangeVersionRef | null;
  appliedChanges: ChangeVersionRef | null;
  copyState: SubagentCopyState;
  latestOperationId: string | null;
  availability: SubagentResultAvailability;
};
