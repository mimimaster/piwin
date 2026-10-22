import { mkdtemp, readFile, readdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOST_DIAGNOSTIC_REPORT_SIGNAL,
  pruneHostDiagnostics,
} from './host-diagnostic-report.js';
import { formatHostResourceLine, startHostHangWatchdog } from './host-hang-watchdog.js';

const MIB = 1024 * 1024;

function blockMainThread(milliseconds: number): void {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    // Busy loop on purpose: the watchdog must notice a blocked event loop.
  }
}

async function waitForLog(file: string, needle: string, timeoutMs = 3_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    text = await readFile(file, 'utf8').catch(() => '');
    if (text.includes(needle)) return text;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return text;
}

describe('host hang watchdog', () => {
  it('records a blocked main event loop from its own thread, then the recovery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-hang-watchdog-'));
    const logFile = join(dir, 'host.log');
    const watchdog = startHostHangWatchdog({
      logFilePath: logFile,
      diagnosticsDir: join(dir, 'diagnostics'),
      inFlightCommands: () => [],
      reportLongRunningCommands: () => undefined,
      log: () => undefined,
      settings: {
        beatMs: 20,
        pollMs: 25,
        blockedMs: 200,
        captureAfterMs: 60_000,
        repeatMs: 60_000,
      },
    });
    try {
      // Let the worker start polling before the main loop stalls.
      await new Promise((resolve) => setTimeout(resolve, 300));
      blockMainThread(700);
      const text = await waitForLog(logFile, 'recovered after');
      expect(text).toMatch(/\[piwin host watchdog\] main event loop blocked for \d+ms rss=\d+MiB mainHeapUsed=/);
      expect(text).toMatch(/main event loop recovered after ~\d+ms blocked/);
    } finally {
      await watchdog.stop();
    }
  });

  it('writes a diagnostic report without env on the report signal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-hang-report-'));
    const diagnosticsDir = join(dir, 'diagnostics');
    const lines: string[] = [];
    const watchdog = startHostHangWatchdog({
      logFilePath: join(dir, 'host.log'),
      diagnosticsDir,
      inFlightCommands: () => [
        { type: 'session/compact', lane: 'serialized', ageMs: 50_000, timedOut: false },
      ],
      reportLongRunningCommands: () => undefined,
      log: (line) => lines.push(line),
    });
    const previousSecret = process.env.PIWIN_WATCHDOG_TEST_SECRET;
    process.env.PIWIN_WATCHDOG_TEST_SECRET = 'sk-should-not-leak';
    try {
      process.emit(HOST_DIAGNOSTIC_REPORT_SIGNAL);
      const [report] = await readdir(diagnosticsDir);
      expect(report).toMatch(/^host-report-\d+-signal-.*\.json$/);
      const body = await readFile(join(diagnosticsDir, report ?? ''), 'utf8');
      // `excludeEnv` alone still leaked this value here (worker-thread env).
      expect(body).not.toContain('sk-should-not-leak');
      expect(body).not.toContain('environmentVariables');
      expect(JSON.parse(body)).toHaveProperty('javascriptStack');
      expect(lines[0]).toContain('in-flight: session/compact(lane=serialized age=50000ms)');
      expect(lines.some((line) => line.startsWith('[piwin host serve] resources '))).toBe(true);
    } finally {
      if (previousSecret === undefined) delete process.env.PIWIN_WATCHDOG_TEST_SECRET;
      else process.env.PIWIN_WATCHDOG_TEST_SECRET = previousSecret;
      await watchdog.stop();
    }
  });

  it('flags heap use near the limit in the resource line', () => {
    const sample = {
      uptimeMs: 90 * 60_000,
      rssBytes: 900 * MIB,
      heapUsedBytes: 3_600 * MIB,
      heapLimitBytes: 4_096 * MIB,
      externalBytes: 12 * MIB,
      arrayBuffersBytes: 3 * MIB,
      inFlightCommands: 2,
    };
    expect(formatHostResourceLine(sample)).toBe(
      '[piwin host serve] resources uptime=90m rss=900MiB heapUsed=3600MiB heapLimit=4096MiB external=12MiB arrayBuffers=3MiB inflight=2 HEAP-NEAR-LIMIT',
    );
    expect(formatHostResourceLine({ ...sample, heapUsedBytes: 1_000 * MIB })).not.toContain(
      'HEAP-NEAR-LIMIT',
    );
  });

  it('prunes all but the newest diagnostic files and leaves other files alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-hang-prune-'));
    for (let index = 0; index < 5; index += 1) {
      const file = join(dir, `host-hang-1-${index}.sample.txt`);
      await writeFile(file, 'x');
      const at = new Date(Date.UTC(2026, 9, 22, 0, index));
      await utimes(file, at, at);
    }
    await writeFile(join(dir, 'notes.txt'), 'keep');
    expect(pruneHostDiagnostics(dir, 2)).toBe(3);
    expect((await readdir(dir)).sort()).toEqual([
      'host-hang-1-3.sample.txt',
      'host-hang-1-4.sample.txt',
      'notes.txt',
    ]);
    expect(pruneHostDiagnostics(join(dir, 'missing'))).toBe(0);
  });
});
