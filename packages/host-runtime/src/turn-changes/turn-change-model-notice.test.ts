import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HostCommandContext } from '../commands/host-command-context.js';
import { handleTurnChangeCommand } from '../commands/turn-change-commands.js';
import { workspaceIdForRoot } from './coordinator.js';
import { openTurnChangeRuntime, type TurnChangeRuntime } from './runtime-wiring.js';
import {
  commitTurnChangeModelNotice,
  formatTurnChangeModelNotice,
  NOTICE_MAX_PATHS,
  readTurnChangeModelNotice,
} from './turn-change-model-notice.js';

let workspaceRoot: string;
let otherRoot: string;
let storeRoot: string;
let runtime: TurnChangeRuntime;

/** Session `s-1` changed a.txt in a sealed turn; `s-2` has also worked here. */
async function seedTurn(target: TurnChangeRuntime): Promise<void> {
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  target.store.registerWorkspace({ workspaceId, rootPath: workspaceRoot, hostInstanceId: 'host-1' });
  target.store.createAttempt({ changeSetId: 'cs-1', attemptId: 'att-1', sessionId: 's-1', workspaceId });
  target.store.beginRunSegment({ runId: 'r-1', attemptId: 'att-1', source: 'prompt', startedAt: '2026-01-01T00:00:00.000Z' });
  target.store.createAttempt({ changeSetId: 'cs-2', attemptId: 'att-2', sessionId: 's-2', workspaceId });
  target.store.beginRunSegment({ runId: 'r-2', attemptId: 'att-2', source: 'prompt', startedAt: '2026-01-01T00:00:00.000Z' });
  const before = await target.objectStore.put(new TextEncoder().encode('before\n'));
  const after = await target.objectStore.put(new TextEncoder().encode('after\n'));
  target.store.publishChangeVersion({
    changeSetId: 'cs-1',
    revision: 1,
    files: [{ relativePath: 'a.txt', beforeSha: before.sha256, afterSha: after.sha256, beforeExists: true, afterExists: true }],
    coverageComplete: true,
  });
  target.store.activateVersion('cs-1', 1, 'ready');
}

async function undo(target: TurnChangeRuntime): Promise<void> {
  const context = { turnChangeRuntime: target, push() {} } as unknown as HostCommandContext;
  const response = await handleTurnChangeCommand(
    { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
    'undo-notice',
    context,
  );
  expect(response).toMatchObject({ success: true, data: { status: 'succeeded' } });
}

function deliver(target: TurnChangeRuntime, sessionId: string, root = workspaceRoot): string | undefined {
  const notice = readTurnChangeModelNotice({ store: target.store, sessionId, workspaceRoot: root });
  if (notice) commitTurnChangeModelNotice(target.store, sessionId, notice);
  return notice?.text;
}

describe('turn-change model notice', () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'piwin-notice-ws-'));
    otherRoot = await mkdtemp(join(tmpdir(), 'piwin-notice-other-'));
    storeRoot = await mkdtemp(join(tmpdir(), 'piwin-notice-store-'));
    await writeFile(join(workspaceRoot, 'a.txt'), 'after\n');
    runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-1' });
    await seedTurn(runtime);
  });

  afterEach(async () => {
    runtime.close();
    await Promise.all([workspaceRoot, otherRoot, storeRoot].map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('is empty before any undo', () => {
    expect(deliver(runtime, 's-1')).toBeUndefined();
  });

  it('tells each session in the workspace once, on its next prompt', async () => {
    await undo(runtime);
    const first = deliver(runtime, 's-1');
    expect(first).toContain('[piwin-turn-changes]');
    expect(first).toContain('undid an earlier turn of this conversation');
    expect(first).toContain('a.txt');
    expect(first).toContain('Re-read these files');
    expect(deliver(runtime, 's-1')).toBeUndefined();

    // Another session working in the same workspace hears about it too.
    expect(deliver(runtime, 's-2')).toContain('a turn from another session');
    expect(deliver(runtime, 's-2')).toBeUndefined();
  });

  it('does not reach sessions of another workspace, nor sessions that never worked here', async () => {
    await undo(runtime);
    expect(deliver(runtime, 's-2', otherRoot)).toBeUndefined();
    expect(deliver(runtime, 's-new')).toBeUndefined();
  });

  it('survives a Host restart without repeating', async () => {
    await undo(runtime);
    runtime.close();
    runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-2' });
    expect(deliver(runtime, 's-1')).toContain('a.txt');
    runtime.close();
    runtime = openTurnChangeRuntime({ rootDir: storeRoot, hostInstanceId: 'host-3' });
    expect(deliver(runtime, 's-1')).toBeUndefined();
  });

  it('caps the listed paths', () => {
    const paths = Array.from({ length: NOTICE_MAX_PATHS + 5 }, (_, index) => `f${String(index)}.ts`);
    const text = formatTurnChangeModelNotice(
      [{ operationId: 'op', changeSetId: 'cs', direction: 'redo', finishedAt: 't', turnSessionId: 's-9', relativePaths: paths }],
      's-1',
    );
    expect(text).toContain('restored (redo)');
    expect(text).toContain('(+5 more)');
    expect(text).not.toContain(`f${String(NOTICE_MAX_PATHS)}.ts`);
  });
});
