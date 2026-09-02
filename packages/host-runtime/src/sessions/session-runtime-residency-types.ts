/**
 * Public types for the session runtime residency controller (ADR 0040 §2–§5).
 */

import type {
  SessionRuntimeEvictionReason,
  SessionRuntimeResidency,
  SessionRuntimeRetentionConfig,
} from '@piwin/contracts';

/** Residency state for one resident session (non-cold). */
export type ResidentRuntimeState = Exclude<SessionRuntimeResidency, 'cold'>;

/** Per-session residency bookkeeping. */
export type ResidentRuntimeEntry = {
  sessionId: string;
  runtimeGenerationId: string;
  state: ResidentRuntimeState;
  /** Monotonic clock time of the most recent touch/transition (ms). */
  lastUsedAtMs: number;
  /** Absolute deadline (ms) for an idle runtime; undefined while busy. */
  idleDeadlineMs?: number;
  /** Count of explicit protection leases (compaction, backend ops). */
  protectionCount: number;
  /** Last eviction/suspension reason, retained only while resident. */
  lastEvictionReason?: SessionRuntimeEvictionReason;
  /**
   * Task-scoped (subagent) runtime. Counts against capacity, never enters
   * `resident-idle`, and is never an idle-eviction victim.
   */
  ephemeral?: true;
};

/** Aggregate memory sample for admission. */
export type ResidencyMemorySample = {
  /** Host process RSS in MiB. */
  hostRssMiB: number;
  /** Aggregate worker RSS in MiB; undefined when no workers are running. */
  workerRssMiB?: number;
  /** True when every expected worker sample is fresh. */
  sampleCompleteness: 'complete' | 'partial' | 'missing';
};

/** Counts of a runtime by residency state (for metrics/doctor). */
export type ResidencyCounts = {
  resident: number;
  activating: number;
  residentIdle: number;
  residentBusy: number;
  suspending: number;
  waiterCount: number;
  /** Resident entries created with `{ ephemeral: true }`. */
  ephemeral: number;
};

/** Bounded aggregate eviction/failure counters. */
export type ResidencyCounters = {
  evictedByIdleTtl: number;
  evictedByMaxIdle: number;
  evictedByMaxResident: number;
  evictedByMemoryPressure: number;
  memoryPressureFailures: number;
};

export type ResidencyControllerOptions = {
  /** Normalized retention policy (ADR 0040 §3). */
  retention: SessionRuntimeRetentionConfig;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  nowMs?: () => number;
  /** Samples aggregate Host/worker RSS for admission. Omit to disable RSS pressure. */
  sampleMemory?: () => ResidencyMemorySample;
  /**
   * Resolve the effective maximum resident runtimes. When omitted the
   * controller derives it from the retention config plus idle allowance,
   * clamped to the backend hard cap and the absolute ceiling.
   */
  resolveMaxResidentRuntimes?: () => number;
  /** Sweep interval (ms). Defaults to 30s. Only runs while a runtime is resident. */
  sweepIntervalMs?: number;
  /** Callback for residency status changes (push emission). */
  onResidencyChanged?: (entry: ResidentRuntimeEntry) => void;
  /**
   * Host-provided blocker predicate (ADR 0040 §5). Return true when a session
   * must never be evicted: an active/cancelling Run, a pending permission or
   * Extension UI request, an in-flight compaction or replacement, or any
   * transition already in progress. The controller never evicts such a
   * runtime, so admission prefers waiting over killing busy work.
   */
  isRuntimeProtected?: (sessionId: string) => boolean;
  /**
   * Performs the Host-owned suspension transaction while the entry remains in
   * `suspending`. Return true only after recorder flush, backend drop, and
   * resident-map cleanup have completed. Returning false restores residency.
   */
  suspendRuntime?: (input: {
    sessionId: string;
    runtimeGenerationId: string;
    reason: SessionRuntimeEvictionReason;
  }) => Promise<boolean>;
  /**
   * Fires on every periodic sweep while at least one runtime is resident
   * (default every 30s). Used by the Host to refresh cross-process runtime
   * lease heartbeats so a long-idle resident session never looks abandoned.
   */
  onSweep?: () => void;
};

/** Public controller surface. */
export type SessionRuntimeResidencyController = {
  /** Residency state for one session, or 'cold' when not resident. */
  getResidency: (sessionId: string) => SessionRuntimeResidency;
  /** Full resident entry snapshot for status composition. */
  getEntry: (sessionId: string) => ResidentRuntimeEntry | undefined;
  /** Touch (mark recently used) an existing resident runtime. */
  touch: (sessionId: string, runtimeGenerationId: string) => void;
  /** Apply a newly persisted normalized retention policy. */
  updateRetention: (retention: SessionRuntimeRetentionConfig) => void;
  /**
   * Begin an activation. Resolves when capacity is reserved (may wait for an
   * eviction or a busy runtime to finish). Rejects on abort or memory pressure.
   * `{ ephemeral: true }` admits a task-scoped runtime that never idle-retains.
   */
  beginActivation: (
    sessionId: string,
    runtimeGenerationId: string,
    signal: AbortSignal,
    options?: { ephemeral?: boolean },
  ) => Promise<ActivationResult>;
  /**
   * Commit a successfully created generation. Foreground entries become
   * `resident-idle`; ephemeral entries become `resident-busy`.
   */
  commitActivation: (sessionId: string, runtimeGenerationId: string) => void;
  /** Abort a failed activation and release its reservation. */
  abortActivation: (sessionId: string, runtimeGenerationId: string) => void;
  /** Mark a runtime busy (protected operation in flight). */
  markBusy: (sessionId: string, runtimeGenerationId: string) => void;
  /** Mark a runtime idle again (protected operation finished). */
  markIdle: (sessionId: string, runtimeGenerationId: string) => void;
  /** Acquire an explicit protection lease (compaction/backend op). */
  protect: (sessionId: string, runtimeGenerationId: string) => boolean;
  /** Release one protection lease. */
  releaseProtection: (sessionId: string, runtimeGenerationId: string) => void;
  /** Whether a session holds an explicit protection lease or is busy. */
  isProtected: (sessionId: string) => boolean;
  /**
   * Suspension transaction. Returns 'started' when the runtime is marked
   * `suspending` and the caller must run cleanup, then call `finishSuspend`.
   */
  beginSuspend: (
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ) => SuspendResult;
  /** Complete a suspension and release the residency entry. */
  finishSuspend: (sessionId: string, runtimeGenerationId: string) => void;
  /**
   * Restore a `suspending` runtime to `resident-idle` when Host cleanup fails
   * (recorder flush error) so the runtime stays resident (ADR 0040 §6).
   */
  abortSuspend: (sessionId: string, runtimeGenerationId: string) => boolean;
  /** Run and deduplicate the complete Host suspension transaction. */
  requestSuspend: (
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ) => Promise<boolean>;
  /** Force an eviction sweep now (tests and host dispose). */
  sweepNow: () => Promise<void>;
  /**
   * Release a task-scoped runtime in `activating` or `resident-busy` and grant
   * queued waiters. Repeated calls are idempotent.
   */
  releaseEphemeral: (sessionId: string, runtimeGenerationId: string) => void;
  /**
   * Re-run idle eviction and grant waiters after an external resident-cap
   * change. Same internal pattern as `updateRetention`.
   */
  revisitCapacity: () => void;
  /** Stop the sweep timer and clear all state. */
  dispose: () => void;
  /** Aggregate counts for metrics/doctor. */
  getCounts: () => ResidencyCounts;
  /** Aggregate eviction/failure counters. */
  getCounters: () => ResidencyCounters;
  /** Effective resident-runtime ceiling after adaptive/default resolution. */
  getMaxResidentRuntimes: () => number;
  /** Whether at least one runtime is resident. */
  hasResident: () => boolean;
};

export type ActivationResult =
  { ok: true } | { ok: false; code: 'aborted' | 'memory-pressure'; message: string };

export type SuspendResult =
  | { ok: true; status: 'started' }
  | { ok: false; reason: 'not-resident' | 'generation-mismatch' | 'protected' };
