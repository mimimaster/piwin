/**
 * OS process-group termination and crash-only guardian helpers.
 *
 * Shared by both `@piwin/process`'s `ProcessSupervisor` and `@piwin/host-runtime`
 * plugin bridges so an abrupt Host exit (`SIGKILL`/crash) never leaves an
 * adapter process tree orphaned in the background.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';

const PROCESS_GROUP_POLL_MS = 25;
const DEFAULT_GUARDIAN_GRACE_MS = 3_000;

export type ProcessGroupGuardianHandle = {
  child: ChildProcess;
  control: NodeJS.WritableStream | null;
};

/**
 * Detached helper outside the supervised process group. Its only parent-owned
 * input is fd 3; when Host dies, the pipe reaches EOF and the guardian reaps
 * the exact process group (`-groupId`) unless it already exited.
 */
const PROCESS_GUARDIAN_SOURCE = String.raw`
const fs = require('node:fs');
const groupId = Number(process.argv[1]);
const graceMs = Math.max(Number(process.argv[2]) || 3000, 100);
let stopping = false;
let reapPoll;

function signalGroup(signal) {
  try {
    process.kill(-groupId, signal);
  } catch (error) {
    if (error && error.code !== 'ESRCH') {
      // No safe recovery path in this crash-only helper.
    }
  }
}

function groupIsAlive() {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code !== 'ESRCH');
  }
}

function finish() {
  if (stopping) return;
  stopping = true;
  clearInterval(poll);
  if (reapPoll) clearInterval(reapPoll);
  process.exit(0);
}

function reapAfterControlClose() {
  if (stopping) return;
  clearInterval(poll);
  if (!groupIsAlive()) {
    finish();
    return;
  }
  stopping = true;
  signalGroup('SIGTERM');
  reapPoll = setInterval(() => {
    if (!groupIsAlive()) {
      clearInterval(reapPoll);
      process.exit(0);
    }
  }, 50);
  const escalation = setTimeout(() => {
    clearInterval(reapPoll);
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

export function isChildProcessAlive(child: ChildProcess): boolean {
  // ChildProcess.killed only records signal dispatch, not OS reaping.
  return child.exitCode === null && child.signalCode === null;
}

export function signalUnixProcessGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ESRCH') {
      return true;
    }
    return false;
  }
}

export function isUnixProcessGroupAlive(processGroupId: number): boolean {
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

export function killWindowsProcessTree(pid: number, forceful: boolean): Promise<void> {
  const args = forceful ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T'];
  return new Promise((resolveKill) => {
    execFile('taskkill', args, { windowsHide: true }, () => {
      resolveKill();
    });
  });
}

export function waitForChildProcessExit(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isChildProcessAlive(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    let settled = false;
    const timer = setTimeout(() => {
      settle(!isChildProcessAlive(child));
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    const onExit = (): void => settle(true);
    const onAbort = (): void => settle(false);

    function settle(exited: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
      signal?.removeEventListener('abort', onAbort);
      resolveExit(exited || !isChildProcessAlive(child));
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

export function waitForUnixProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  if (!isUnixProcessGroupAlive(processGroupId)) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    const deadline = Date.now() + timeoutMs;

    const poll = (): void => {
      if (!isUnixProcessGroupAlive(processGroupId)) {
        resolveExit(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolveExit(false);
        return;
      }
      const timer = setTimeout(poll, PROCESS_GROUP_POLL_MS);
      timer.unref?.();
    };

    poll();
  });
}

export function spawnProcessGroupGuardian(
  processGroupId: number,
  options: { killGraceMs?: number; nodePath?: string } = {},
): ProcessGroupGuardianHandle | null {
  if (process.platform === 'win32') return null;

  const graceMs = options.killGraceMs ?? DEFAULT_GUARDIAN_GRACE_MS;
  const guardian = spawn(
    options.nodePath ?? process.execPath,
    ['-e', PROCESS_GUARDIAN_SOURCE, String(processGroupId), String(graceMs)],
    {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
      windowsHide: true,
    },
  );
  guardian.on('error', () => {
    // Best-effort crash safety helper; never crash the parent if spawn fails.
  });
  const control = guardian.stdio[3] as NodeJS.WritableStream | null;
  return { child: guardian, control };
}

export function closeProcessGroupGuardian(guardian: ProcessGroupGuardianHandle | null): void {
  if (!guardian?.control) return;
  const control = guardian.control as NodeJS.WritableStream & { end?: () => void };
  control.end?.();
  guardian.control = null;
}

export async function cleanupProcessGroupGuardian(
  guardian: ProcessGroupGuardianHandle | null,
  finalWaitMs = DEFAULT_GUARDIAN_GRACE_MS,
): Promise<void> {
  if (!guardian) return;
  closeProcessGroupGuardian(guardian);
  const exited = await waitForChildProcessExit(guardian.child, finalWaitMs);
  if (exited || !isChildProcessAlive(guardian.child)) return;
  guardian.child.kill('SIGKILL');
  await waitForChildProcessExit(guardian.child, finalWaitMs);
}
