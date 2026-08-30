import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTurnChangeObjectStore,
  openTurnChangeStore,
  type TurnChangeStore,
} from '@piwin/git';
import { createPermissiveToolAdmission } from '../tools/tool-admission.js';
import { HostToolExecutionRouter } from '../tools/host-tool-execution-router.js';
import { buildHostFilesystemTools } from '../tools/host-filesystem-tools.js';
import { createExecutionTracker } from './execution-tracker.js';
import { bindCaptureReceipts, createToolCapturePort } from './tool-capture.js';
import { createTurnChangeCoordinator } from './coordinator.js';
import { openTurnChangeRuntime } from './runtime-wiring.js';

const temporaryDirectories: string[] = [];
const openStores: TurnChangeStore[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createCoordinatorHarness(): Promise<{
  store: TurnChangeStore;
  storeRoot: string;
  parentRoot: string;
  childRoot: string;
  coordinator: ReturnType<typeof createTurnChangeCoordinator>;
}> {
  const storeRoot = await createTempDir('piwin-tc-coord-store-');
  const parentRoot = await createTempDir('piwin-tc-coord-parent-');
  const childRoot = await createTempDir('piwin-tc-coord-child-');
  const store = openTurnChangeStore({ rootDir: storeRoot });
  openStores.push(store);
  return {
    store,
    storeRoot,
    parentRoot,
    childRoot,
    coordinator: createTurnChangeCoordinator({ store, hostInstanceId: 'host-1' }),
  };
}

describe('createTurnChangeCoordinator', () => {
  afterEach(async () => {
    for (const store of openStores.splice(0)) {
      store.close();
    }
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('keeps pause/continue on the same changeSetId and appends a run segment', async () => {
    const { store, parentRoot, coordinator } = await createCoordinatorHarness();
    const first = coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'um-1',
      runId: 'run-1',
      source: 'prompt',
      workspaceRoot: parentRoot,
    });
    coordinator.endRunSegment('run-1');

    const resumed = coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: null,
      runId: 'run-2',
      source: 'resume',
      workspaceRoot: parentRoot,
    });

    expect(resumed.changeSetId).toBe(first.changeSetId);
    expect(resumed.attemptId).toBe(first.attemptId);
    expect(store.listRunIdsByAttempt(first.attemptId)).toEqual(['run-1', 'run-2']);
    expect(store.getRunSegment('run-1')?.endedAt).toEqual(expect.any(String));
    expect(store.getRunSegment('run-2')?.source).toBe('resume');
    expect(store.getRunSegment('run-2')?.endedAt).toBeNull();
  });

  it('allocates a new changeSetId for retry of the same user message', async () => {
    const { store, parentRoot, coordinator } = await createCoordinatorHarness();
    const first = coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'um-1',
      runId: 'run-1',
      source: 'prompt',
      workspaceRoot: parentRoot,
    });
    coordinator.endRunSegment('run-1');

    const retry = coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'um-1',
      runId: 'run-retry',
      source: 'prompt',
      workspaceRoot: parentRoot,
    });

    expect(retry.changeSetId).not.toBe(first.changeSetId);
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(store.listRunIdsByAttempt(first.attemptId)).toEqual(['run-1']);
    expect(store.listRunIdsByAttempt(retry.attemptId)).toEqual(['run-retry']);
  });

  it('allocates a new changeSetId for a new user prompt', async () => {
    const { parentRoot, coordinator } = await createCoordinatorHarness();
    const first = coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'um-1',
      runId: 'run-1',
      source: 'prompt',
      workspaceRoot: parentRoot,
    });
    coordinator.endRunSegment('run-1');
    const next = coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'um-2',
      runId: 'run-2',
      source: 'prompt',
      workspaceRoot: parentRoot,
    });
    expect(next.changeSetId).not.toBe(first.changeSetId);
    expect(next.userMessageId).toBe('um-2');
  });

  it('does not insert child worktree write_file into the parent run file_action list', async () => {
    const { store, storeRoot, parentRoot, childRoot, coordinator } = await createCoordinatorHarness();
    coordinator.beginAttempt({
      sessionId: 'parent-session',
      userMessageId: 'um-1',
      runId: 'parent-run',
      source: 'prompt',
      workspaceRoot: parentRoot,
    });
    coordinator.beginAttempt({
      sessionId: 'child-session',
      userMessageId: null,
      runId: 'child-run',
      source: 'child',
      workspaceRoot: childRoot,
    });

    const capture = createToolCapturePort({
      store,
      resolveChangeSetId: (runId) => coordinator.getBindingByRun(runId)?.changeSetId,
    });
    const objects = createTurnChangeObjectStore({ rootDir: storeRoot });
    const parentTools = buildHostFilesystemTools({
      cwd: parentRoot,
      turnChange: {
        workspaceRoot: parentRoot,
        store: objects,
        onReceipt: bindCaptureReceipts(capture),
      },
    });
    const childTools = buildHostFilesystemTools({
      cwd: childRoot,
      turnChange: {
        workspaceRoot: childRoot,
        store: objects,
        onReceipt: bindCaptureReceipts(capture),
      },
    });
    const tracker = createExecutionTracker();
    const parentRouter = new HostToolExecutionRouter({
      tools: parentTools,
      admission: createPermissiveToolAdmission(),
      capture,
      tracker,
    });
    const childRouter = new HostToolExecutionRouter({
      tools: childTools,
      admission: createPermissiveToolAdmission(),
      capture,
      tracker,
    });

    const parentWrite = await parentRouter.execute(
      'write_file',
      { path: 'parent.txt', content: 'parent-bytes' },
      new AbortController().signal,
      {
        sessionId: 'parent-session',
        runtimeGenerationId: 'gen-parent',
        runId: 'parent-run',
        toolCallId: 'parent-call',
        toolName: 'write_file',
      },
    );
    const childWrite = await childRouter.execute(
      'write_file',
      { path: 'child.txt', content: 'child-bytes' },
      new AbortController().signal,
      {
        sessionId: 'child-session',
        runtimeGenerationId: 'gen-child',
        runId: 'child-run',
        toolCallId: 'child-call',
        toolName: 'write_file',
      },
    );
    expect(parentWrite.ok).toBe(true);
    expect(childWrite.ok).toBe(true);
    expect(await readFile(join(childRoot, 'child.txt'), 'utf8')).toBe('child-bytes');

    const parentActions = store.listFileActionsByRun('parent-run');
    expect(parentActions.map((action) => action.relativePath)).toEqual(['parent.txt']);
    expect(parentActions.some((action) => action.relativePath === 'child.txt')).toBe(false);
    expect(store.listFileActionsByRun('child-run').map((action) => action.relativePath)).toEqual([
      'child.txt',
    ]);
  });

  it('opens the runtime store under an injected mkdtemp rather than ~/.piwin', async () => {
    const rootDir = await createTempDir('piwin-tc-runtime-');
    const runtime = openTurnChangeRuntime({
      rootDir,
      hostInstanceId: 'host-test',
    });
    openStores.push(runtime.store);
    runtime.coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'um-1',
      runId: 'run-1',
      source: 'prompt',
      workspaceRoot: rootDir,
    });
    expect(runtime.store.getAttempt(runtime.coordinator.getCurrentBinding('session-1')?.changeSetId ?? '')).toMatchObject({
      sessionId: 'session-1',
      userMessageId: 'um-1',
    });
    await writeFile(join(rootDir, 'probe.txt'), 'ok', 'utf8');
    expect(rootDir.startsWith(join(homedir(), '.piwin'))).toBe(false);
  });
});
