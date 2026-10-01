import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '@piwin/contracts';
import { createWorkspaceWriteGate, type WorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';
import { runHostShell } from './run-host-shell.js';
import { runWithWorkspaceWriteGate, type WorkspaceWriteBinding } from './run-with-workspace-write-gate.js';
import { resetWorkspaceFingerprintCooldownsForTests } from './workspace-fingerprint.js';

const fingerprintCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('./workspace-fingerprint.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace-fingerprint.js')>();
  return {
    ...actual,
    captureWorkspaceFingerprint: (...args: Parameters<typeof actual.captureWorkspaceFingerprint>) => {
      fingerprintCalls.count += 1;
      return actual.captureWorkspaceFingerprint(...args);
    },
  };
});

let root: string;
let gate: WorkspaceWriteGate;
let binding: WorkspaceWriteBinding;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function shell(sessionId: string, command: string): Promise<ToolResult> {
  return runHostShell({
    command,
    cwd: root,
    signal: new AbortController().signal,
    runId: `run-${sessionId}`,
    sessionId,
    workspaceWrite: binding,
  });
}

function writeAs(sessionId: string, relativePath: string, text: string): Promise<ToolResult> {
  const filePath = join(root, relativePath);
  return runWithWorkspaceWriteGate({
    workspaceWrite: binding,
    runId: `run-${sessionId}`,
    ownerId: sessionId,
    signal: new AbortController().signal,
    mode: 'shared',
    wait: true,
    filePath,
    run: async () => {
      await writeFile(filePath, text);
      return { ok: true, output: `Wrote ${relativePath}` };
    },
  });
}

function textOf(result: ToolResult): string {
  return result.ok ? result.output : result.message;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('runHostShell under the optimistic workspace policy', () => {
  beforeEach(async () => {
    resetWorkspaceFingerprintCooldownsForTests();
    fingerprintCalls.count = 0;
    root = await mkdtemp(join(tmpdir(), 'piwin-host-shell-'));
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    await writeFile(join(root, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    gate = createWorkspaceWriteGate();
    binding = { gate, workspaceId: root, rootPath: root };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lets another session write while a long command runs, then says so', async () => {
    const long = shell('session-a', 'sleep 0.4; echo done');
    await delay(100);
    const startedWrite = Date.now();
    const write = await writeAs('session-b', 'b.ts', 'export {};\n');
    expect(write.ok).toBe(true);
    // Not serialized behind the 400ms command.
    expect(Date.now() - startedWrite).toBeLessThan(250);

    const result = await long;
    expect(result.ok).toBe(true);
    expect(textOf(result)).toContain('done');
    expect(textOf(result)).toContain('Written by other sessions: b.ts');
    expect(result.details?.workspaceWrite).toMatchObject({
      lock: 'shared',
      concurrentChanges: { otherSessionWrites: ['b.ts'] },
    });
  });

  it('stays silent when another session only read during the run', async () => {
    const long = shell('session-a', 'sleep 0.3; echo done');
    await delay(80);
    const read = await shell('session-b', 'cat a.txt');
    expect(textOf(read)).toBe('a\n');
    const result = await long;
    expect(textOf(result)).toBe('done\n');
    expect(result.details?.workspaceWrite?.concurrentChanges).toBeUndefined();
  });

  it("reports files another session's shell changed during the run", async () => {
    const long = shell('session-a', 'sleep 0.4; echo done');
    await delay(100);
    await shell('session-b', 'echo generated > c.txt');
    const result = await long;
    expect(textOf(result)).toContain('Changed during the run');
    expect(result.details?.workspaceWrite?.concurrentChanges?.changedDuringRun).toContain('c.txt');
  });

  it("does not flag the same session's own parallel work", async () => {
    const long = shell('session-a', 'sleep 0.3; echo done');
    await delay(80);
    await writeAs('session-a', 'own.ts', 'x\n');
    const result = await long;
    expect(textOf(result)).toBe('done\n');
  });

  it('queues a listed repo-wide command behind a running shell and reports the wait', async () => {
    const long = shell('session-a', 'sleep 0.3; echo done');
    await delay(50);
    const restore = await shell('session-b', 'git restore a.txt');
    expect(restore.ok).toBe(true);
    expect(restore.details?.workspaceWrite?.lock).toBe('exclusive');
    expect(restore.details?.workspaceWrite?.queuedMs ?? 0).toBeGreaterThanOrEqual(150);
    await long;
  });

  it('costs a single session no fingerprint at all', async () => {
    await shell('session-a', 'echo one > x.txt');
    await shell('session-a', 'cat x.txt');
    expect(fingerprintCalls.count).toBe(0);
  });
});

