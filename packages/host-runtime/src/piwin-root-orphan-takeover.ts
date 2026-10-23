import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readPiwinRootOwner, type PiwinRootOwner } from './piwin-root-lease.js';
import {
  inspectProcessWithPs,
  isSameOwnerProcess,
  type RootOwnerProcessFacts,
} from './piwin-root-owner-process.js';

const execFileAsync = promisify(execFile);

/** Graceful window for an orphan to finish its own shutdown after SIGTERM. */
const DEFAULT_ORPHAN_STOP_TIMEOUT_MS = 10_000;
/** After SIGKILL the kernel reaps promptly; this only bounds a wedged exit. */
const DEFAULT_ORPHAN_KILL_TIMEOUT_MS = 3_000;
const ORPHAN_POLL_INTERVAL_MS = 100;
const LAUNCHD_OR_INIT_PID = 1;
/**
 * Asks a wedged Host to write a Node diagnostic report before SIGKILL. The
 * Host handles it on its event loop, so a fully blocked loop writes nothing;
 * the native stack sample taken right after covers that case.
 */
export const PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL = 'SIGUSR2';
const ORPHAN_SAMPLE_SECONDS = 3;
const HOST_SERVE_ARGV = /(^|\s)host\s+serve(\s|$)/;

export type OrphanedRootOwnerTakeover =
  /** No live foreign owner; the lease acquires (or reclaims) normally. */
  | { outcome: 'no-live-owner' }
  /** A live owner that is not an orphaned Host; the lease reports it. */
  | { outcome: 'owned'; owner: PiwinRootOwner }
  /** The recorded PID now belongs to another process; the lease reclaims the lock. */
  | { outcome: 'pid-reused'; owner: PiwinRootOwner }
  | { outcome: 'stopped' | 'killed'; owner: PiwinRootOwner }
  /** The orphan survived SIGKILL's bounded wait; the lease reports it. */
  | { outcome: 'still-running'; owner: PiwinRootOwner };

export type StopOrphanedRootOwnerOptions = {
  rootDir: string;
  stopTimeoutMs?: number;
  killTimeoutMs?: number;
  /**
   * When set, a Host that ignores SIGTERM is asked for a diagnostic report and
   * (macOS) stack-sampled into this directory before SIGKILL.
   */
  diagnosticsDir?: string;
  log?: (line: string) => void;
  /** Test seams; default to the real process table. */
  inspectProcess?: (processId: number) => Promise<RootOwnerProcessFacts | null>;
  isProcessAlive?: (processId: number) => boolean;
  signalProcess?: (processId: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  /** Native stack capture; resolves to the written file, or null when unavailable. */
  captureStackSample?: (processId: number, diagnosticsDir: string) => Promise<string | null>;
};

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function isProcessAliveNow(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // EPERM means alive but not ours: never a piwin Host we may stop.
    return !isNodeError(error, 'ESRCH');
  }
}

async function captureStackSampleWithSample(
  processId: number,
  diagnosticsDir: string,
): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  await mkdir(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(diagnosticsDir, `orphan-host-${processId}-${stamp}.sample.txt`);
  await execFileAsync('/usr/bin/sample', [String(processId), String(ORPHAN_SAMPLE_SECONDS), '-file', file], {
    timeout: (ORPHAN_SAMPLE_SECONDS + 20) * 1_000,
  });
  return file;
}

/**
 * An orphan is a Host whose launching shell died without stopping it: it was
 * reparented to launchd/init, it still runs `host serve`, and its start time
 * matches the owner record (so the PID was not reused).
 */
export function isOrphanedHostOwner(
  owner: PiwinRootOwner,
  facts: RootOwnerProcessFacts,
  nowMs: number,
): boolean {
  if (facts.parentProcessId !== LAUNCHD_OR_INIT_PID) return false;
  if (!HOST_SERVE_ARGV.test(facts.command)) return false;
  return isSameOwnerProcess(owner, facts, nowMs);
}

function readOwnerForTakeover(rootDir: string): PiwinRootOwner | null {
  try {
    return readPiwinRootOwner(rootDir);
  } catch {
    // An unreadable record is the lease's to report with its own error.
    return null;
  }
}

/**
 * Before acquiring the root lease, stop a previous Host that its shell left
 * behind (e.g. Desktop quit without reaping the sidecar). Bounded: SIGTERM,
 * wait, SIGKILL, wait. Any live owner that is not such an orphan is left alone
 * so the lease fails with a clear `PiwinRootAlreadyOwnedError`.
 */
export async function stopOrphanedPiwinRootOwner(
  options: StopOrphanedRootOwnerOptions,
): Promise<OrphanedRootOwnerTakeover> {
  const inspectProcess = options.inspectProcess ?? inspectProcessWithPs;
  const isAlive = options.isProcessAlive ?? isProcessAliveNow;
  const signalProcess =
    options.signalProcess ??
    ((processId: number, signal: NodeJS.Signals): void => {
      process.kill(processId, signal);
    });
  const sleep =
    options.sleep ??
    ((milliseconds: number): Promise<void> =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => undefined);

  const owner = readOwnerForTakeover(options.rootDir);
  if (owner === null || owner.processId === process.pid || !isAlive(owner.processId)) {
    return { outcome: 'no-live-owner' };
  }

  const facts = await inspectProcess(owner.processId);
  if (facts !== null && !isSameOwnerProcess(owner, facts, now())) {
    // Never signal a stranger that inherited the PID; the lease fences the lock.
    return { outcome: 'pid-reused', owner };
  }
  if (facts === null || !isOrphanedHostOwner(owner, facts, now())) {
    return { outcome: 'owned', owner };
  }

  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (!isAlive(owner.processId)) return true;
      await sleep(ORPHAN_POLL_INTERVAL_MS);
    }
    return !isAlive(owner.processId);
  };
  const sendSignal = (signal: NodeJS.Signals): boolean => {
    try {
      signalProcess(owner.processId, signal);
      return true;
    } catch (error) {
      if (isNodeError(error, 'ESRCH')) return false;
      throw error;
    }
  };

  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_ORPHAN_STOP_TIMEOUT_MS;
  log(`stopping orphaned piwin host pid=${owner.processId} (SIGTERM, wait ${stopTimeoutMs}ms)`);
  if (!sendSignal('SIGTERM') || (await waitForExit(stopTimeoutMs))) {
    return { outcome: 'stopped', owner };
  }

  if (options.diagnosticsDir !== undefined) {
    const diagnosticsDir = options.diagnosticsDir;
    const captureStackSample = options.captureStackSample ?? captureStackSampleWithSample;
    log(
      `orphaned piwin host pid=${owner.processId} ignored SIGTERM; requesting diagnostic report (${PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL}) and stack sample before SIGKILL`,
    );
    if (!sendSignal(PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL)) {
      return { outcome: 'stopped', owner };
    }
    // The sample's run time doubles as the window for the report write.
    try {
      const file = await captureStackSample(owner.processId, diagnosticsDir);
      log(file === null ? 'stack sample unavailable on this platform' : `stack sample written: ${file}`);
    } catch (error) {
      log(`stack sample failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A Host from before this signal existed dies on it (default action).
    if (!isAlive(owner.processId)) {
      return { outcome: 'killed', owner };
    }
  }

  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_ORPHAN_KILL_TIMEOUT_MS;
  log(`orphaned piwin host pid=${owner.processId} ignored SIGTERM; sending SIGKILL`);
  if (!sendSignal('SIGKILL') || (await waitForExit(killTimeoutMs))) {
    return { outcome: 'killed', owner };
  }
  return { outcome: 'still-running', owner };
}

export type WaitForRootOwnerReleaseOptions = {
  rootDir: string;
  owner: PiwinRootOwner;
  timeoutMs: number;
  /** Test seams; default to the real process table and clock. */
  isProcessAlive?: (processId: number) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

/**
 * Waits (bounded) for a live, legitimate owner to let go of the root — a
 * short CLI command, or a previous sidecar still draining. Resolves true once
 * the lock is free or held by a different lease, false on timeout. The lease
 * acquisition afterwards stays the authority either way.
 */
export async function waitForRootOwnerRelease(
  options: WaitForRootOwnerReleaseOptions,
): Promise<boolean> {
  const isAlive = options.isProcessAlive ?? isProcessAliveNow;
  const sleep =
    options.sleep ??
    ((milliseconds: number): Promise<void> =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const now = options.now ?? Date.now;
  const released = (): boolean => {
    const current = readOwnerForTakeover(options.rootDir);
    return (
      current === null ||
      current.leaseId !== options.owner.leaseId ||
      !isAlive(options.owner.processId)
    );
  };
  const deadline = now() + options.timeoutMs;
  while (now() < deadline) {
    if (released()) return true;
    await sleep(ORPHAN_POLL_INTERVAL_MS);
  }
  return released();
}
