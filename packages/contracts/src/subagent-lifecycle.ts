/**
 * CE-SUB-LIFE: orthogonal subagent lifecycle state axes.
 *
 * Execution completion, parent-summary merge, and code integration are
 * separate state axes. A completed child may have an unmerged summary or
 * unapplied/conflicted changes. `done` must never imply that a code change
 * was integrated.
 */

export type SubagentExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SubagentSummaryStatus =
  | 'not-requested'
  | 'pending'
  | 'merged'
  | 'failed';

export type SubagentIntegrationStatus =
  | 'not-requested'
  | 'pending'
  | 'applied'
  | 'conflict'
  | 'failed'
  | 'retained';

/** Persisted lifecycle state for a child session. */
export type SubagentLifecycleState = {
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
};

/** Default state for a newly created child before seeding. */
export function createDefaultSubagentLifecycleState(): SubagentLifecycleState {
  return {
    executionStatus: 'queued',
    summaryStatus: 'not-requested',
    integrationStatus: 'not-requested',
  };
}
