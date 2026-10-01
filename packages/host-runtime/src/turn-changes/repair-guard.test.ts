import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolResult } from '@piwin/contracts';
import { runWithWorkspaceWriteGate } from '../tools/run-with-workspace-write-gate.js';
import { REPAIR_BLOCK_CODE } from './repair-guard.js';
import { openTurnChangeRuntime, type TurnChangeRuntime } from './runtime-wiring.js';

let workspaceRoot: string;
let storeRoot: string;
let runtime: TurnChangeRuntime;

/** A turn changed a.txt; its undo wrote a.txt and then stopped at needs-repair. */
async function seedStuckUndo(target: TurnChangeRuntime): Promise<void> {
  target.store.registerWorkspace({ workspaceId: 'ws-1', rootPath: workspaceRoot, hostInstanceId: 'host-1' });
  target.store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 's-1', workspaceId: 'ws-1' });
  const before = await target.objectStore.put(new TextEncoder().encode('before\n'));
  const after = await target.objectStore.put(new TextEncoder().encode('after\n'));
  target.store.publishChangeVersion({
    changeSetId: 'cs-1',
    revision: 1,
    files: [{ relativePath: 'a.txt', beforeSha: before.sha256, afterSha: after.sha256, beforeExists: true, afterExists: true }],
    coverageComplete: true,
  });
  target.store.activateVersion('cs-1', 1, 'ready');
  target.store.beginOperation({
    operationId: 'op-stuck',
    changeSetId: 'cs-1',
    kind: 'undo',
    expectedRevision: 1,
    principal: 'host',
    idempotencyKey: 'stuck-gesture',
    requestHash: 'h',
  });
  target.store.recordOperationStart({ operationId: 'op-stuck', workspaceId: 'ws-1' });
  target.store.recordOperationFiles([
    {
      operationId: 'op-stuck',
      relativePath: 'a.txt',
      fromSha: after.sha256,
      toSha: before.sha256,
      backupSha: after.sha256,
      fromExists: true,
      toExists: true,
      status: 'applied',
    },
  ]);
  target.store.updateOperationStatus('op-stuck', 'needs-repair');
}

function writeFileTool(target: TurnChangeRuntime, relativePath: string, text: string): Promise<ToolResult> {
  const filePath = join(workspaceRoot, relativePath);
  return runWithWorkspaceWriteGate({
    workspaceWrite: { gate: target.gate, workspaceId: workspaceRoot, rootPath: workspaceRoot },
    runId: 'run-1',
    ownerId: 's-2',
    signal: new AbortController().signal,
    mode: 'shared',
    wait: true,
    filePath,
    run: async () => {
      await writeFile(filePath, text);
      return { ok: true, output: 'ok' };
    },
  });
}

function acquireExclusive(target: TurnChangeRuntime, kind: 'git' | 'shell') {
  return target.gate.tryAcquire({
    workspaceId: workspaceRoot,
    rootPath: workspaceRoot,
    kind,
    mode: kind === 'shell' ? 'shared' : 'exclusive',
    wait: false,
  });
}

describe('needs-repair blocks new writes', () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'piwin-repair-guard-ws-'));
    storeRoot = await mkdtemp(join(tmpdir(), 'piwin-repair-guard-store-'));
    await writeFile(join(workspaceRoot, 'a.txt'), 'before\n');
    await writeFile(join(workspaceRoot, 'b.txt'), 'b\n');
    runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-1' });
    await seedStuckUndo(runtime);
  });

  afterEach(async () => {
    runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(storeRoot, { recursive: true, force: true });
  });

  it('refuses a file-tool write to a stuck path and leaves the file alone', async () => {
    const result = await writeFileTool(runtime, 'a.txt', 'new\n');
    expect(result).toMatchObject({ ok: false, details: { reason: REPAIR_BLOCK_CODE } });
    expect(result.ok ? '' : result.message).toContain('op-stuck');
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe('before\n');
  });

  it('allows writes to unrelated paths and ordinary shells', async () => {
    expect(await writeFileTool(runtime, 'b.txt', 'b2\n')).toMatchObject({ ok: true });
    const shell = await acquireExclusive(runtime, 'shell');
    expect(shell.ok).toBe(true);
    if (shell.ok) shell.lease.release();
  });

  it('refuses a repo-wide git operation on the workspace', async () => {
    expect(await acquireExclusive(runtime, 'git')).toEqual({
      ok: false,
      reason: 'needs-repair',
      operationId: 'op-stuck',
    });
  });

  it('keeps blocking after a Host restart and lifts once the repair verifies', async () => {
    runtime.close();
    runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-2' });
    expect(await writeFileTool(runtime, 'a.txt', 'new\n')).toMatchObject({ ok: false });

    // What recovery-verify does once every path is back to its pre-operation bytes.
    await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
    runtime.store.updateOperationStatus('op-stuck', 'rolled-back');
    expect(await writeFileTool(runtime, 'a.txt', 'new\n')).toMatchObject({ ok: true });
    const git = await acquireExclusive(runtime, 'git');
    expect(git.ok).toBe(true);
    if (git.ok) git.lease.release();
  });
});
