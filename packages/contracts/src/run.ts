import type { SessionRunPhase } from './host.js';

/**
 * CE-RUN: structured concurrency run contracts (runtime-refactor Phase 2).
 *
 * RunRegistry is the only Run lifecycle and terminal authority. Runs form
 * a tree: foreground turns, plan execution, subagent batches, and subagent
 * tasks are all Runs. Parent cancellation closes admission before aborting
 * descendants. A parent cannot become terminal while a descendant is
 * non-terminal.
 */

/** Kind of execution run. */
export type ExecutionRunKind =
  | 'session-turn'
  | 'plan-execution'
  | 'subagent-batch'
  | 'subagent-task';

/** Run lifecycle status. Terminal states are immutable. */
export type ExecutionRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** Immutable run record. */
export type ExecutionRunRecord = {
  runId: string;
  kind: ExecutionRunKind;
  status: ExecutionRunStatus;
  rootRunId: string;
  parentRunId?: string;
  sessionId: string;
  planId?: string;
  taskId?: string;
  runtimeGenerationId?: string;
  /** Normalized foreground phase; terminality remains represented by status. */
  phase?: SessionRunPhase;
  /** Optional host-provided explanation for the current phase. */
  phaseDetail?: string;
  /** Timestamp of the latest phase transition. */
  phaseUpdatedAt?: string;
  /** Whether the provider has produced the first model token for this Run. */
  firstTokenReceived?: boolean;
  startedAt?: string;
  endedAt?: string;
  terminalCode?: string;
  error?: string;
};

/** Run push variants for HostPush. */
export type RunHostPush =
  | { type: 'run/updated'; run: ExecutionRunRecord }
  | { type: 'run/terminal'; run: ExecutionRunRecord };

/** Check if a run status is terminal. */
export function isRunTerminal(status: ExecutionRunStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted'
  );
}

/** Check if a run status is active (non-terminal). */
export function isRunActive(status: ExecutionRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'cancelling';
}

/** Stable terminal codes for run terminalization. */
export const RUN_TERMINAL_CODES = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
  integrationRequired: 'integration-required',
  jobCleanupFailed: 'job-cleanup-failed',
  workerCrash: 'worker-crash',
  startupFailed: 'startup-failed',
  timeout: 'timeout',
  modelConnectTimeout: 'model-connect-timeout',
  modelFirstTokenTimeout: 'model-first-token-timeout',
  modelTurnTimeout: 'model-turn-timeout',
  mcpTimeout: 'mcp-timeout',
  hostShutdown: 'host-shutdown',
} as const;

export type RunTerminalCode = (typeof RUN_TERMINAL_CODES)[keyof typeof RUN_TERMINAL_CODES];
