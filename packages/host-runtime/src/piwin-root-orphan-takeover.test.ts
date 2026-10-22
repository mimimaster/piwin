import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PiwinRootOwner } from './piwin-root-lease.js';
import {
  PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL,
  isOrphanedHostOwner,
  parsePsElapsed,
  parsePsProcessRow,
  stopOrphanedPiwinRootOwner,
  type RootOwnerProcessFacts,
} from './piwin-root-orphan-takeover.js';

const NOW_MS = Date.parse('2026-10-20T02:10:30Z');
const ORPHAN_PID = 29_799;
const HOST_COMMAND =
  '/Applications/piwin.app/Contents/MacOS/piwin-host /Applications/piwin.app/Contents/Resources/host/host-serve.mjs host serve --mode sdk';

function createOwner(startedAtMs: number): PiwinRootOwner {
  return {
    schemaVersion: 1,
    leaseId: randomUUID(),
    hostInstanceId: randomUUID(),
    processId: ORPHAN_PID,
    processStartedAt: new Date(startedAtMs).toISOString(),
    acquiredAt: new Date(startedAtMs).toISOString(),
    ownerKind: 'cli-command',
  };
}

async function rootWithOwner(owner: PiwinRootOwner): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-orphan-'));
  const lockDir = join(rootDir, '.host', 'owner.lock');
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify(owner));
  return rootDir;
}

/** A fake process that exits once it receives one of `exitsOn`. */
function fakeProcessTable(facts: RootOwnerProcessFacts, exitsOn: NodeJS.Signals[]) {
  let alive = true;
  const signals: NodeJS.Signals[] = [];
  let clockMs = NOW_MS;
  return {
    signals,
    options: {
      inspectProcess: async (): Promise<RootOwnerProcessFacts> => facts,
      isProcessAlive: (): boolean => alive,
      signalProcess: (_processId: number, signal: NodeJS.Signals): void => {
        signals.push(signal);
        if (exitsOn.includes(signal)) alive = false;
      },
      sleep: async (milliseconds: number): Promise<void> => {
        clockMs += milliseconds;
      },
      now: (): number => clockMs,
    },
  };
}

const orphanFacts: RootOwnerProcessFacts = {
  parentProcessId: 1,
  elapsedMs: 3_600_000,
  command: HOST_COMMAND,
};

describe('orphaned piwin root owner takeover', () => {
  it('parses ps elapsed time and process rows', () => {
    expect(parsePsElapsed('05:07')).toBe(307_000);
    expect(parsePsElapsed('01:05:07')).toBe(3_907_000);
    expect(parsePsElapsed('2-01:05:07')).toBe(176_707_000);
    expect(parsePsElapsed('soon')).toBeNull();
    expect(parsePsProcessRow(`    1  01:00:00 ${HOST_COMMAND}\n`)).toEqual(orphanFacts);
  });

  it('recognizes only a reparented host serve whose start time matches the record', () => {
    const owner = createOwner(NOW_MS - 3_600_000);
    expect(isOrphanedHostOwner(owner, orphanFacts, NOW_MS)).toBe(true);
    expect(isOrphanedHostOwner(owner, { ...orphanFacts, parentProcessId: 26_786 }, NOW_MS)).toBe(
      false,
    );
    expect(isOrphanedHostOwner(owner, { ...orphanFacts, command: '/usr/bin/vim notes' }, NOW_MS)).toBe(
      false,
    );
    // Same PID, different process: started long after the recorded owner.
    expect(isOrphanedHostOwner(owner, { ...orphanFacts, elapsedMs: 60_000 }, NOW_MS)).toBe(false);
  });

  it('stops an orphan with SIGTERM and waits for it to exit', async () => {
    const rootDir = await rootWithOwner(createOwner(NOW_MS - 3_600_000));
    const table = fakeProcessTable(orphanFacts, ['SIGTERM']);
    const result = await stopOrphanedPiwinRootOwner({ rootDir, ...table.options });
    expect(result.outcome).toBe('stopped');
    expect(table.signals).toEqual(['SIGTERM']);
  });

  it('escalates to SIGKILL after the bounded graceful wait', async () => {
    const rootDir = await rootWithOwner(createOwner(NOW_MS - 3_600_000));
    const table = fakeProcessTable(orphanFacts, ['SIGKILL']);
    const result = await stopOrphanedPiwinRootOwner({
      rootDir,
      stopTimeoutMs: 1_000,
      ...table.options,
    });
    expect(result.outcome).toBe('killed');
    expect(table.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('asks a wedged orphan for a report and samples its stack before SIGKILL', async () => {
    const rootDir = await rootWithOwner(createOwner(NOW_MS - 3_600_000));
    const table = fakeProcessTable(orphanFacts, ['SIGKILL']);
    const sampled: number[] = [];
    const lines: string[] = [];
    const result = await stopOrphanedPiwinRootOwner({
      rootDir,
      stopTimeoutMs: 1_000,
      diagnosticsDir: join(rootDir, 'diagnostics'),
      captureStackSample: async (processId) => {
        sampled.push(processId);
        return `/diag/orphan-host-${processId}.sample.txt`;
      },
      log: (line) => lines.push(line),
      ...table.options,
    });
    expect(result.outcome).toBe('killed');
    expect(table.signals).toEqual(['SIGTERM', PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL, 'SIGKILL']);
    expect(sampled).toEqual([ORPHAN_PID]);
    expect(lines.some((line) => line.includes(`orphan-host-${ORPHAN_PID}.sample.txt`))).toBe(true);
  });

  it('still kills the orphan when the stack sample fails', async () => {
    const rootDir = await rootWithOwner(createOwner(NOW_MS - 3_600_000));
    const table = fakeProcessTable(orphanFacts, ['SIGKILL']);
    const lines: string[] = [];
    const result = await stopOrphanedPiwinRootOwner({
      rootDir,
      stopTimeoutMs: 1_000,
      diagnosticsDir: join(rootDir, 'diagnostics'),
      captureStackSample: async () => {
        throw new Error('sample denied');
      },
      log: (line) => lines.push(line),
      ...table.options,
    });
    expect(result.outcome).toBe('killed');
    expect(table.signals.at(-1)).toBe('SIGKILL');
    expect(lines).toContain('stack sample failed: sample denied');
  });

  it('skips SIGKILL when an older Host dies on the report signal', async () => {
    const rootDir = await rootWithOwner(createOwner(NOW_MS - 3_600_000));
    const table = fakeProcessTable(orphanFacts, [PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL]);
    const result = await stopOrphanedPiwinRootOwner({
      rootDir,
      stopTimeoutMs: 1_000,
      diagnosticsDir: join(rootDir, 'diagnostics'),
      captureStackSample: async () => null,
      ...table.options,
    });
    expect(result.outcome).toBe('killed');
    expect(table.signals).toEqual(['SIGTERM', PIWIN_HOST_DIAGNOSTIC_REPORT_SIGNAL]);
  });

  it('never signals a live owner that still has its shell', async () => {
    const rootDir = await rootWithOwner(createOwner(NOW_MS - 3_600_000));
    const table = fakeProcessTable({ ...orphanFacts, parentProcessId: 26_786 }, ['SIGTERM']);
    const result = await stopOrphanedPiwinRootOwner({ rootDir, ...table.options });
    expect(result.outcome).toBe('owned');
    expect(table.signals).toEqual([]);
  });

  it('leaves a root without an owner to the lease', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-orphan-empty-'));
    const result = await stopOrphanedPiwinRootOwner({ rootDir });
    expect(result.outcome).toBe('no-live-owner');
  });
});
