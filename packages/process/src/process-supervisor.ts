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
  let disposed = false;

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

    const supervised: SupervisedProcess = {
      processId: pid,
      processGroupId,
      child,
    };

    // Remove from tracked set when the child exits naturally.
    child.once('close', () => {
      tracked.delete(supervised);
    });
    tracked.add(supervised);
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
   * Idempotent: if the process is already dead, resolves immediately.
   */
  async function stopProcess(
    target: SupervisedProcess,
    signal?: AbortSignal,
  ): Promise<void> {
    const { child, processGroupId } = target;

    // Already dead — idempotent success.
    if (!isAlive(child)) {
      tracked.delete(target);
      return;
    }

    let exited = false;

    if (isWindows()) {
      // Windows: graceful tree kill first, then forceful.
      await killTreeWindows(target.processId, false);

      exited = await waitForExit(child, killGraceMs, signal);
      if (!exited && isAlive(child)) {
        await killTreeWindows(target.processId, true);
      }
    } else {
      // Unix: signal the entire process group (negative pid).
      signalProcessGroup(processGroupId, 'SIGTERM');

      exited = await waitForExit(child, killGraceMs, signal);
      if (!exited && isAlive(child)) {
        signalProcessGroup(processGroupId, 'SIGKILL');
      }
    }

    if (!exited && isAlive(child)) {
      // A signal being delivered is not exit confirmation. Keep the target
      // tracked until close/exit (or the bounded final wait) says otherwise.
      exited = await waitForExit(child, finalWaitMs);
    }

    if (!exited && isAlive(child)) {
      throw new Error(`failed to stop process ${target.processId}: exit not confirmed`);
    }

    tracked.delete(target);
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
