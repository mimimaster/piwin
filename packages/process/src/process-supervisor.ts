/**
 * OS process supervisor with process-group/tree kill support.
 *
 * JC-06: stop targets the process group/tree with graceful (SIGTERM)
 *   then forceful (SIGKILL) termination.
 * JC-09: argv-only spawn; shell command strings are forbidden.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { resolveTrustedCwd } from './cwd-policy.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SupervisedProcess = {
  processId: number;
  processGroupId: number;
  child: ChildProcess;
  /** Resolves only after the owned process group/tree has been reaped. */
  cleanup?: Promise<void>;
};

export type ProcessSupervisorOptions = {
  /** Grace period after SIGTERM before SIGKILL. Default 3000 ms. */
  killGraceMs?: number;
  /** Bounded wait after SIGKILL for exit confirmation. Defaults to the grace period, minimum 200 ms. */
  finalWaitMs?: number;
  /** Inject clock for tests. */
  now?: () => Date;
};

export type ProcessSpawnInput = {
  command: string;
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  trustedProjectRoots: readonly string[];
};

export type ProcessSupervisor = {
  spawn(input: ProcessSpawnInput): Promise<SupervisedProcess>;
  stop(target: SupervisedProcess, signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_KILL_GRACE_MS = 3_000;
const PROCESS_GROUP_POLL_MS = 25;

/**
 * This process is deliberately outside the supervised process group. Its
 * only parent-owned input is fd 3; when Host dies, the pipe reaches EOF and
 * the guardian terminates the exact group it was given.
 */
const PROCESS_GUARDIAN_SOURCE = String.raw`
const fs = require('node:fs');
const groupId = Number(process.argv[1]);
const graceMs = Math.max(Number(process.argv[2]) || 3000, 100);
let stopping = false;

function signalGroup(signal) {
  try {
    process.kill(-groupId, signal);
  } catch (error) {
    if (error && error.code !== 'ESRCH') {
      // The group may already have exited. There is no safe recovery action
      // for a different signal error in this crash-only helper.
    }
  }
}

function groupIsAlive() {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

function finish() {
  if (stopping) return;
  stopping = true;
  clearInterval(poll);
  process.exit(0);
}

function reapAfterControlClose() {
  if (stopping) return;
  stopping = true;
  clearInterval(poll);
  signalGroup('SIGTERM');
  const escalation = setTimeout(() => {
    signalGroup('SIGKILL');
    const exitTimer = setTimeout(() => process.exit(0), 100);
    exitTimer.unref();
  }, graceMs);
  escalation.unref();
}

const poll = setInterval(() => {
  if (!groupIsAlive()) finish();
}, 100);
poll.unref();

const control = fs.createReadStream(null, { fd: 3, autoClose: true });
control.on('data', () => {});
control.once('end', reapAfterControlClose);
control.once('error', reapAfterControlClose);
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Returns `true` when the child process is still running (no exit yet).
 */
function isAlive(child: ChildProcess): boolean {
  // ChildProcess.killed only means that Node sent a signal. It does not mean
  // that the operating system has reaped the child yet.
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Send a signal to an entire process group on Unix.
 * Returns `true` if the signal was delivered (or no target exists),
 * `false` if the group could not be signalled.
 */
function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error: unknown) {
    // ESRCH = no such process — already dead, which is fine.
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return true;
      }
    }
    return false;
  }
}

/** Returns whether any process still belongs to the owned Unix process group. */
function isProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      if (code === 'EPERM') return true;
    }
    return false;
  }
}

/**
 * Kill a process tree on Windows using `taskkill /T /F`.
 * `/T` terminates the entire subtree; `/F` forces termination.
 */
function killTreeWindows(pid: number, forceful: boolean): Promise<void> {
  const args = forceful
    ? ['/PID', String(pid), '/T', '/F']
    : ['/PID', String(pid), '/T'];
  return new Promise((resolveKill) => {
    execFile('taskkill', args, { windowsHide: true }, () => {
      // Best-effort — resolve regardless of error.
      resolveKill();
    });
  });
}

function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isAlive(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    let settled = false;
    const timer = setTimeout(() => {
      settle(!isAlive(child));
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    const onExit = (): void => {
      settle(true);
    };
    const onAbort = (): void => {
      settle(false);
    };

    function settle(exited: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
      signal?.removeEventListener('abort', onAbort);
      resolveExit(exited || !isAlive(child));
    }

    child.once('exit', onExit);
    child.once('close', onExit);
    if (signal) {
      if (signal.aborted) {
        settle(false);
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  if (!isProcessGroupAlive(processGroupId)) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    const deadline = Date.now() + timeoutMs;

    const poll = (): void => {
      if (!isProcessGroupAlive(processGroupId)) {
        resolveExit(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolveExit(false);
        return;
      }
      setTimeout(poll, PROCESS_GROUP_POLL_MS);
    };

    poll();
  });
}

type GuardianHandle = {
  child: ChildProcess;
  control: NodeJS.WritableStream | null;
};

type ProcessTracking = {
  guardian: GuardianHandle | null;
  cleanupPromise: Promise<void> | null;
  resolveCleanup: () => void;
  rejectCleanup: (error: unknown) => void;
};

function closeGuardianControl(guardian: GuardianHandle | null): void {
  if (!guardian?.control) return;
  const control = guardian.control as NodeJS.WritableStream & { end?: () => void };
  control.end?.();
  guardian.control = null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createProcessSupervisor(
  options: ProcessSupervisorOptions = {},
): ProcessSupervisor {
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const finalWaitMs = options.finalWaitMs ?? Math.max(killGraceMs, 200);
  const now = options.now ?? (() => new Date());

  /** All spawned processes still tracked for dispose cleanup. */
  const tracked = new Set<SupervisedProcess>();
  const processTracking = new Map<SupervisedProcess, ProcessTracking>();
  let disposed = false;

  function spawnGuardian(processGroupId: number): GuardianHandle | null {
    if (isWindows()) return null;

    const guardian = spawn(
      process.execPath,
      [
        '-e',
        PROCESS_GUARDIAN_SOURCE,
        String(processGroupId),
        String(killGraceMs),
      ],
      {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    const control = guardian.stdio[3] as NodeJS.WritableStream | null;
    return { child: guardian, control };
  }

  async function cleanupGuardian(guardian: GuardianHandle | null): Promise<void> {
    if (!guardian) return;
    closeGuardianControl(guardian);
    const exited = await waitForExit(guardian.child, finalWaitMs);
    if (exited || !isAlive(guardian.child)) return;
    guardian.child.kill('SIGKILL');
    await waitForExit(guardian.child, finalWaitMs);
  }

  async function cleanupProcessGroup(target: SupervisedProcess): Promise<void> {
    const tracking = processTracking.get(target);
    if (!tracking) return;
    if (tracking.cleanupPromise) {
      await tracking.cleanupPromise;
      return;
    }

    tracking.cleanupPromise = (async () => {
      try {
        if (isWindows()) {
          await killTreeWindows(target.processId, false);
          const exited = await waitForExit(target.child, killGraceMs);
          if (!exited && isAlive(target.child)) {
            await killTreeWindows(target.processId, true);
          }
        } else {
          signalProcessGroup(target.processGroupId, 'SIGTERM');
          const exited = await waitForProcessGroupExit(
            target.processGroupId,
            killGraceMs,
          );
          if (!exited) {
            signalProcessGroup(target.processGroupId, 'SIGKILL');
            const forceExited = await waitForProcessGroupExit(
              target.processGroupId,
              finalWaitMs,
            );
            if (!forceExited) {
              throw new Error(
                `failed to stop process group ${target.processGroupId}: exit not confirmed`,
              );
            }
          }
        }

        await cleanupGuardian(tracking.guardian);
        tracked.delete(target);
        processTracking.delete(target);
        tracking.resolveCleanup();
      } catch (error: unknown) {
        tracking.cleanupPromise = null;
        tracking.rejectCleanup(error);
        throw error;
      }
    })();

    await tracking.cleanupPromise;
  }

  // -- spawn ---------------------------------------------------------------

  async function spawnProcess(input: ProcessSpawnInput): Promise<SupervisedProcess> {
    if (disposed) {
      throw new Error('ProcessSupervisor is disposed');
    }

    // JC-09: validate command is a non-empty string.
    if (!input.command || typeof input.command !== 'string' || !input.command.trim()) {
      throw new Error('command must be a non-empty string');
    }

    // JC-09: validate argv is an array of strings (no shell string).
    if (!Array.isArray(input.argv)) {
      throw new Error('argv must be an array of strings');
    }
    for (const arg of input.argv) {
      if (typeof arg !== 'string') {
        throw new Error('argv entries must be strings');
      }
    }

    // Validate cwd against trusted project roots.
    const cwdResult = resolveTrustedCwd(input.cwd, input.trustedProjectRoots);
    if (!cwdResult.ok) {
      throw new Error(cwdResult.reason);
    }

    // Build environment: inherit process.env, overlay caller-provided entries.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (input.env) {
      for (const [key, value] of Object.entries(input.env)) {
        childEnv[key] = value;
      }
    }

    // shell: false — argv array only, never a shell string (JC-09).
    // detached: true — child becomes its own process-group leader so we
    // can signal the entire group (JC-06).
    const child = spawn(input.command, input.argv, {
      cwd: cwdResult.absoluteCwd,
      env: childEnv,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const pid = child.pid;
    if (typeof pid !== 'number') {
      // spawn failed synchronously — the 'error' event will fire, but we
      // cannot construct a valid SupervisedProcess without a pid.
      throw new Error('spawn failed: no pid assigned');
    }

    // On Unix, detached: true makes the child a process-group leader,
    // so the process group id equals the child pid.
    // On Windows, there is no process-group concept; we use the pid for
    // taskkill /T tree termination.
    const processGroupId = pid;

    let resolveCleanup!: () => void;
    let rejectCleanup!: (error: unknown) => void;
    const cleanup = new Promise<void>((resolveCleanupPromise, rejectCleanupPromise) => {
      resolveCleanup = resolveCleanupPromise;
      rejectCleanup = rejectCleanupPromise;
    });

    const supervised: SupervisedProcess = {
      processId: pid,
      processGroupId,
      child,
      cleanup,
    };
    processTracking.set(supervised, {
      guardian: null,
      cleanupPromise: null,
      resolveCleanup,
      rejectCleanup,
    });
    tracked.add(supervised);

    const tracking = processTracking.get(supervised);
    if (!tracking) {
      throw new Error('process tracking initialization failed');
    }
    try {
      tracking.guardian = spawnGuardian(processGroupId);
    } catch (error: unknown) {
      await cleanupProcessGroup(supervised).catch(() => undefined);
      throw error;
    }

    // A leader can exit while descendants remain. Reap the whole owned group;
    // do not remove the target merely because the direct child emitted close.
    child.once('close', () => {
      void cleanupProcessGroup(supervised).catch(() => undefined);
    });

    // A guardian that fails to start or exits unexpectedly must not leave the
    // target group unmanaged while the Host is still alive.
    tracking.guardian?.child.once('error', () => {
      void cleanupProcessGroup(supervised).catch(() => undefined);
    });
    tracking.guardian?.child.once('exit', (code, signal) => {
      if (code !== 0 || signal !== null) {
        void cleanupProcessGroup(supervised).catch(() => undefined);
      }
    });

    return supervised;
  }

  // -- stop ----------------------------------------------------------------

  /**
   * JC-06: Stop targets the process group/tree.
   *
   * 1. Send SIGTERM (graceful) to the process group.
   * 2. Wait `killGraceMs` for the process to exit.
   * 3. If still alive, send SIGKILL (forceful) to the process group.
   *
   * Idempotent: if the owned process group is already dead, resolves
   * immediately.
   */
  async function stopProcess(
    target: SupervisedProcess,
    signal?: AbortSignal,
  ): Promise<void> {
    // The direct child may already be dead while descendants still occupy
    // the process group. Cleanup is intentionally not cancellable: once a
    // stop begins, returning early would recreate the orphan leak.
    void signal;
    await cleanupProcessGroup(target);
  }

  // -- dispose -------------------------------------------------------------

  async function dispose(): Promise<void> {
    if (disposed) {
      return;
    }
    disposed = true;

    const targets = [...tracked];
    await Promise.all(
      targets.map(async (target) => {
        try {
          await stopProcess(target);
        } catch {
          // best-effort during dispose
        }
      }),
    );

    // A failed stop remains tracked deliberately. The handle must not be
    // discarded merely because disposal was best-effort.
  }

  return {
    spawn: spawnProcess,
    stop: stopProcess,
    dispose,
  };
}
