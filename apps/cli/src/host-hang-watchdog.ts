import { getHeapStatistics } from 'node:v8';
import { Worker } from 'node:worker_threads';
import {
  HOST_DIAGNOSTIC_REPORT_SIGNAL,
  pruneHostDiagnostics,
  writeHostDiagnosticReport,
} from './host-diagnostic-report.js';
import { HOST_HANG_WATCHDOG_WORKER_SOURCE } from './host-hang-watchdog-worker-source.js';
import {
  hostJitSymbolMapPath,
  hostJitSymbolsDirectory,
  pruneHostJitSymbolMaps,
} from './host-jit-symbols.js';
import {
  formatInFlightCommands,
  type InFlightCommandSnapshot,
} from './host-serve-inflight-commands.js';

const MIB = 1024 * 1024;
/** Heap use above this share of the limit is flagged: V8 starts GC-thrashing near it. */
const HEAP_NEAR_LIMIT_RATIO = 0.85;

export type HostHangWatchdogSettings = {
  /** Main-thread heartbeat period; also how often long-running commands are checked. */
  beatMs: number;
  /** Watchdog thread poll period. */
  pollMs: number;
  /** Heartbeat age that counts as a blocked main event loop. */
  blockedMs: number;
  /** Heartbeat age that triggers a native stack sample (macOS `sample`). */
  captureAfterMs: number;
  sampleSeconds: number;
  /** Re-log a continuing block this often. */
  repeatMs: number;
  /** Native samples per Host process at most. */
  maxCaptures: number;
  /** Periodic heap/RSS log line. */
  resourceLogMs: number;
};

export const DEFAULT_HOST_HANG_WATCHDOG_SETTINGS: HostHangWatchdogSettings = {
  beatMs: 1_000,
  pollMs: 500,
  blockedMs: 5_000,
  captureAfterMs: 20_000,
  sampleSeconds: 3,
  repeatMs: 60_000,
  maxCaptures: 3,
  resourceLogMs: 600_000,
};

export type HostHangWatchdogOptions = {
  logFilePath: string;
  diagnosticsDir: string;
  inFlightCommands: () => InFlightCommandSnapshot[];
  reportLongRunningCommands: () => void;
  log?: (line: string) => void;
  settings?: Partial<HostHangWatchdogSettings>;
};

export type HostHangWatchdog = {
  /** Log one heap/RSS line now (also runs on its own every `resourceLogMs`). */
  logResources: () => void;
  stop: () => Promise<void>;
};

export type HostResourceSample = {
  uptimeMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  inFlightCommands: number;
};

export function formatHostResourceLine(sample: HostResourceSample): string {
  const toMiB = (bytes: number): string => `${Math.round(bytes / MIB)}MiB`;
  const nearLimit = sample.heapUsedBytes >= sample.heapLimitBytes * HEAP_NEAR_LIMIT_RATIO;
  return (
    `[piwin host serve] resources uptime=${Math.round(sample.uptimeMs / 60_000)}m` +
    ` rss=${toMiB(sample.rssBytes)} heapUsed=${toMiB(sample.heapUsedBytes)}` +
    ` heapLimit=${toMiB(sample.heapLimitBytes)} external=${toMiB(sample.externalBytes)}` +
    ` arrayBuffers=${toMiB(sample.arrayBuffersBytes)} inflight=${sample.inFlightCommands}` +
    (nearLimit ? ' HEAP-NEAR-LIMIT' : '')
  );
}

/**
 * Hang diagnostics for the Host process: a watchdog thread that notices a
 * blocked main loop, periodic heap/RSS lines, long-running command lines, and
 * a diagnostic report on `HOST_DIAGNOSTIC_REPORT_SIGNAL`. Every timer is
 * unref'd so diagnostics never keep a finished Host alive.
 */
export function startHostHangWatchdog(options: HostHangWatchdogOptions): HostHangWatchdog {
  const settings = { ...DEFAULT_HOST_HANG_WATCHDOG_SETTINGS, ...options.settings };
  const log = options.log ?? ((line: string): void => console.error(line));
  const heartbeat = new BigInt64Array(new SharedArrayBuffer(3 * BigInt64Array.BYTES_PER_ELEMENT));

  const beat = (): void => {
    const heap = getHeapStatistics();
    Atomics.store(heartbeat, 1, BigInt(heap.used_heap_size));
    Atomics.store(heartbeat, 2, BigInt(heap.heap_size_limit));
    Atomics.store(heartbeat, 0, BigInt(Date.now()));
  };
  beat();
  const beatTimer = setInterval(() => {
    beat();
    options.reportLongRunningCommands();
  }, settings.beatMs);
  beatTimer.unref();

  const logResources = (): void => {
    const memory = process.memoryUsage();
    log(
      formatHostResourceLine({
        uptimeMs: process.uptime() * 1000,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapLimitBytes: getHeapStatistics().heap_size_limit,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        inFlightCommands: options.inFlightCommands().length,
      }),
    );
  };
  const resourceTimer = setInterval(logResources, settings.resourceLogMs);
  resourceTimer.unref();

  const worker = new Worker(HOST_HANG_WATCHDOG_WORKER_SOURCE, {
    eval: true,
    workerData: {
      heartbeat: heartbeat.buffer,
      logFilePath: options.logFilePath,
      diagnosticsDir: options.diagnosticsDir,
      jitSymbolMapPath: hostJitSymbolMapPath(options.diagnosticsDir, process.pid),
      pid: process.pid,
      platform: process.platform,
      pollMs: settings.pollMs,
      blockedMs: settings.blockedMs,
      captureAfterMs: settings.captureAfterMs,
      sampleSeconds: settings.sampleSeconds,
      repeatMs: settings.repeatMs,
      maxCaptures: settings.maxCaptures,
    },
    // The watchdog never needs the Host's env (provider keys).
    env: {},
  });
  worker.unref();
  worker.on('error', (error) => {
    log(`[piwin host serve] hang watchdog thread failed: ${error.message}`);
  });

  const onReportSignal = (): void => {
    log(
      `[piwin host serve] ${HOST_DIAGNOSTIC_REPORT_SIGNAL} received; in-flight: ${formatInFlightCommands(options.inFlightCommands())}`,
    );
    logResources();
    try {
      const file = writeHostDiagnosticReport(options.diagnosticsDir, 'signal');
      log(`[piwin host serve] diagnostic report written: ${file}`);
    } catch (error) {
      log(
        `[piwin host serve] diagnostic report failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  process.on(HOST_DIAGNOSTIC_REPORT_SIGNAL, onReportSignal);

  try {
    pruneHostDiagnostics(options.diagnosticsDir);
  } catch (error) {
    log(
      `[piwin host serve] diagnostics prune failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    pruneHostJitSymbolMaps(hostJitSymbolsDirectory(options.diagnosticsDir), process.pid);
  } catch (error) {
    log(
      `[piwin host serve] JIT symbol map prune failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    logResources,
    stop: async () => {
      clearInterval(beatTimer);
      clearInterval(resourceTimer);
      process.off(HOST_DIAGNOSTIC_REPORT_SIGNAL, onReportSignal);
      await worker.terminate();
    },
  };
}
