/**
 * Host-owned managed process registry (CE-PROC).
 * Spawns argv arrays only (no shell); rings logs; SIGTERM→SIGKILL stop.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  ManagedProcessLogChunk,
  ManagedProcessLogsQuery,
  ManagedProcessRecord,
  ManagedProcessStartInput,
  ManagedProcessStatus,
  ProcessConfig,
} from '@piwin/contracts';
import { createDefaultProcessConfig } from '@piwin/contracts';
import { resolveTrustedCwd } from './cwd-policy.js';
import { redactSecretText } from './redact-logs.js';

/** Default max log retention per process (bytes of redacted text). */
export const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024;

/** Grace period after SIGTERM before SIGKILL. */
export const DEFAULT_KILL_GRACE_MS = 3_000;

/** Throttle interval for process/log event emission. */
export const DEFAULT_LOG_THROTTLE_MS = 100;

export type ProcessRegistryEvent =
  | { type: 'process/started'; process: ManagedProcessRecord }
  | { type: 'process/updated'; process: ManagedProcessRecord }
  | {
      type: 'process/exited';
      processId: string;
      exitCode?: number | null;
      process?: ManagedProcessRecord;
    }
  | { type: 'process/log'; chunk: ManagedProcessLogChunk };

export type ProcessRegistryOptions = {
  config?: ProcessConfig;
  /** Absolute trusted project roots used to gate cwd. Required for start(). */
  getTrustedProjectRoots?: () => readonly string[] | Promise<readonly string[]>;
  maxLogBytes?: number;
  killGraceMs?: number;
  logThrottleMs?: number;
  onEvent?: (event: ProcessRegistryEvent) => void;
  /** Inject clock for tests. */
  now?: () => Date;
  /** Inject id generator for tests. */
  createId?: () => string;
};

export type ProcessRegistry = {
  start: (input: ManagedProcessStartInput) => Promise<ManagedProcessRecord>;
  list: (filter?: {
    sessionId?: string;
    projectPath?: string;
  }) => ManagedProcessRecord[];
  get: (processId: string) => ManagedProcessRecord | undefined;
  readLogs: (query: ManagedProcessLogsQuery) => ManagedProcessLogChunk[];
  stop: (processId: string) => Promise<ManagedProcessRecord>;
  /** Kill remaining children when killOnHostDispose is true (default). */
  dispose: () => Promise<void>;
  /** Running + starting count (not exited/stopped/error). */
  activeCount: () => number;
};

type InternalEntry = {
  record: ManagedProcessRecord;
  child: ChildProcess | null;
  logText: string;
  logChunks: ManagedProcessLogChunk[];
  killTimer: ReturnType<typeof setTimeout> | null;
  intentionalStop: boolean;
  pendingLogText: string;
  logFlushTimer: ReturnType<typeof setTimeout> | null;
};

function isActiveStatus(status: ManagedProcessStatus): boolean {
  return status === 'starting' || status === 'running';
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function cloneRecord(record: ManagedProcessRecord): ManagedProcessRecord {
  const copy: ManagedProcessRecord = {
    id: record.id,
    command: record.command,
    argv: [...record.argv],
    cwd: record.cwd,
    status: record.status,
    startedAt: record.startedAt,
  };
  if (typeof record.pid === 'number') copy.pid = record.pid;
  if (record.exitedAt) copy.exitedAt = record.exitedAt;
  if (record.exitCode !== undefined) copy.exitCode = record.exitCode;
  if (record.lastError) copy.lastError = record.lastError;
  if (record.sessionId) copy.sessionId = record.sessionId;
  if (record.projectPath) copy.projectPath = record.projectPath;
  if (record.label) copy.label = record.label;
  if (record.killOnSessionEnd !== undefined) {
    copy.killOnSessionEnd = record.killOnSessionEnd;
  }
  return copy;
}

export function createProcessRegistry(options: ProcessRegistryOptions = {}): ProcessRegistry {
  const defaults = createDefaultProcessConfig();
  const config: ProcessConfig = {
    ...defaults,
    ...options.config,
  };
  // Disabled only when config.enabled is explicitly false.
  const processEnabled = config.enabled !== false;
  const maxProcesses = config.maxProcesses ?? defaults.maxProcesses ?? 8;
  const maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const logThrottleMs = options.logThrottleMs ?? DEFAULT_LOG_THROTTLE_MS;
  const killOnHostDispose = config.killOnHostDispose !== false;
  const defaultKillOnSessionEnd = config.killOnSessionEnd === true;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => randomUUID());
  const getTrustedProjectRoots =
    options.getTrustedProjectRoots ?? (() => [] as readonly string[]);

  const entries = new Map<string, InternalEntry>();
  let disposed = false;

  function emit(event: ProcessRegistryEvent): void {
    options.onEvent?.(event);
  }

  function publicRecord(entry: InternalEntry): ManagedProcessRecord {
    return cloneRecord(entry.record);
  }

  function activeCount(): number {
    let count = 0;
    for (const entry of entries.values()) {
      if (isActiveStatus(entry.record.status)) {
        count += 1;
      }
    }
    return count;
  }

  function appendLog(
    entry: InternalEntry,
    stream: ManagedProcessLogChunk['stream'],
    rawText: string,
  ): void {
    const text = redactSecretText(rawText);
    if (!text) {
      return;
    }
    const chunk: ManagedProcessLogChunk = {
      processId: entry.record.id,
      stream,
      text,
      at: nowIso(now),
    };
    entry.logChunks.push(chunk);
    entry.logText += text;
    while (entry.logText.length > maxLogBytes && entry.logChunks.length > 0) {
      const removed = entry.logChunks.shift();
      if (removed) {
        entry.logText = entry.logText.slice(removed.text.length);
      }
    }
    entry.pendingLogText += text;
    scheduleLogFlush(entry);
  }

  function scheduleLogFlush(entry: InternalEntry): void {
    if (entry.logFlushTimer) {
      return;
    }
    entry.logFlushTimer = setTimeout(() => {
      entry.logFlushTimer = null;
      const pending = entry.pendingLogText;
      entry.pendingLogText = '';
      if (!pending) {
        return;
      }
      emit({
        type: 'process/log',
        chunk: {
          processId: entry.record.id,
          stream: 'stdout',
          text: pending,
          at: nowIso(now),
        },
      });
    }, logThrottleMs);
    if (typeof entry.logFlushTimer.unref === 'function') {
      entry.logFlushTimer.unref();
    }
  }

  function markTerminal(
    entry: InternalEntry,
    status: 'exited' | 'error' | 'stopped',
    exitCode: number | null | undefined,
    lastError?: string,
  ): void {
    if (!isActiveStatus(entry.record.status)) {
      return;
    }
    entry.record.status = status;
    entry.record.exitedAt = nowIso(now);
    if (exitCode !== undefined) {
      entry.record.exitCode = exitCode;
    }
    if (lastError) {
      entry.record.lastError = lastError;
    }
    if (entry.killTimer) {
      clearTimeout(entry.killTimer);
      entry.killTimer = null;
    }
    entry.child = null;
    emit({ type: 'process/updated', process: publicRecord(entry) });
    emit({
      type: 'process/exited',
      processId: entry.record.id,
      ...(exitCode !== undefined ? { exitCode } : {}),
      process: publicRecord(entry),
    });
  }

  async function start(input: ManagedProcessStartInput): Promise<ManagedProcessRecord> {
    if (disposed) {
      throw new Error('ProcessRegistry is disposed');
    }
    if (!processEnabled) {
      throw new Error('Managed processes are disabled (process.enabled=false)');
    }
    if (!input.command || typeof input.command !== 'string') {
      throw new Error('command is required');
    }
    if (!Array.isArray(input.argv)) {
      throw new Error('argv must be an array (no shell string)');
    }
    for (const arg of input.argv) {
      if (typeof arg !== 'string') {
        throw new Error('argv entries must be strings');
      }
    }
    if (activeCount() >= maxProcesses) {
      throw new Error(`maxProcesses reached (${maxProcesses})`);
    }

    const trustedRoots = await Promise.resolve(getTrustedProjectRoots());
    const rootsForCheck =
      input.projectPath &&
      trustedRoots.some((root) => resolveTrustedCwd(input.projectPath!, [root]).ok)
        ? [input.projectPath, ...trustedRoots.filter((root) => root !== input.projectPath)]
        : trustedRoots;
    const cwdResult = resolveTrustedCwd(input.cwd, rootsForCheck);
    if (!cwdResult.ok) {
      throw new Error(cwdResult.reason);
    }

    const processId = createId();
    const killOnSessionEnd =
      input.killOnSessionEnd !== undefined
        ? input.killOnSessionEnd
        : defaultKillOnSessionEnd;

    const record: ManagedProcessRecord = {
      id: processId,
      command: input.command,
      argv: [...input.argv],
      cwd: cwdResult.absoluteCwd,
      status: 'starting',
      startedAt: nowIso(now),
      projectPath: input.projectPath ?? cwdResult.projectRoot,
      killOnSessionEnd,
    };
    if (input.sessionId) record.sessionId = input.sessionId;
    if (input.label) record.label = input.label;

    const entry: InternalEntry = {
      record,
      child: null,
      logText: '',
      logChunks: [],
      killTimer: null,
      intentionalStop: false,
      pendingLogText: '',
      logFlushTimer: null,
    };
    entries.set(processId, entry);

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (input.env) {
      for (const [key, value] of Object.entries(input.env)) {
        childEnv[key] = value;
      }
    }

    let child: ChildProcess;
    try {
      // shell: false — argv array only; never pass a shell string.
      child = spawn(input.command, input.argv, {
        cwd: cwdResult.absoluteCwd,
        env: childEnv,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markTerminal(entry, 'error', null, message);
      appendLog(entry, 'system', `spawn failed: ${message}\n`);
      throw new Error(`process start failed: ${message}`);
    }

    entry.child = child;
    if (typeof child.pid === 'number') {
      entry.record.pid = child.pid;
    }
    entry.record.status = 'running';
    emit({ type: 'process/started', process: publicRecord(entry) });
    emit({ type: 'process/updated', process: publicRecord(entry) });
    appendLog(
      entry,
      'system',
      `started pid=${entry.record.pid ?? '?'} ${input.command} ${input.argv.join(' ')}\n`,
    );

    child.stdout?.on('data', (buffer: Buffer) => {
      appendLog(entry, 'stdout', buffer.toString('utf8'));
    });
    child.stderr?.on('data', (buffer: Buffer) => {
      appendLog(entry, 'stderr', buffer.toString('utf8'));
    });
    child.on('error', (error: Error) => {
      appendLog(entry, 'system', `process error: ${error.message}\n`);
      if (isActiveStatus(entry.record.status)) {
        markTerminal(entry, 'error', null, error.message);
      }
    });
    child.on('close', (code: number | null) => {
      if (entry.intentionalStop) {
        markTerminal(entry, 'stopped', code);
        appendLog(entry, 'system', `stopped exitCode=${code ?? 'null'}\n`);
        return;
      }
      markTerminal(entry, 'exited', code);
      appendLog(entry, 'system', `exited exitCode=${code ?? 'null'}\n`);
    });

    return publicRecord(entry);
  }

  function list(filter?: {
    sessionId?: string;
    projectPath?: string;
  }): ManagedProcessRecord[] {
    const records: ManagedProcessRecord[] = [];
    for (const entry of entries.values()) {
      if (filter?.sessionId && entry.record.sessionId !== filter.sessionId) {
        continue;
      }
      if (filter?.projectPath && entry.record.projectPath !== filter.projectPath) {
        continue;
      }
      records.push(publicRecord(entry));
    }
    return records.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  function get(processId: string): ManagedProcessRecord | undefined {
    const entry = entries.get(processId);
    return entry ? publicRecord(entry) : undefined;
  }

  function readLogs(query: ManagedProcessLogsQuery): ManagedProcessLogChunk[] {
    const entry = entries.get(query.processId);
    if (!entry) {
      return [];
    }
    const offset = typeof query.offset === 'number' && query.offset > 0 ? query.offset : 0;
    const limit =
      typeof query.limit === 'number' && query.limit > 0 ? query.limit : entry.logChunks.length;
    return entry.logChunks.slice(offset, offset + limit).map((chunk) => ({ ...chunk }));
  }

  async function stop(processId: string): Promise<ManagedProcessRecord> {
    const entry = entries.get(processId);
    if (!entry) {
      throw new Error(`Unknown process: ${processId}`);
    }
    if (!isActiveStatus(entry.record.status) || !entry.child) {
      return publicRecord(entry);
    }
    entry.intentionalStop = true;
    appendLog(entry, 'system', 'stop requested (SIGTERM)\n');
    try {
      entry.child.kill('SIGTERM');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(entry, 'system', `SIGTERM failed: ${message}\n`);
    }

    await new Promise<void>((resolveStop) => {
      const child = entry.child;
      if (!child || child.exitCode !== null) {
        resolveStop();
        return;
      }
      const onClose = (): void => {
        if (entry.killTimer) {
          clearTimeout(entry.killTimer);
          entry.killTimer = null;
        }
        resolveStop();
      };
      child.once('close', onClose);
      entry.killTimer = setTimeout(() => {
        entry.killTimer = null;
        if (entry.child && entry.child.exitCode === null) {
          appendLog(entry, 'system', 'stop grace expired (SIGKILL)\n');
          try {
            entry.child.kill('SIGKILL');
          } catch {
            // best-effort
          }
        }
        const fallback = setTimeout(resolveStop, 200);
        if (typeof fallback.unref === 'function') {
          fallback.unref();
        }
      }, killGraceMs);
      if (typeof entry.killTimer.unref === 'function') {
        entry.killTimer.unref();
      }
    });

    if (isActiveStatus(entry.record.status)) {
      markTerminal(entry, 'stopped', entry.child?.exitCode ?? null);
    }
    return publicRecord(entry);
  }

  async function dispose(): Promise<void> {
    if (disposed) {
      return;
    }
    disposed = true;
    if (!killOnHostDispose) {
      return;
    }
    const activeIds = [...entries.values()]
      .filter((entry) => isActiveStatus(entry.record.status))
      .map((entry) => entry.record.id);
    await Promise.all(
      activeIds.map(async (processId) => {
        try {
          await stop(processId);
        } catch {
          // best-effort
        }
      }),
    );
  }

  return {
    start,
    list,
    get,
    readLogs,
    stop,
    dispose,
    activeCount,
  };
}
