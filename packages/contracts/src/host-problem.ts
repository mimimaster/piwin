import type { SessionRunPhase } from './host.js';

/**
 * Structured problem payload on failed HostResponse.
 * Complements the human-readable `error` string; does not replace it.
 */
export type HostProblem = {
  code: string;
  retryable?: boolean;
  data?: unknown;
};

export type ForegroundRunMismatchReason =
  | 'active'
  | 'changed'
  | 'already-finished'
  | 'transitioning';

/**
 * Typed problem when prompt foreground admission is refused because of an
 * existing or changing run. Assignable to HostProblem.
 */
export type ForegroundRunMismatchProblem = {
  code: 'foreground-run-mismatch';
  data: {
    reason: ForegroundRunMismatchReason;
    actualRun?: {
      runId: string;
      /** Remote Hosts project `{ runId }` only; status is stripped. */
      status?: 'queued' | 'running' | 'cancelling';
      phase?: SessionRunPhase;
    };
  };
};

export type SettingsRevisionConflictProblem = {
  code: 'settings-revision-conflict';
  data: {
    expectedRevision: string;
    actualRevision: string;
    conflictingDomains: string[];
    snapshot?: unknown;
  };
};

export type TicketConsumedProblem = {
  code: 'ticket-consumed';
  data: { requestId: string };
};

export type NotesRevisionConflictProblem = {
  code: 'notes-revision-conflict';
  data: { noteId: string; actualContentHash?: string };
};

export type TodoRevisionConflictProblem = {
  code: 'todo-revision-conflict';
  data: { sessionId: string; actualRevision: string };
};

export type RetryDiscardsWritesProblem = {
  code: 'retry-discards-writes';
  data: import('./workspace-writes.js').WorkspaceWrites;
};

/** Edit/open-branch leaving the active attempt that wrote workspace files. */
export type BranchLeavesWritesProblem = {
  code: 'branch-leaves-writes';
  data: import('./workspace-writes.js').WorkspaceWrites;
};

export type SessionBusyProblem = {
  code: 'session-busy';
  data: { sessionId: string; reason: 'body-job' | 'foreground-run' };
};

export type IdempotencyKeyRequiredProblem = {
  code: 'idempotency-key-required';
};

export type IdempotencyConflictProblem = {
  code: 'idempotency-conflict';
};

export type IdempotencyRegistryCapacityProblem = {
  code: 'idempotency-registry-capacity';
};

export type IdempotencyReplayOmittedProblem = {
  code: 'idempotency-replay-omitted';
};
