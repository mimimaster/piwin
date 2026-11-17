/**
 * OS process supervisor with process-group/tree kill support.
 *
 * JC-06: stop targets the process group/tree with graceful (SIGTERM)
 *   then forceful (SIGKILL) termination.
 * JC-09: argv-only spawn; shell command strings are forbidden.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveTrustedCwd } from './cwd-policy.js';
import {
  cleanupProcessGroupGuardian,
  isChildProcessAlive,
  killWindowsProcessTree,
  signalUnixProcessGroup,
  spawnProcessGroupGuardian,
  waitForChildProcessExit,
  waitForUnixProcessGroupExit,
  type ProcessGroupGuardianHandle,
} from './process-group-guardian.js';

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

function isWindows(): boolean {
  return process.platform === 'win32';
}

type ProcessTracking = {
  guardian: ProcessGroupGuardianHandle | null;
  cleanupPromise: Promise<void> | null;
  resolveCleanup: () => void;
  rejectCleanup: (error: unknown) => void;
};

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
          await killWindowsProcessTree(target.processId, false);
          const exited = await waitForChildProcessExit(target.child, killGraceMs);
          if (!exited && isChildProcessAlive(target.child)) {
            await killWindowsProcessTree(target.processId, true);
          }
        } else {
          signalUnixProcessGroup(target.processGroupId, 'SIGTERM');
          const exited = await waitForUnixProcessGroupExit(
            target.processGroupId,
            killGraceMs,
          );
          if (!exited) {
            signalUnixProcessGroup(target.processGroupId, 'SIGKILL');
            const forceExited = await waitForUnixProcessGroupExit(
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

        await cleanupProcessGroupGuardian(tracking.guardian, finalWaitMs);
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

    // A failed spawn reports on 'error' a tick later. Nothing else listens, and
    // an 'error' event with no listener is thrown as an uncaught exception that
    // takes the whole Host down; a command that cannot start must only fail
    // its own call.
    let spawnError: Error | undefined;
    child.on('error', (error) => {
      spawnError = error;
    });

    const pid = child.pid;
    if (typeof pid !== 'number') {
      // Spawn failed: we cannot construct a valid SupervisedProcess without a pid.
      throw new Error(describeSpawnFailure(input.command, cwdResult.absoluteCwd, spawnError));
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
      tracking.guardian = spawnProcessGroupGuardian(processGroupId, { killGraceMs });
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

/** ENOENT from `spawn` means the command or the working directory is missing; say which one is likelier. */
function describeSpawnFailure(command: string, cwd: string, error: Error | undefined): string {
  if (!existsSync(cwd)) return `spawn failed: working directory does not exist: ${cwd}`;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === undefined ? 'spawn failed: no pid assigned' : `spawn failed: ${code} (${command})`;
}
