import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { handleTurnChangeCommand } from './turn-change-commands.js';
import type { HostCommandContext } from './host-command-context.js';
import { openTurnChangeRuntime } from '../turn-changes/runtime-wiring.js';

const temporaryDirectories: string[] = [];

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

  it('returns unsupported-capability for turn-change commands until undo lands', async () => {
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
    runtime.store.markAttemptCaptureState('cs-1', 'ready');

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
});
