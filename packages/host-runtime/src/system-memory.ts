/**
 * System available-memory probe and the shell-admission gate built on it.
 *
 * Why (2026-09-12 incident): `execution.maxConcurrentRuns` counts Runs and
 * `process.maxProcesses` counts Jobs. A single `bash` call running
 * `pnpm test` scored 1 against both while forking ten ~1 GiB vitest workers,
 * so every product quota stayed green while the machine hit
 * out-of-application-memory. Nothing measured the fan-out *inside* one tool
 * call. This module supplies that missing measurement.
 *
 * On macOS the signal is `kern.memorystatus_level` — the percentage the
 * kernel itself uses to decide when to start killing processes, not a
 * derived `vm_stat` estimate. During the incident it sat near 5%.
 *
 * Sampling is asynchronous and cached so the gate itself stays a pure,
 * synchronous function on the tool-execution hot path.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MIB = 1024 * 1024;

export type AvailableMemorySource = 'memorystatus' | 'meminfo';

export type AvailableMemoryReading = {
  availableMiB: number;
  totalMiB: number;
  source: AvailableMemorySource;
  sampledAtMs: number;
};

export type ReadAvailableMemory = () => Promise<AvailableMemoryReading | null>;

export type SystemMemoryReaderDeps = {
  platform?: NodeJS.Platform;
  totalMemoryBytes?: () => number;
  runSysctl?: (name: string) => Promise<string>;
  readMeminfo?: () => Promise<string>;
  now?: () => number;
};

async function defaultSysctl(name: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/sbin/sysctl', ['-n', name], { timeout: 2000 });
  return stdout;
}

function defaultMeminfo(): Promise<string> {
  return readFile('/proc/meminfo', 'utf8');
}

/**
 * Read system available memory, or `null` when this platform cannot be
 * measured. Callers must treat `null` as "gate disabled" — an unmeasurable
 * host must never be able to wedge the agent.
 */
export function createAvailableMemoryReader(
  deps: SystemMemoryReaderDeps = {},
): ReadAvailableMemory {
  const platform = deps.platform ?? process.platform;
  const totalBytes = deps.totalMemoryBytes ?? (() => os.totalmem());
  const sysctl = deps.runSysctl ?? defaultSysctl;
  const meminfo = deps.readMeminfo ?? defaultMeminfo;
  const now = deps.now ?? (() => Date.now());

  return async () => {
    try {
      if (platform === 'darwin') {
        // A percentage of "available" as the kernel counts it: free plus what
        // it knows it can reclaim. This is the same ledger behind the
        // out-of-application-memory panel.
        const level = Number.parseFloat((await sysctl('kern.memorystatus_level')).trim());
        if (!Number.isFinite(level) || level < 0 || level > 100) {
          return null;
        }
        const totalMiB = Math.floor(totalBytes() / MIB);
        if (totalMiB <= 0) {
          return null;
        }
        return {
          availableMiB: Math.floor((totalMiB * level) / 100),
          totalMiB,
          source: 'memorystatus',
          sampledAtMs: now(),
        };
      }
      if (platform === 'linux') {
        const text = await meminfo();
        const available = /^MemAvailable:\s+(\d+) kB$/m.exec(text);
        const total = /^MemTotal:\s+(\d+) kB$/m.exec(text);
        if (!available || !total) {
          return null;
        }
        return {
          availableMiB: Math.floor(Number(available[1]) / 1024),
          totalMiB: Math.floor(Number(total[1]) / 1024),
          source: 'meminfo',
          sampledAtMs: now(),
        };
      }
      return null;
    } catch {
      // Sandboxed sysctl, missing /proc, timeout: unmeasurable, not "empty".
      return null;
    }
  };
}

export type SystemMemoryMonitor = {
  /** Latest sample, or `null` before the first one lands / when unmeasurable. */
  getLatest(): AvailableMemoryReading | null;
  /** Take one sample now and return it. */
  refresh(): Promise<AvailableMemoryReading | null>;
  stop(): void;
};

export type SystemMemoryMonitorOptions = {
  read?: ReadAvailableMemory;
  /** Resample cadence. Cheap (one sysctl), but not worth doing per tool call. */
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 5000;

export function createSystemMemoryMonitor(
  options: SystemMemoryMonitorOptions = {},
): SystemMemoryMonitor {
  const read = options.read ?? createAvailableMemoryReader();
  const intervalMs = options.intervalMs ?? DEFAULT_MEMORY_SAMPLE_INTERVAL_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  let latest: AvailableMemoryReading | null = null;
  let stopped = false;

  const refresh = async (): Promise<AvailableMemoryReading | null> => {
    const reading = await read();
    if (!stopped) {
      latest = reading;
    }
    return reading;
  };

  const timer = setIntervalFn(() => {
    void refresh();
  }, intervalMs);
  // Sampling must never hold the Host process open.
  (timer as { unref?: () => void }).unref?.();

  return {
    getLatest: () => latest,
    refresh,
    stop: () => {
      stopped = true;
      clearIntervalFn(timer);
    },
  };
}

export type ShellMemoryAdmission =
  | { admit: true; reason: 'disabled' | 'unmeasured' | 'sufficient' }
  | { admit: false; reason: 'low-memory'; availableMiB: number; requiredMiB: number; message: string };

/**
 * Decide whether a shell tool call may start. Pure; no IO.
 *
 * Fails open in both unmeasurable cases (gate off, or no sample yet): refusing
 * work because the probe is blind would be worse than the leak it guards.
 */
export function evaluateShellMemoryAdmission(input: {
  minAvailableMemoryMiB: number;
  reading: AvailableMemoryReading | null;
}): ShellMemoryAdmission {
  if (input.minAvailableMemoryMiB <= 0) {
    return { admit: true, reason: 'disabled' };
  }
  if (!input.reading) {
    return { admit: true, reason: 'unmeasured' };
  }
  if (input.reading.availableMiB >= input.minAvailableMemoryMiB) {
    return { admit: true, reason: 'sufficient' };
  }
  return {
    admit: false,
    reason: 'low-memory',
    availableMiB: input.reading.availableMiB,
    requiredMiB: input.minAvailableMemoryMiB,
    // Addressed to the model: say what to do, not just what failed.
    message:
      `System memory is low: ${input.reading.availableMiB} MiB available of ` +
      `${input.reading.totalMiB} MiB, below the ${input.minAvailableMemoryMiB} MiB floor ` +
      `(settings: execution.minAvailableMemoryMiB). This command was not run. ` +
      `Wait for memory to free up, or re-run it with reduced parallelism ` +
      `(for example \`--workspace-concurrency=1\`, \`--maxWorkers=1\`, \`-j1\`) ` +
      `and avoid starting other builds or test runs at the same time.`,
  };
}

/**
 * Refusal emitted by {@link createToolResourceGate}. `refuse: false` is the
 * ordinary path and carries nothing, so callers cannot accidentally read a
 * stale message off an admitted call.
 */
export type ToolResourceRefusal =
  | { refuse: true; reason: 'low-memory'; availableMiB: number; requiredMiB: number; message: string }
  | { refuse: false };

/** Consulted by the tool admission stage before any policy evaluation. */
export type ToolResourceGate = (input: { action: string }) => ToolResourceRefusal;

/**
 * Actions whose executor forks a process tree the product cannot see or
 * count. `bash` is the incident path (`pnpm test` -> ten vitest workers);
 * `process:start` is the same hazard with a longer lifetime.
 */
export function actionSpawnsSubprocesses(action: string): boolean {
  return action === 'bash' || action.startsWith('bash:') || action === 'process:start';
}

/**
 * Build the admission-stage gate. Only subprocess-spawning actions are
 * considered: refusing `read` or `grep` under memory pressure would cost the
 * model its ability to diagnose the pressure.
 */
export function createToolResourceGate(deps: {
  getMinAvailableMemoryMiB: () => number;
  getReading: () => AvailableMemoryReading | null;
  spawnsSubprocesses?: (action: string) => boolean;
}): ToolResourceGate {
  const spawns = deps.spawnsSubprocesses ?? actionSpawnsSubprocesses;
  return ({ action }) => {
    if (!spawns(action)) {
      return { refuse: false };
    }
    const decision = evaluateShellMemoryAdmission({
      minAvailableMemoryMiB: deps.getMinAvailableMemoryMiB(),
      reading: deps.getReading(),
    });
    if (decision.admit) {
      return { refuse: false };
    }
    return {
      refuse: true,
      reason: 'low-memory',
      availableMiB: decision.availableMiB,
      requiredMiB: decision.requiredMiB,
      message: decision.message,
    };
  };
}

/**
 * Process-wide sampler. One Host process needs exactly one `sysctl` cadence,
 * and the tool surface is rebuilt per generation, so the monitor deliberately
 * outlives it. Tests inject a gate directly and never touch this.
 */
let sharedMonitor: SystemMemoryMonitor | null = null;

export function getSharedSystemMemoryMonitor(
  options?: SystemMemoryMonitorOptions,
): SystemMemoryMonitor {
  if (!sharedMonitor) {
    sharedMonitor = createSystemMemoryMonitor(options);
    // The interval only fires later; without this first sample the gate would
    // fail open for the whole first interval after Host start.
    void sharedMonitor.refresh();
  }
  return sharedMonitor;
}

/** Test/host-shutdown hook. Stops the sampler and drops the instance. */
export function resetSharedSystemMemoryMonitor(): void {
  sharedMonitor?.stop();
  sharedMonitor = null;
}
