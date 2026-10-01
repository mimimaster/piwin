import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import { handleTurnChangeCommand } from './turn-change-commands.js';
import type { HostCommandContext } from './host-command-context.js';
import { openTurnChangeRuntime } from '../turn-changes/runtime-wiring.js';
import { workspaceIdForRoot } from '../turn-changes/coordinator.js';

const temporaryDirectories: string[] = [];

/** The success payload of a response the test expects to succeed. */
function dataOf(response: HostResponse | null): unknown {
  if (!response?.success) throw new Error(`expected success, got ${JSON.stringify(response)}`);
  return response.data;
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('turn-change command handlers', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('returns unsupported-capability for every turn-change command without a turn-change runtime', async () => {
    const commands: HostCommand[] = [
      { type: 'turn-changes/get', changeSetId: 'cs-1' },
      { type: 'turn-changes/list-by-runs', sessionId: 'session-1', runIds: ['run-1'] },
      { type: 'turn-changes/files', changeSetId: 'cs-1', revision: 1 },
      { type: 'turn-changes/diff', changeSetId: 'cs-1', revision: 1, fileId: 'file-1' },
      { type: 'turn-changes/check', changeSetId: 'cs-1', revision: 1, direction: 'undo' },
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      { type: 'turn-changes/redo', changeSetId: 'cs-1', expectedRevision: 1 },
      { type: 'turn-changes/operation', operationId: 'op-1' },
      { type: 'turn-changes/operations', workspaceId: 'ws-1' },
      { type: 'turn-changes/cancel', operationId: 'op-1' },
      { type: 'turn-changes/recovery-preview', operationId: 'op-1', expectedRevision: 1 },
      {
        type: 'turn-changes/recovery-run',
        operationId: 'op-1',
        expectedRevision: 1,
        confirmationToken: 'token-1',
      },
      { type: 'turn-changes/recovery-verify', operationId: 'op-1', expectedRevision: 1 },
    ];
    for (const command of commands) {
      const response = await handleTurnChangeCommand(command, 'request-turn-change');
      expect(response).toMatchObject({
        success: false,
        command: command.type,
        error: 'unsupported-capability',
        problem: { code: 'unsupported-capability' },
      });
    }
  });

  it('returns null for unrelated commands', async () => {
    expect(await handleTurnChangeCommand({ type: 'host/ping' }, 'request-ping')).toBeNull();
  });

  it('returns workspace-busy for undo while an exclusive lease is held', async () => {
    const workspaceRoot = await createTempDir('piwin-undo-busy-ws-');
    const storeRoot = await createTempDir('piwin-undo-busy-store-');
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src/a.txt'), 'after\n');
    const runtime = openTurnChangeRuntime({
      rootDir: storeRoot,
      hostInstanceId: 'host-1',
    });
    runtime.store.registerWorkspace({
      workspaceId: 'ws-1',
      rootPath: workspaceRoot,
      hostInstanceId: 'host-1',
    });
    runtime.store.createAttempt({
      changeSetId: 'cs-1',
      attemptId: 'att-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    const before = await runtime.objectStore.put(new TextEncoder().encode('before\n'));
    const after = await runtime.objectStore.put(new TextEncoder().encode('after\n'));
    runtime.store.publishChangeVersion({
      changeSetId: 'cs-1',
      revision: 1,
      files: [
        {
          relativePath: 'src/a.txt',
          beforeSha: before.sha256,
          afterSha: after.sha256,
          beforeExists: true,
          afterExists: true,
        },
      ],
      coverageComplete: true,
    });
    // Sealing publishes and activates together.
    runtime.store.activateVersion('cs-1', 1, 'ready');

    const held = await runtime.gate.tryAcquire({
      workspaceId: 'ws-1',
      rootPath: workspaceRoot,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(held.ok).toBe(true);

    const context = {
      turnChangeRuntime: runtime,
      turnChangeLockWaitMs: 50,
      push() {},
    } as unknown as HostCommandContext;
    const busy = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      'undo-busy',
      context,
    );
    expect(busy).toMatchObject({
      success: false,
      error: 'workspace-busy',
      problem: { code: 'workspace-busy' },
    });

    if (held.ok) {
      held.lease.release();
    }
    const undone = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      'undo-free',
      context,
    );
    expect(undone?.success).toBe(true);
    runtime.close();
  });

  it('lists undo/redo in the operation record by project path and reports their state', async () => {
    const workspaceRoot = await createTempDir('piwin-oplog-ws-');
    const storeRoot = await createTempDir('piwin-oplog-store-');
    await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
    const runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-1' });
    const workspaceId = workspaceIdForRoot(workspaceRoot);
    runtime.store.registerWorkspace({ workspaceId, rootPath: workspaceRoot, hostInstanceId: 'host-1' });
    runtime.store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 'sess-1', workspaceId });
    const before = await runtime.objectStore.put(new TextEncoder().encode('before\n'));
    const after = await runtime.objectStore.put(new TextEncoder().encode('after\n'));
    runtime.store.publishChangeVersion({
      changeSetId: 'cs-1',
      revision: 1,
      files: [{ relativePath: 'a.txt', beforeSha: before.sha256, afterSha: after.sha256, beforeExists: true, afterExists: true }],
      coverageComplete: true,
    });
    runtime.store.activateVersion('cs-1', 1, 'ready');
    const pushes: HostPush[] = [];
    const context = { turnChangeRuntime: runtime, push: (message: HostPush) => pushes.push(message) } as unknown as HostCommandContext;

    const undone = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      'undo-1',
      context,
    );
    const operationId = (dataOf(undone) as { operationId: string }).operationId;
    const operationPushes = pushes.filter((push) => push.type === 'turn-changes/operation-updated');
    // Start and end, plus one progress push for its single file.
    expect(operationPushes.filter((push) => !push.progress)).toHaveLength(2);
    expect(operationPushes.flatMap((push) => (push.progress ? [push.progress] : []))).toEqual([
      { done: 1, total: 1 },
    ]);

    const listed = await handleTurnChangeCommand(
      { type: 'turn-changes/operations', projectPath: workspaceRoot },
      'list-1',
      context,
    );
    expect(dataOf(listed)).toMatchObject({
      workspaceId,
      nextCursor: null,
      operations: [
        {
          operationId,
          direction: 'undo',
          status: 'succeeded',
          fileCount: 1,
          superseded: false,
          summary: { disposition: 'undone', redo: { allowed: true }, latestOperationId: operationId },
        },
      ],
    });

    const cancelLate = await handleTurnChangeCommand(
      { type: 'turn-changes/cancel', operationId },
      'cancel-1',
      context,
    );
    expect(dataOf(cancelLate)).toMatchObject({ status: 'succeeded', cancelled: false });

    // Undo → redo → undo without caller keys: each is its own operation, and
    // the last one really checks the files (here: refused, file edited since).
    const redone = await handleTurnChangeCommand(
      { type: 'turn-changes/redo', changeSetId: 'cs-1', expectedRevision: 1 },
      undefined,
      context,
    );
    expect(dataOf(redone)).toMatchObject({ status: 'succeeded' });
    await writeFile(join(workspaceRoot, 'a.txt'), 'edited\n');
    const again = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      undefined,
      context,
    );
    const againData = dataOf(again) as { operationId: string; status: string; reason?: string };
    expect(againData.operationId).not.toBe(operationId);
    expect(againData).toMatchObject({ status: 'rejected', reason: 'files-changed' });

    const repairUnneeded = await handleTurnChangeCommand(
      { type: 'turn-changes/recovery-preview', operationId, expectedRevision: 1 },
      'repair-1',
      context,
    );
    expect(repairUnneeded).toMatchObject({ success: false, problem: { code: 'direction-unavailable' } });
    runtime.close();
  });

  it('blocks undo and redo while an operation needs repair', async () => {
    const workspaceRoot = await createTempDir('piwin-repair-ws-');
    const storeRoot = await createTempDir('piwin-repair-store-');
    await writeFile(join(workspaceRoot, 'a.txt'), 'before\n');
    const runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-1' });
    runtime.store.registerWorkspace({ workspaceId: 'ws-1', rootPath: workspaceRoot, hostInstanceId: 'host-1' });
    runtime.store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 'sess-1', workspaceId: 'ws-1' });
    const before = await runtime.objectStore.put(new TextEncoder().encode('before\n'));
    const after = await runtime.objectStore.put(new TextEncoder().encode('after\n'));
    runtime.store.publishChangeVersion({
      changeSetId: 'cs-1',
      revision: 1,
      files: [{ relativePath: 'a.txt', beforeSha: before.sha256, afterSha: after.sha256, beforeExists: true, afterExists: true }],
      coverageComplete: true,
    });
    runtime.store.activateVersion('cs-1', 1, 'ready');
    runtime.store.beginOperation({
      operationId: 'op-stuck', changeSetId: 'cs-1', kind: 'undo', expectedRevision: 1,
      principal: 'host', idempotencyKey: 'k', requestHash: 'h',
    });
    runtime.store.recordOperationStart({ operationId: 'op-stuck', workspaceId: 'ws-1' });
    runtime.store.recordOperationFiles([
      { operationId: 'op-stuck', relativePath: 'a.txt', fromSha: after.sha256, toSha: before.sha256, backupSha: after.sha256, fromExists: true, toExists: true, status: 'applied' },
    ]);
    runtime.store.updateOperationStatus('op-stuck', 'needs-repair');
    const context = { turnChangeRuntime: runtime, push() {} } as unknown as HostCommandContext;

    const blocked = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      'undo-blocked',
      context,
    );
    expect(blocked).toMatchObject({ success: false, problem: { code: 'needs-repair' } });

    const preview = await handleTurnChangeCommand(
      { type: 'turn-changes/recovery-preview', operationId: 'op-stuck', expectedRevision: 1 },
      'preview',
      context,
    );
    const previewData = dataOf(preview) as { confirmationToken: string };
    const token = previewData.confirmationToken;
    expect(previewData).toMatchObject({ files: [{ relativePath: 'a.txt', state: 'operation-content' }] });
    const ran = await handleTurnChangeCommand(
      { type: 'turn-changes/recovery-run', operationId: 'op-stuck', expectedRevision: 1, confirmationToken: token },
      'run',
      context,
    );
    expect(dataOf(ran)).toMatchObject({ outcome: 'restored' });
    const verified = await handleTurnChangeCommand(
      { type: 'turn-changes/recovery-verify', operationId: 'op-stuck', expectedRevision: 1 },
      'verify',
      context,
    );
    expect(dataOf(verified)).toMatchObject({ verified: true });
    const summary = await handleTurnChangeCommand(
      { type: 'turn-changes/check', changeSetId: 'cs-1', revision: 1, direction: 'undo' },
      'check',
      context,
    );
    expect(dataOf(summary)).toMatchObject({ availability: { allowed: true } });
    runtime.close();
  });

  it('check and undo agree when an affected path is staged in Git', async () => {
    const workspaceRoot = await createTempDir('piwin-staged-ws-');
    const storeRoot = await createTempDir('piwin-staged-store-');
    const run = (...args: string[]) => execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8' });
    run('init', '-q');
    run('config', 'user.email', 'test@example.invalid');
    run('config', 'user.name', 'Test');
    await writeFile(join(workspaceRoot, 'a.txt'), 'before\n');
    run('add', '.');
    run('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
    await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
    run('add', 'a.txt');
    const runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-1' });
    const workspaceId = workspaceIdForRoot(workspaceRoot);
    runtime.store.registerWorkspace({ workspaceId, rootPath: workspaceRoot, hostInstanceId: 'host-1' });
    runtime.store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 'sess-1', workspaceId });
    const before = await runtime.objectStore.put(new TextEncoder().encode('before\n'));
    const after = await runtime.objectStore.put(new TextEncoder().encode('after\n'));
    runtime.store.publishChangeVersion({
      changeSetId: 'cs-1',
      revision: 1,
      files: [{ relativePath: 'a.txt', beforeSha: before.sha256, afterSha: after.sha256, beforeExists: true, afterExists: true }],
      coverageComplete: true,
    });
    runtime.store.activateVersion('cs-1', 1, 'ready');
    const context = { turnChangeRuntime: runtime, push() {} } as unknown as HostCommandContext;

    const check = await handleTurnChangeCommand(
      { type: 'turn-changes/check', changeSetId: 'cs-1', revision: 1, direction: 'undo' },
      'check-staged',
      context,
    );
    expect(dataOf(check)).toMatchObject({
      availability: { allowed: false, reason: 'staged-paths', affectedPaths: ['a.txt'] },
    });
    const undo = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      'undo-staged',
      context,
    );
    expect(dataOf(undo)).toMatchObject({ status: 'rejected', reason: 'staged-paths', affectedPaths: ['a.txt'] });
    expect(run('diff', '--cached', '--name-only').trim()).toBe('a.txt');
    runtime.close();
  });
});
