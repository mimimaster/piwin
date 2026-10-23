import { execFile, execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * `ps` reports elapsed time in whole seconds; a larger gap between it and the
 * owner record's `processStartedAt` means the PID was reused by another process.
 */
export const PROCESS_START_TOLERANCE_MS = 10_000;
const PS_TIMEOUT_MS = 5_000;
const PS_ARGS = ['-o', 'ppid=,etime=,command=', '-p'] as const;

export type RootOwnerProcessFacts = {
  parentProcessId: number;
  elapsedMs: number;
  command: string;
};

/** The parts of an owner record that identify one process instance. */
export type RootOwnerProcessIdentity = {
  processStartedAt: string;
  processExecPath?: string;
};

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

/** Process facts from the real process table, or null when unavailable. */
export async function inspectProcessWithPs(
  processId: number,
): Promise<RootOwnerProcessFacts | null> {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync('ps', [...PS_ARGS, String(processId)], {
      timeout: PS_TIMEOUT_MS,
    });
    return parsePsProcessRow(stdout);
  } catch {
    // ps exits non-zero when the PID is gone; callers then decide from
    // liveness alone.
    return null;
  }
}

/**
 * Synchronous twin of `inspectProcessWithPs` for the lease, which acquires
 * once at startup and has no event loop work to yield to.
 */
export function inspectProcessWithPsSync(processId: number): RootOwnerProcessFacts | null {
  if (process.platform === 'win32') return null;
  try {
    const stdout = execFileSync('ps', [...PS_ARGS, String(processId)], {
      encoding: 'utf8',
      timeout: PS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePsProcessRow(stdout);
  } catch {
    return null;
  }
}

function startedAtMatches(
  identity: RootOwnerProcessIdentity,
  facts: RootOwnerProcessFacts,
  nowMs: number,
): boolean {
  const recordedStartMs = Date.parse(identity.processStartedAt);
  const observedStartMs = nowMs - facts.elapsedMs;
  return Math.abs(observedStartMs - recordedStartMs) <= PROCESS_START_TOLERANCE_MS;
}

function commandMatches(identity: RootOwnerProcessIdentity, facts: RootOwnerProcessFacts): boolean {
  // Records written before the field existed carry no executable; the start
  // time alone then decides.
  if (identity.processExecPath === undefined) return true;
  const executable = basename(identity.processExecPath);
  return executable.length > 0 && facts.command.includes(executable);
}

/**
 * Whether the live process behind a recorded PID is the process that wrote
 * the owner record. A PID survives reboots and gets reused, so liveness alone
 * would keep a stale lock owned by whatever unrelated process holds the number
 * now (a login item after a reboot, typically) and no Host could ever start.
 */
export function isSameOwnerProcess(
  identity: RootOwnerProcessIdentity,
  facts: RootOwnerProcessFacts,
  nowMs: number,
): boolean {
  return startedAtMatches(identity, facts, nowMs) && commandMatches(identity, facts);
}
