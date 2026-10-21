import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPiwinRootOwner, type PiwinRootOwner } from './piwin-root-lease.js';

const execFileAsync = promisify(execFile);

/** Graceful window for an orphan to finish its own shutdown after SIGTERM. */
const DEFAULT_ORPHAN_STOP_TIMEOUT_MS = 10_000;
/** After SIGKILL the kernel reaps promptly; this only bounds a wedged exit. */
const DEFAULT_ORPHAN_KILL_TIMEOUT_MS = 3_000;
const ORPHAN_POLL_INTERVAL_MS = 100;
/**
 * `ps` reports elapsed time in whole seconds; a larger gap between it and the
 * owner record's `processStartedAt` means the PID was reused by another process.
 */
const PROCESS_START_TOLERANCE_MS = 10_000;
const LAUNCHD_OR_INIT_PID = 1;
const HOST_SERVE_ARGV = /(^|\s)host\s+serve(\s|$)/;

export type RootOwnerProcessFacts = {
  parentProcessId: number;
  elapsedMs: number;
  command: string;
};

export type OrphanedRootOwnerTakeover =
  /** No live foreign owner; the lease acquires (or reclaims) normally. */
  | { outcome: 'no-live-owner' }
  /** A live owner that is not an orphaned Host; the lease reports it. */
  | { outcome: 'owned'; owner: PiwinRootOwner }
  | { outcome: 'stopped' | 'killed'; owner: PiwinRootOwner }
  /** The orphan survived SIGKILL's bounded wait; the lease reports it. */
  | { outcome: 'still-running'; owner: PiwinRootOwner };

export type StopOrphanedRootOwnerOptions = {
  rootDir: string;
  stopTimeoutMs?: number;
  killTimeoutMs?: number;
  log?: (line: string) => void;
  /** Test seams; default to the real process table. */
  inspectProcess?: (processId: number) => Promise<RootOwnerProcessFacts | null>;
  isProcessAlive?: (processId: number) => boolean;
  signalProcess?: (processId: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
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

/** Parses `ps` `etime` (`[[dd-]hh:]mm:ss`) into milliseconds. */
export function parsePsElapsed(elapsed: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(elapsed.trim());
  if (!match) return null;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return (
    ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1_000
  );
}

/** Parses one `ps -o ppid=,etime=,command=` row. */
export function parsePsProcessRow(row: string): RootOwnerProcessFacts | null {
  const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(row.trim());
  if (!match) return null;
  const [, parent = '', elapsed = '', command = ''] = match;
  const elapsedMs = parsePsElapsed(elapsed);
  if (elapsedMs === null) return null;
  return { parentProcessId: Number(parent), elapsedMs, command };
}

async function inspectProcessWithPs(processId: number): Promise<RootOwnerProcessFacts | null> {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'ppid=,etime=,command=', '-p', String(processId)],
      { timeout: 5_000 },
    );
    return parsePsProcessRow(stdout);
  } catch {
    // ps exits non-zero when the PID is gone; either way there is no orphan
    // to stop and the lease decides from liveness alone.
    return null;
  }
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
  const recordedStartMs = Date.parse(owner.processStartedAt);
  const observedStartMs = nowMs - facts.elapsedMs;
  return Math.abs(observedStartMs - recordedStartMs) <= PROCESS_START_TOLERANCE_MS;
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

  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_ORPHAN_KILL_TIMEOUT_MS;
  log(`orphaned piwin host pid=${owner.processId} ignored SIGTERM; sending SIGKILL`);
  if (!sendSignal('SIGKILL') || (await waitForExit(killTimeoutMs))) {
    return { outcome: 'killed', owner };
  }
  return { outcome: 'still-running', owner };
}
