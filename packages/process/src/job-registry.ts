/**
 * Unified job registry implementing the JobController interface.
 *
 * Phase 1 runtime refactor: the legacy managed-process compatibility layer
 * was removed; this module is the Host-owned primitive for non-interactive
 * OS child processes.
 *
 * JC-01: @piwin/process owns Job implementation.
 * JC-02: host-runtime constructs one JobController (this).
 * JC-03: Jobs and Runs remain separate, linked by owner identities.
 * JC-04: run, session, and host are the supported automatic cleanup lifetimes.
 * JC-05: Run-lifetime Jobs stop on every Run terminal path.
 * JC-06: Stop targets the process group/tree.
 * JC-07: Logs use monotonic cursors, bounded memory tail, redaction.
 * JC-08: Service readiness supports none, tcp, http; no restart policy.
 * JC-09: argv-only spawn; shell command strings are forbidden.
 * JC-11: Agent exposure is compiled through SessionToolPolicy.
 * JC-12: Jobs are not Agent worker processes.
 */

import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type {
  JobCleanupResult,
  JobController,
  JobKind,
  JobLifetime,
  JobLogChunk,
  JobRecord,
  JobStatus,
  JobStopResult,
  JobTerminalReason,
  ReadJobLogsInput,
  ReadJobLogsResult,
  StartJobInput,
  WaitForJobInput,
  JobListFilter,
  JobReadinessProbe,
} from '@piwin/contracts';
import { isJobTerminal, validateStartJobInput } from '@piwin/contracts';

import { resolveTrustedCwd } from './cwd-policy.js';
import { createJobLogStore, type JobLogStore } from './job-log-store.js';
import {
  DEFAULT_MAX_RETAINED_TERMINAL_ENTRIES,
  DEFAULT_MAX_RETAINED_TERMINAL_LOG_JOBS,
  JobTerminalRetention,
} from './job-terminal-retention.js';
import {
  createProcessSupervisor,
  type ProcessSupervisor,
  type ProcessSupervisorOptions,
  type SupervisedProcess,
} from './process-supervisor.js';
import { observeProcessClose } from './process-close-observer.js';
import type { JobRecordStore } from './job-record-store.js';

/** Default maximum concurrent jobs. */
const DEFAULT_MAX_JOBS = 8;

/** Default readiness probe timeout. */
const DEFAULT_READINESS_TIMEOUT_MS = 30_000;

/** Default wait timeout for job.wait(). */
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

/** Log throttle interval for batched log emission. */
const DEFAULT_LOG_THROTTLE_MS = 100;

/** Event emitted by the job registry. */
export type JobRegistryEvent =
  | { type: 'job/started'; job: JobRecord }
  | { type: 'job/updated'; job: JobRecord }
  | { type: 'job/ready'; job: JobRecord }
  | { type: 'job/log'; chunk: JobLogChunk }
  | { type: 'job/exited'; job: JobRecord };

export type JobRegistryOptions = {
  /** Maximum concurrent active jobs. Default 8. */
  maxJobs?: number;
  /** Resolve the current Host-composed admission policy for each start. */
  getJobPolicy?: () => JobPolicy | Promise<JobPolicy>;
  /** Grace period after SIGTERM before SIGKILL. */
  killGraceMs?: number;
  /** Throttle interval for log emission. */
  logThrottleMs?: number;
  /** Inject clock for tests. */
  now?: () => Date;
  /** Inject id generator for tests. */
  createId?: () => string;
  /** Trusted project roots for cwd validation. */
  getTrustedProjectRoots?: () => readonly string[] | Promise<readonly string[]>;
  /** Event callback for pushes. */
  onEvent?: (event: JobRegistryEvent) => void;
  /** Inject log store for tests. */
  logStore?: JobLogStore;
  /** Inject process supervisor for tests. */
  processSupervisor?: ProcessSupervisor;
  /** Optional durable store for JobRecord persistence across host restarts. */
  recordStore?: JobRecordStore;
  /** Terminal entries retained in memory; older ones are evicted. Default 64. */
  maxRetainedTerminalEntries?: number;
  /** Terminal jobs whose log buffers stay resident; older buffers are cleared. Default 8. */
  maxRetainedTerminalLogJobs?: number;
};

/** Host-composed admission policy for new Jobs. */
export type JobPolicy = {
  /** Whether new Job admission is enabled. Existing Jobs are not stopped when disabled. */
  enabled: boolean;
  /** Maximum number of concurrently active Jobs. */
  maxActiveJobs: number;
};

/** Internal entry tracking a job and its process. */
interface JobEntry {
  record: JobRecord;
  supervised: SupervisedProcess | null;
  /** Pending log text buffered for throttled emission. */
  pendingLogText: string;
  pendingLogStream: 'stdout' | 'stderr' | 'system';
  logFlushTimer: ReturnType<typeof setTimeout> | null;
  /** Whether the job was intentionally stopped (vs natural exit). */
  intentionalStop: boolean;
  /** Readiness probe state. */
  readinessProbe: JobReadinessProbe;
  readinessTimer: ReturnType<typeof setTimeout> | null;
  /** Resolvers for wait() calls. */
  waitResolvers: Array<(record: JobRecord) => void>;
  /** Abort controllers for readiness probes. */
  readinessAbort: AbortController | null;
  /** Terminal result selected before an asynchronous stop completes. */
  terminalOverride: {
    status: JobStatus;
    reason: JobTerminalReason;
    exitCode: number | null;
    lastError?: string;
  } | null;
  /** Prevents a close event from terminalizing before readiness cleanup finishes. */
  stopInProgress: boolean;
  /** Exit code observed while terminalization is deferred. */
  pendingExitCode: number | null | undefined;
}

function isStatusActive(status: JobStatus): boolean {
  return (
    status === 'starting' ||
    status === 'running' ||
    status === 'ready' ||
    status === 'stopping'
  );
}

function isStatusRunningLike(status: JobStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'ready';
}

function cloneRecord(record: JobRecord): JobRecord {
  return { ...record, argv: [...record.argv] };
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

export function createJobRegistry(options: JobRegistryOptions = {}): JobController {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => randomUUID());
  const getTrustedProjectRoots = options.getTrustedProjectRoots ?? (() => []);
  const onEvent = options.onEvent;
  const logThrottleMs = options.logThrottleMs ?? DEFAULT_LOG_THROTTLE_MS;
  const defaultJobPolicy: JobPolicy = {
    enabled: true,
    maxActiveJobs: options.maxJobs ?? DEFAULT_MAX_JOBS,
  };
  const getJobPolicy = options.getJobPolicy ?? (() => defaultJobPolicy);

  const logStore: JobLogStore = options.logStore ?? createJobLogStore();
  const supervisorOptions: ProcessSupervisorOptions = { now };
  if (options.killGraceMs !== undefined) {
    supervisorOptions.killGraceMs = options.killGraceMs;
  }
  const supervisor: ProcessSupervisor =
    options.processSupervisor ?? createProcessSupervisor(supervisorOptions);

  const entries = new Map<string, JobEntry>();
  const maxRetainedTerminalEntries =
    options.maxRetainedTerminalEntries !== undefined &&
    Number.isInteger(options.maxRetainedTerminalEntries) &&
    options.maxRetainedTerminalEntries > 0
      ? options.maxRetainedTerminalEntries
      : DEFAULT_MAX_RETAINED_TERMINAL_ENTRIES;
  const maxRetainedTerminalLogJobs =
    options.maxRetainedTerminalLogJobs !== undefined &&
    Number.isInteger(options.maxRetainedTerminalLogJobs) &&
    options.maxRetainedTerminalLogJobs > 0
      ? options.maxRetainedTerminalLogJobs
      : DEFAULT_MAX_RETAINED_TERMINAL_LOG_JOBS;
  /**
   * Bounded retention for terminal jobs: drops old log ring buffers and old
   * resident entries (records stay durable in the record store).
   */
  const terminalRetention = new JobTerminalRetention({
    maxRetainedTerminalEntries,
    maxRetainedTerminalLogJobs,
    dropEntry: (jobId) => {
      entries.delete(jobId);
    },
    clearLogs: (jobId) => {
      logStore.clear(jobId);
    },
  });
  const recordStore = options.recordStore;
  let disposed = false;

  /** Build a non-running registry entry from a persisted record. */
  function reviveEntry(record: JobRecord): JobEntry {
    return {
      record,
      supervised: null,
      pendingLogText: '',
      pendingLogStream: 'stdout',
      logFlushTimer: null,
      intentionalStop: false,
      readinessProbe: { type: 'none' },
      readinessTimer: null,
      waitResolvers: [],
      readinessAbort: null,
      terminalOverride: null,
      stopInProgress: false,
      pendingExitCode: undefined,
    };
  }

  function terminalSortTime(record: JobRecord): number {
    const stamp = record.endedAt ?? record.startedAt ?? '';
    const parsed = Date.parse(stamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Reconcile persisted records on startup: load records from the store,
   * mark any that were active (starting/running/ready/stopping) when the
   * host last exited as `interrupted` with terminal reason `host-restarted`,
   * and retain only the newest terminal records in memory. No PID
   * reattachment is attempted — the OS processes are gone.
   */
  function reconcilePersistedRecords(): void {
    if (!recordStore) return;
    const stored = recordStore.loadAll();
    // Bound what stays resident: everything active is always reconciled, but
    // only the newest terminal records are revived; older ones remain durable
    // in the store without occupying RAM for the host's whole lifetime.
    const retainedTerminal = stored
      .filter((record) => !isStatusActive(record.status))
      .sort((a, b) => terminalSortTime(b) - terminalSortTime(a))
      .slice(0, maxRetainedTerminalEntries);
    const retainedIds = new Set(retainedTerminal.map((record) => record.jobId));

    for (const record of stored) {
      const wasActive = isStatusActive(record.status);
      if (!wasActive && !retainedIds.has(record.jobId)) {
        continue;
      }
      const revived: JobRecord = wasActive
        ? {
            ...record,
            argv: [...record.argv],
            status: 'interrupted',
            terminalReason: 'host-restarted',
            endedAt: nowIso(now),
          }
        : { ...record, argv: [...record.argv] };
      entries.set(revived.jobId, reviveEntry(revived));
      if (wasActive) {
        // The host restarted while this job was still active. The OS process
        // is no longer tracked; mark it interrupted so the user sees what
        // happened rather than a stale "running" record.
        recordStore.save(revived);
      }
    }
    // Retained terminal ids are newest-first; seed oldest-first order. The
    // freshly-interrupted records go last (most recent) so the interruption
    // signal survives the longest under the retention cap.
    for (let index = retainedTerminal.length - 1; index >= 0; index -= 1) {
      const record = retainedTerminal[index];
      if (record) {
        terminalRetention.seed(record.jobId);
      }
    }
    for (const record of stored) {
      if (isStatusActive(record.status)) {
        terminalRetention.seed(record.jobId);
      }
    }
    terminalRetention.evictExcess();
  }

  /** Persist a record to the store if one is configured. */
  function persistRecord(entry: JobEntry): void {
    if (!recordStore) return;
    recordStore.save(publicRecord(entry));
  }

  reconcilePersistedRecords();

  function emit(event: JobRegistryEvent): void {
    onEvent?.(event);
  }

  function publicRecord(entry: JobEntry): JobRecord {
    return cloneRecord(entry.record);
  }

  function activeCount(): number {
    let count = 0;
    for (const entry of entries.values()) {
      if (isStatusActive(entry.record.status)) {
        count += 1;
      }
    }
    return count;
  }

  function appendLog(
    entry: JobEntry,
    stream: 'stdout' | 'stderr' | 'system',
    rawText: string,
  ): void {
    if (!rawText) return;

    const redactedText = logStore.append(entry.record.jobId, stream, rawText);

    // Throttle log emission to avoid flooding the event stream.
    entry.pendingLogText += redactedText;
    if (entry.pendingLogStream !== stream && entry.pendingLogText.length > 0) {
      // Flush previous stream text before switching.
      flushLog(entry);
      entry.pendingLogStream = stream;
    }
    scheduleLogFlush(entry);
  }

  function scheduleLogFlush(entry: JobEntry): void {
    if (entry.logFlushTimer) return;
    entry.logFlushTimer = setTimeout(() => {
      flushLog(entry);
    }, logThrottleMs);
    if (typeof entry.logFlushTimer.unref === 'function') {
      entry.logFlushTimer.unref();
    }
  }

  function flushLog(entry: JobEntry): void {
    if (entry.logFlushTimer) {
      clearTimeout(entry.logFlushTimer);
      entry.logFlushTimer = null;
    }
    const pending = entry.pendingLogText;
    const stream = entry.pendingLogStream;
    entry.pendingLogText = '';
    if (!pending) return;

    const latestCursor = logStore.getLatestCursor(entry.record.jobId);
    const chunk: JobLogChunk = {
      jobId: entry.record.jobId,
      stream,
      text: pending,
      at: nowIso(now),
      cursor: latestCursor,
    };
    emit({ type: 'job/log', chunk });
  }

  function markTerminal(
    entry: JobEntry,
    status: JobStatus,
    reason: JobTerminalReason,
    exitCode: number | null | undefined,
    lastError?: string,
    retainSupervised = false,
  ): void {
    if (isJobTerminal(entry.record.status)) return;

    // Flush any pending logs before terminalizing.
    flushLog(entry);

    // Cancel readiness probe if active.
    if (entry.readinessAbort) {
      entry.readinessAbort.abort();
      entry.readinessAbort = null;
    }
    if (entry.readinessTimer) {
      clearTimeout(entry.readinessTimer);
      entry.readinessTimer = null;
    }

    entry.record.status = status;
    entry.record.endedAt = nowIso(now);
    entry.record.terminalReason = reason;
    if (exitCode !== undefined) {
      entry.record.exitCode = exitCode;
    }
    if (lastError) {
      entry.record.lastError = lastError;
    }
    entry.record.latestLogCursor = logStore.getLatestCursor(entry.record.jobId);
    if (!retainSupervised) {
      entry.supervised = null;
    }
    entry.terminalOverride = null;

    emit({ type: 'job/updated', job: publicRecord(entry) });
    emit({ type: 'job/exited', job: publicRecord(entry) });
    persistRecord(entry);

    // Resolve any wait() calls.
    const record = publicRecord(entry);
    for (const resolve of entry.waitResolvers) {
      resolve(record);
    }
    entry.waitResolvers = [];

    terminalRetention.retain(entry.record.jobId);
  }

  function scheduleLogFlushEntry(entry: JobEntry): void {
    scheduleLogFlush(entry);
  }

  // -- start ---------------------------------------------------------------

  async function start(input: StartJobInput): Promise<JobRecord> {
    if (disposed) {
      throw new Error('JobRegistry is disposed');
    }

    const issues = validateStartJobInput(input);
    if (issues.length > 0) {
      throw new Error(`invalid job input: ${issues.join('; ')}`);
    }

    const jobPolicy = await getJobPolicy();
    if (!jobPolicy.enabled) {
      throw new Error('Jobs are disabled by settings');
    }
    const maxActiveJobs = Number.isInteger(jobPolicy.maxActiveJobs) && jobPolicy.maxActiveJobs > 0
      ? jobPolicy.maxActiveJobs
      : DEFAULT_MAX_JOBS;
    if (activeCount() >= maxActiveJobs) {
      throw new Error(`maxJobs reached (${maxActiveJobs})`);
    }

    const trustedRoots = await Promise.resolve(getTrustedProjectRoots());
    const cwdResult = resolveTrustedCwd(input.cwd, trustedRoots);
    if (!cwdResult.ok) {
      throw new Error(cwdResult.reason);
    }

    const jobId = createId();
    const record: JobRecord = {
      jobId,
      kind: input.kind,
      lifetime: input.lifetime,
      command: input.command,
      argv: [...input.argv],
      cwd: cwdResult.absoluteCwd,
      status: 'starting',
      startedAt: nowIso(now),
      latestLogCursor: 0,
    };
    if (input.ownerRunId) record.ownerRunId = input.ownerRunId;
    if (input.ownerSessionId) record.ownerSessionId = input.ownerSessionId;
    if (input.ownerProjectPath) record.ownerProjectPath = input.ownerProjectPath;
    if (input.label) record.label = input.label;

    const entry: JobEntry = {
      record,
      supervised: null,
      pendingLogText: '',
      pendingLogStream: 'stdout',
      logFlushTimer: null,
      intentionalStop: false,
      readinessProbe: input.readinessProbe ?? { type: 'none' },
      readinessTimer: null,
      waitResolvers: [],
      readinessAbort: null,
      terminalOverride: null,
      stopInProgress: false,
      pendingExitCode: undefined,
    };
    entries.set(jobId, entry);

    try {
      const supervised = await supervisor.spawn({
        command: input.command,
        argv: input.argv,
        cwd: input.cwd,
        ...(input.env ? { env: input.env } : {}),
        trustedProjectRoots: trustedRoots,
      });

      entry.supervised = supervised;
      entry.record.processId = supervised.processId;
      entry.record.processGroupId = supervised.processGroupId;
      entry.record.status = 'running';

      // Wire stdout/stderr.
      supervised.child.stdout?.on('data', (buffer: Buffer) => {
        appendLog(entry, 'stdout', buffer.toString('utf8'));
      });
      supervised.child.stderr?.on('data', (buffer: Buffer) => {
        appendLog(entry, 'stderr', buffer.toString('utf8'));
      });

      supervised.child.on('error', (error: Error) => {
        appendLog(entry, 'system', `process error: ${error.message}\n`);
        if (isStatusRunningLike(entry.record.status)) {
          markTerminal(entry, 'failed', 'process-error', null, error.message);
        }
      });

      const finalizeClose = (code: number | null): void => {
        if (entry.stopInProgress && entry.terminalOverride) {
          entry.pendingExitCode = code;
          appendLog(entry, 'system', `stopped exitCode=${code ?? 'null'}\n`);
          return;
        }

        if (isJobTerminal(entry.record.status)) return;

        if (entry.terminalOverride) {
          const override = entry.terminalOverride;
          appendLog(entry, 'system', `exited exitCode=${code ?? 'null'}\n`);
          markTerminal(
            entry,
            override.status,
            override.reason,
            code,
            override.lastError,
          );
          return;
        }

        if (entry.intentionalStop) {
          // Intentional stop: preserve the reason set by stop() (e.g. 'user-stop',
          // 'run-cancelled', 'host-shutdown'). Status is 'cancelled'.
          appendLog(entry, 'system', `stopped exitCode=${code ?? 'null'}\n`);
          markTerminal(entry, 'cancelled', entry.record.terminalReason ?? 'user-stop', code);
        } else {
          // Fix K: Signal termination (code === null) is a failure, not completion.
          const completed = code === 0;
          const reason: JobTerminalReason = completed ? 'completed' : 'failed';
          appendLog(entry, 'system', `exited exitCode=${code ?? 'null'}\n`);
          markTerminal(entry, completed ? 'exited' : 'failed', reason, code);
        }
      };

      supervised.child.on('close', (code: number | null) => {
        observeProcessClose({
          supervised,
          exitCode: code,
          finalize: finalizeClose,
          reportCleanupFailure: (error: unknown) => {
            appendLog(
              entry,
              'system',
              `process-group cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          },
        });
      });

      // Start readiness probe if configured.
      if (input.kind === 'service' && entry.readinessProbe.type !== 'none') {
        startReadinessProbe(entry);
      }

      // Emit started + updated.
      emit({ type: 'job/started', job: publicRecord(entry) });
      emit({ type: 'job/updated', job: publicRecord(entry) });
      persistRecord(entry);
      appendLog(
        entry,
        'system',
        `started pid=${supervised.processId} ${input.command} ${input.argv.join(' ')}\n`,
      );

      return publicRecord(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(entry, 'system', `spawn failed: ${message}\n`);
      markTerminal(entry, 'failed', 'startup-failed', null, message);
      throw new Error(`job start failed: ${message}`);
    }
  }

  // -- readiness probe -----------------------------------------------------

  function startReadinessProbe(entry: JobEntry): void {
    const probe = entry.readinessProbe;
    if (probe.type === 'none') return;

    const timeoutMs = probe.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    const abort = new AbortController();
    entry.readinessAbort = abort;

    const host = probe.host ?? '127.0.0.1';

    const timer = setTimeout(() => {
      // The timeout path must stop the child before publishing its terminal
      // failure. The close handler is deferred while this cleanup is pending.
      void handleReadinessTimeout(entry);
    }, timeoutMs);
    entry.readinessTimer = timer;
    if (typeof timer.unref === 'function') timer.unref();

    if (probe.type === 'tcp') {
      probeTcp(host, probe.port, abort.signal)
        .then((success) => {
          if (
            success &&
            entry.record.status === 'running' &&
            !entry.stopInProgress &&
            !entry.terminalOverride
          ) {
            clearTimeout(timer);
            entry.record.status = 'ready';
            entry.record.readyAt = nowIso(now);
            emit({ type: 'job/ready', job: publicRecord(entry) });
            emit({ type: 'job/updated', job: publicRecord(entry) });
            persistRecord(entry);
          }
        })
        .catch(() => {
          // probe failed — timeout handler will deal with it
        });
    } else if (probe.type === 'http') {
      probeHttp(host, probe.port, probe.path ?? '/', abort.signal)
        .then((success) => {
          if (
            success &&
            entry.record.status === 'running' &&
            !entry.stopInProgress &&
            !entry.terminalOverride
          ) {
            clearTimeout(timer);
            entry.record.status = 'ready';
            entry.record.readyAt = nowIso(now);
            emit({ type: 'job/ready', job: publicRecord(entry) });
            emit({ type: 'job/updated', job: publicRecord(entry) });
            persistRecord(entry);
          }
        })
        .catch(() => {
          // probe failed — timeout handler will deal with it
        });
    }
  }

  async function handleReadinessTimeout(entry: JobEntry): Promise<void> {
    if (!isStatusRunningLike(entry.record.status)) return;

    const errorMessage = 'readiness probe timeout';
    entry.readinessAbort?.abort();
    entry.terminalOverride = {
      status: 'failed',
      reason: 'readiness-failed',
      exitCode: null,
      lastError: errorMessage,
    };
    entry.stopInProgress = true;
    entry.record.status = 'stopping';
    emit({ type: 'job/updated', job: publicRecord(entry) });
    persistRecord(entry);
    appendLog(entry, 'system', `${errorMessage}\n`);

    const supervised = entry.supervised;
    if (!supervised) {
      entry.stopInProgress = false;
      markTerminal(entry, 'failed', 'readiness-failed', null, errorMessage);
      return;
    }

    try {
      await supervisor.stop(supervised);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry.stopInProgress = false;
      appendLog(entry, 'system', `stop failed: ${message}\n`);
      markTerminal(entry, 'failed', 'stop-failed', null, message, true);
      return;
    }

    entry.stopInProgress = false;
    if (!isJobTerminal(entry.record.status)) {
      const override = entry.terminalOverride;
      if (entry.pendingExitCode === undefined) {
        appendLog(entry, 'system', 'stopped exitCode=null\n');
      }
      markTerminal(
        entry,
        override?.status ?? 'failed',
        override?.reason ?? 'readiness-failed',
        entry.pendingExitCode ?? override?.exitCode ?? null,
        override?.lastError ?? errorMessage,
      );
    }
  }

  async function probeTcp(host: string, port: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const conn = createConnection({ host, port }, () => {
        conn.destroy();
        resolve(true);
      });
      conn.on('error', () => resolve(false));
      signal.addEventListener('abort', () => {
        conn.destroy();
        resolve(false);
      }, { once: true });
    });
  }

  async function probeHttp(host: string, port: number, path: string, signal: AbortSignal): Promise<boolean> {
    try {
      const url = `http://${host}:${port}${path}`;
      const response = await fetch(url, { signal });
      return response.ok || response.status < 500;
    } catch {
      return false;
    }
  }

  // -- list / get ----------------------------------------------------------

  async function list(filter?: JobListFilter): Promise<JobRecord[]> {
    const records: JobRecord[] = [];
    for (const entry of entries.values()) {
      const r = entry.record;
      if (filter) {
        if (filter.kind && r.kind !== filter.kind) continue;
        if (filter.lifetime && r.lifetime !== filter.lifetime) continue;
        if (filter.ownerRunId && r.ownerRunId !== filter.ownerRunId) continue;
        if (filter.ownerSessionId && r.ownerSessionId !== filter.ownerSessionId) continue;
        if (filter.ownerProjectPath && r.ownerProjectPath !== filter.ownerProjectPath) continue;
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(r.status)) continue;
        }
      }
      records.push(publicRecord(entry));
    }
    return records;
  }

  async function get(jobId: string): Promise<JobRecord | undefined> {
    const entry = entries.get(jobId);
    return entry ? publicRecord(entry) : undefined;
  }

  // -- readLogs ------------------------------------------------------------

  async function readLogs(input: ReadJobLogsInput): Promise<ReadJobLogsResult> {
    const result = logStore.read({
      jobId: input.jobId,
      ...(input.afterCursor !== undefined ? { afterCursor: input.afterCursor } : {}),
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    });
    return {
      jobId: input.jobId,
      chunks: result.chunks,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  // -- wait ----------------------------------------------------------------

  async function wait(input: WaitForJobInput, signal: AbortSignal): Promise<JobRecord> {
    const entry = entries.get(input.jobId);
    if (!entry) {
      throw new Error(`job not found: ${input.jobId}`);
    }

    if (isJobTerminal(entry.record.status)) {
      return publicRecord(entry);
    }

    return new Promise<JobRecord>((resolve, reject) => {
      const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      // Remove this resolver from the entry's wait queue so a terminalized
      // job does not call back into an already-settled promise.
      const cleanup = (): void => {
        const index = entry.waitResolvers.indexOf(resolver);
        if (index !== -1) {
          entry.waitResolvers.splice(index, 1);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`job wait timeout: ${input.jobId}`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const resolver = (record: JobRecord): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(record);
      };

      const onAbort = (): void => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('wait aborted'));
      };

      signal.addEventListener('abort', onAbort, { once: true });
      entry.waitResolvers.push(resolver);
    });
  }

  // -- stop ----------------------------------------------------------------

  async function stop(jobId: string, reason: JobTerminalReason): Promise<JobStopResult> {
    const entry = entries.get(jobId);
    if (!entry) {
      throw new Error(`job not found: ${jobId}`);
    }

    if (isJobTerminal(entry.record.status)) {
      return {
        job: publicRecord(entry),
        cleanup: {
          requestedJobIds: [jobId],
          stoppedJobIds: [],
          alreadyTerminalJobIds: [jobId],
          failedJobIds: [],
        },
      };
    }

    entry.intentionalStop = true;
    entry.record.status = 'stopping';
    entry.record.terminalReason = reason;
    emit({ type: 'job/updated', job: publicRecord(entry) });
    persistRecord(entry);
    const supervised = entry.supervised;
    if (supervised) {
      try {
        await supervisor.stop(supervised);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(entry, 'system', `stop failed: ${message}\n`);
        markTerminal(entry, 'failed', 'stop-failed', null, message, true);
        return {
          job: publicRecord(entry),
          cleanup: {
            requestedJobIds: [jobId],
            stoppedJobIds: [],
            alreadyTerminalJobIds: [],
            failedJobIds: [jobId],
          },
        };
      }
    }
    // If the close handler hasn't fired yet, mark terminal now.
    if (!isJobTerminal(entry.record.status)) {
      appendLog(entry, 'system', 'stopped exitCode=null\n');
      markTerminal(entry, 'cancelled', reason, null);
    }
    return {
      job: publicRecord(entry),
      cleanup: {
        requestedJobIds: [jobId],
        stoppedJobIds: [jobId],
        alreadyTerminalJobIds: [],
        failedJobIds: [],
      },
    };
  }
  // -- stopByRun / stopBySession --------------------------------------------

  async function stopByOwner(
    predicate: (entry: JobEntry) => boolean,
    reason: JobTerminalReason,
  ): Promise<JobCleanupResult> {
    const toStop: string[] = [];
    const alreadyTerminal: string[] = [];

    for (const [jobId, entry] of entries) {
      if (!predicate(entry)) {
        continue;
      }
      if (isJobTerminal(entry.record.status)) {
        alreadyTerminal.push(jobId);
        continue;
      }
      toStop.push(jobId);
    }

    const stopped: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      toStop.map(async (jobId) => {
        try {
          const result = await stop(jobId, reason);
          if (result.cleanup.stoppedJobIds.includes(jobId)) {
            stopped.push(jobId);
          } else if (result.cleanup.failedJobIds.includes(jobId)) {
            failed.push(jobId);
          }
        } catch {
          failed.push(jobId);
        }
      }),
    );

    return {
      requestedJobIds: toStop,
      stoppedJobIds: stopped,
      alreadyTerminalJobIds: alreadyTerminal,
      failedJobIds: failed,
    };
  }

  async function stopByRun(runId: string, reason: JobTerminalReason): Promise<JobCleanupResult> {
    return stopByOwner((entry) => entry.record.ownerRunId === runId, reason);
  }

  async function stopBySession(sessionId: string, reason: JobTerminalReason): Promise<JobCleanupResult> {
    return stopByOwner((entry) => entry.record.ownerSessionId === sessionId, reason);
  }

  // -- dispose -------------------------------------------------------------

  async function dispose(): Promise<JobCleanupResult> {
    if (disposed) {
      return { requestedJobIds: [], stoppedJobIds: [], alreadyTerminalJobIds: [], failedJobIds: [] };
    }
    disposed = true;

    const toStop: string[] = [];
    const alreadyTerminal: string[] = [];

    for (const [jobId, entry] of entries) {
      if (isJobTerminal(entry.record.status)) {
        alreadyTerminal.push(jobId);
      } else {
        toStop.push(jobId);
      }
    }

    const stopped: string[] = [];
    const failed: string[] = [];

    await Promise.all(
      toStop.map(async (jobId) => {
        try {
          const result = await stop(jobId, 'host-shutdown');
          if (result.cleanup.stoppedJobIds.includes(jobId)) {
            stopped.push(jobId);
          } else if (result.cleanup.failedJobIds.includes(jobId)) {
            failed.push(jobId);
          }
        } catch {
          failed.push(jobId);
        }
      }),
    );

    // Also dispose the supervisor for any remaining tracked processes.
    await supervisor.dispose();
    logStore.dispose();
    if (recordStore) {
      await recordStore.dispose();
    }

    return {
      requestedJobIds: toStop,
      stoppedJobIds: stopped,
      alreadyTerminalJobIds: alreadyTerminal,
      failedJobIds: failed,
    };
  }

  return {
    start,
    list,
    get,
    readLogs,
    wait,
    stop,
    stopByRun,
    stopBySession,
    dispose,
  };
}
