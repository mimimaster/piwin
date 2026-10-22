import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL } from '@piwin/host-runtime';

/** Sent by a successor Host before SIGKILL (see `stopOrphanedPiwinRootOwner`). */
export const HOST_DIAGNOSTIC_REPORT_SIGNAL = PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL;
/** Hang samples and reports kept under `<root>/diagnostics`; older ones are pruned. */
export const HOST_DIAGNOSTIC_FILES_KEPT = 20;
const HOST_DIAGNOSTIC_FILE = /^(host-hang|host-report|orphan-host)-.*\.(txt|json)$/;

export function hostDiagnosticsDirectory(piwinRoot: string): string {
  return join(piwinRoot, 'diagnostics');
}

/** File-name-safe UTC timestamp. */
export function diagnosticTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Write a Node diagnostic report (JS stack, heap stats, libuv handles,
 * resource usage). Environment variables carry provider keys, so every
 * `environmentVariables` block is stripped before anything reaches disk:
 * `excludeEnv` alone still embeds each worker thread's env in `workers[]`.
 * Network interfaces are skipped because their lookup can itself stall.
 */
export function writeHostDiagnosticReport(directory: string, reason: string): string {
  mkdirSync(directory, { recursive: true });
  // Not in every @types/node release; both exist on the bundled Node 22.23.
  Reflect.set(process.report, 'excludeEnv', true);
  Reflect.set(process.report, 'excludeNetwork', true);
  const file = join(
    directory,
    `host-report-${process.pid}-${reason}-${diagnosticTimestamp(new Date())}.json`,
  );
  const report: unknown = process.report.getReport();
  writeFileSync(file, `${JSON.stringify(stripEnvironmentVariables(report), null, 2)}\n`, {
    mode: 0o600,
  });
  return file;
}

/** Deep copy of a report with every `environmentVariables` key removed. */
export function stripEnvironmentVariables(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEnvironmentVariables);
  if (typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'environmentVariables') continue;
    copy[key] = stripEnvironmentVariables(entry);
  }
  return copy;
}

/** Keep only the newest `keep` diagnostic files so repeated hangs cannot fill the disk. */
export function pruneHostDiagnostics(directory: string, keep = HOST_DIAGNOSTIC_FILES_KEPT): number {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => HOST_DIAGNOSTIC_FILE.test(name));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
  const byNewest = names
    .map((name) => ({ name, mtimeMs: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  let removed = 0;
  for (const stale of byNewest.slice(keep)) {
    unlinkSync(join(directory, stale.name));
    removed += 1;
  }
  return removed;
}
