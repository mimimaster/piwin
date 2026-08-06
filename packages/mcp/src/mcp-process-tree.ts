import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** Grace period after SIGTERM before escalating to SIGKILL (ms). */
const CLOSE_GRACE_MS = 2_000;
/** Hard deadline for the entire close sequence (ms). */
const CLOSE_HARD_DEADLINE_MS = 5_000;

/**
 * Close an MCP child and its process group. The returned promise settles only
 * after the shutdown sequence has finished or its hard deadline is exhausted.
 */
export async function closeMcpProcessTree(
  child: ChildProcessWithoutNullStreams,
  spawnedPid: number | undefined = child.pid ?? undefined,
): Promise<void> {
  const shutdownDeadline = Date.now() + CLOSE_HARD_DEADLINE_MS;
  try {
    child.stdin.end();
  } catch {
    // stdin may already be closed after a failed initialize.
  }
  signalProcessTree(child, 'SIGTERM', spawnedPid);
  await waitForExit(child, spawnedPid, CLOSE_GRACE_MS, shutdownDeadline);
  const remainingMs = Math.max(0, shutdownDeadline - Date.now());
  if (process.platform === 'win32' && typeof spawnedPid === 'number') {
    await forceKillWindowsProcessTree(spawnedPid);
    await waitForProcessTreeExit(spawnedPid, remainingMs);
  } else if (typeof spawnedPid === 'number' && isProcessTreeAlive(spawnedPid)) {
    signalProcessTree(child, 'SIGKILL', spawnedPid);
    await waitForProcessTreeExit(spawnedPid, remainingMs);
  }
}

async function forceKillWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      () => resolve(),
    );
  });
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  spawnedPid: number | undefined,
  graceMs: number,
  shutdownDeadline: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exitPromise = new Promise<boolean>((resolve) => {
    child.once('close', () => resolve(true));
  });
  const exited = await Promise.race([
    exitPromise,
    delay(graceMs).then(() => false),
  ]);
  if (!exited) {
    signalProcessTree(child, 'SIGKILL', spawnedPid);
  }
  await Promise.race([
    exitPromise,
    delay(Math.max(0, shutdownDeadline - Date.now())).then(() => false),
  ]);
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
  spawnedPid: number | undefined,
): void {
  if (process.platform !== 'win32' && typeof spawnedPid === 'number' && spawnedPid > 1) {
    try {
      process.kill(-spawnedPid, signal);
      return;
    } catch {
      // The group may already be gone; fall through to the child handle.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process already exited.
  }
}

async function waitForProcessTreeExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessTreeAlive(pid)) {
      return;
    }
    await delay(25);
  }
}

function isProcessTreeAlive(pid: number): boolean {
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, 0);
    } else {
      process.kill(pid, 0);
    }
    return true;
  } catch {
    return false;
  }
}
