/**
 * CE-JOB: unified job control contracts (runtime-refactor Phase 1).
 *
 * Jobs are Host-owned non-interactive OS child processes. Two kinds:
 * - `command`: expected to terminate (tests, builds).
 * - `service`: expected to stay alive until stopped (dev server).
 *
 * Jobs and Runs are separate lifecycles linked by owner identities.
 * `@piwin/process` owns implementation; `@piwin/host-runtime` constructs
 * one `JobController` and is the only product Job authority.
 */

/** Job kind: command terminates, service stays alive. */
export type JobKind = 'command' | 'service';

/** Job lifetime determines when it is automatically stopped. */
export type JobLifetime = 'run' | 'session' | 'host';

/** Job lifecycle status. Terminal states are immutable. */
export type JobStatus =
  | 'starting'
  | 'running'
  | 'ready'
  | 'stopping'
  | 'exited'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** Stable reason for terminal transition. */
export type JobTerminalReason =
  | 'completed'
  | 'failed'
  | 'user-stop'
  | 'run-completed'
  | 'run-cancelled'
  | 'session-closed'
  | 'host-shutdown'
  | 'startup-failed'
  | 'readiness-failed'
  | 'stop-failed'
  | 'process-error'
  | 'host-restarted';

/** Immutable job record. Terminal records never change after terminalization. */
export type JobRecord = {
  jobId: string;
  kind: JobKind;
  lifetime: JobLifetime;
  command: string;
  argv: string[];
  cwd: string;
  status: JobStatus;
  ownerRunId?: string;
  ownerSessionId?: string;
  ownerProjectPath?: string;
  label?: string;
  processId?: number;
  processGroupId?: number;
  startedAt: string;
  readyAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  terminalReason?: JobTerminalReason;
  lastError?: string;
  latestLogCursor: number;
};

/** Result of a cleanup operation that stops multiple jobs. */
export type JobCleanupResult = {
  requestedJobIds: string[];
  stoppedJobIds: string[];
  alreadyTerminalJobIds: string[];
  failedJobIds: string[];
};

/** Result of stopping a single job (includes cascade cleanup). */
export type JobStopResult = {
  job: JobRecord;
  cleanup: JobCleanupResult;
};

/** Readiness probe configuration for service jobs. */
export type JobReadinessProbe =
  | { type: 'none' }
  | { type: 'tcp'; port: number; host?: string; timeoutMs?: number }
  | {
      type: 'http';
      port: number;
      host?: string;
      path?: string;
      timeoutMs?: number;
    };

/** Input for starting a new job. */
export type StartJobInput = {
  kind: JobKind;
  lifetime: JobLifetime;
  command: string;
  argv: string[];
  cwd: string;
  ownerRunId?: string;
  ownerSessionId?: string;
  ownerProjectPath?: string;
  label?: string;
  /** Secret-like env values must be redacted in logs. Never persisted or returned. */
  env?: Record<string, string>;
  readinessProbe?: JobReadinessProbe;
};

/** Filter for listing jobs. */
export type JobListFilter = {
  status?: JobStatus | JobStatus[];
  kind?: JobKind;
  lifetime?: JobLifetime;
  ownerRunId?: string;
  ownerSessionId?: string;
  ownerProjectPath?: string;
};

/** Input for reading job logs. */
export type ReadJobLogsInput = {
  jobId: string;
  /** Monotonic cursor (exclusive lower bound). Default 0 = from start. */
  afterCursor?: number;
  /** Maximum number of bytes to return. */
  maxBytes?: number;
};

/** Result of reading job logs. */
export type ReadJobLogsResult = {
  jobId: string;
  chunks: JobLogChunk[];
  /** Cursor to pass for the next page (exclusive upper bound consumed). */
  nextCursor: number;
  /** True when there are more logs beyond nextCursor. */
  hasMore: boolean;
};

/** A single log chunk with monotonic cursor. */
export type JobLogChunk = {
  jobId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  at: string;
  /** Monotonic position for cursor-based pagination. */
  cursor: number;
};

/** Input for waiting on a job. */
export type WaitForJobInput = {
  jobId: string;
  /** Optional timeout in milliseconds. */
  timeoutMs?: number;
};

/** Job controller interface — the only product Job authority surface. */
/**
 * Host-internal admission for one Job start (ADR 0019 §4.1). Never read from a
 * client command: `job/start` passes only `StartJobInput`, so clients keep the
 * trusted-project check.
 */
export type StartJobAdmission = {
  /** Directories the Host permission layer admitted as this Job's cwd root. */
  admittedCwdRoots?: readonly string[];
};

export interface JobController {
  start(input: StartJobInput, admission?: StartJobAdmission): Promise<JobRecord>;
  list(filter?: JobListFilter): Promise<JobRecord[]>;
  get(jobId: string): Promise<JobRecord | undefined>;
  readLogs(input: ReadJobLogsInput): Promise<ReadJobLogsResult>;
  wait(input: WaitForJobInput, signal: AbortSignal): Promise<JobRecord>;
  stop(jobId: string, reason: JobTerminalReason): Promise<JobStopResult>;
  stopByRun(runId: string, reason: JobTerminalReason): Promise<JobCleanupResult>;
  stopBySession(sessionId: string, reason: JobTerminalReason): Promise<JobCleanupResult>;
  dispose(): Promise<JobCleanupResult>;
}

/** Job push variants for HostPush. */
export type JobHostPush =
  | { type: 'job/started'; job: JobRecord }
  | { type: 'job/updated'; job: JobRecord }
  | { type: 'job/ready'; job: JobRecord }
  | { type: 'job/log'; chunk: JobLogChunk }
  | { type: 'job/exited'; job: JobRecord };

/** Check if a job status is terminal (immutable). */
export function isJobTerminal(status: JobStatus): boolean {
  return (
    status === 'exited' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted'
  );
}

/** Check if a job status is active (non-terminal). */
export function isJobActive(status: JobStatus): boolean {
  return (
    status === 'starting' ||
    status === 'running' ||
    status === 'ready' ||
    status === 'stopping'
  );
}

/** Validate owner requirements for a start input. Returns issues (never throws). */
export function validateStartJobInput(input: StartJobInput): string[] {
  const issues: string[] = [];

  if (!input.command || typeof input.command !== 'string') {
    issues.push('command is required');
  }
  if (!Array.isArray(input.argv)) {
    issues.push('argv must be an array');
  } else {
    for (const arg of input.argv) {
      if (typeof arg !== 'string') {
        issues.push('argv entries must be strings');
        break;
      }
    }
  }
  if (!input.cwd || typeof input.cwd !== 'string') {
    issues.push('cwd is required');
  }

  // Owner requirements are structural.
  if (input.lifetime === 'run' && !input.ownerRunId) {
    issues.push('run lifetime requires ownerRunId');
  }
  if (input.lifetime === 'session' && !input.ownerSessionId) {
    issues.push('session lifetime requires ownerSessionId');
  }
  // host lifetime requires no lower owner — intentionally no check.

  return issues;
}
