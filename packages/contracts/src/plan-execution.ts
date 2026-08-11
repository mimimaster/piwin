/** Plan execution contract: how an approved SessionPlan is carried out. */

export type PlanExecutionMode = 'inline' | 'subagent-driven';

export type PlanExecutionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

export type PlanExecutionRequest = {
  sessionId: string;
  planId: string;
  mode: PlanExecutionMode;
  /** Reject a stale card instead of executing a newer plan revision. */
  expectedRevision?: number;
  /** Atomically approve a draft plan as part of starting execution. */
  approveDraft?: boolean;
};

export type PlanExecutionState = {
  sessionId: string;
  planId: string;
  mode: PlanExecutionMode;
  status: PlanExecutionStatus;
  /** Source RunRegistry parent for this execution. */
  runId?: string;
  /** Step currently being worked on, if any. */
  currentStepId?: string;
  /** Child session ids created by subagent-driven execution. */
  childSessionIds: string[];
  /** Human-readable failure reason when status is 'failed'. */
  error?: string;
  startedAt?: string;
  endedAt?: string;
  /** Durable bounded completion evidence consumed by Walkthrough generation. */
  summary?: PlanExecutionSummary;
};

/** Bounded summary produced at the end of a plan execution. */
export type PlanExecutionSummary = {
  planId: string;
  mode: PlanExecutionMode;
  completedStepIds: string[];
  failedStepIds: string[];
  skippedStepIds: string[];
  mergedChildSessionIds: string[];
  verificationResult?: string;
  unresolvedItems?: string[];
  startedAt?: string;
  endedAt?: string;
};

export const MAX_PLAN_EXECUTION_ERROR_CHARS = 500;
export const MAX_PLAN_WALKTHROUGH_UNRESOLVED = 16;
