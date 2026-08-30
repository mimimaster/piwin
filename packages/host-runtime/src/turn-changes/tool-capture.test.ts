import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import {
  createTurnChangeObjectStore,
  openTurnChangeStore,
  type TurnChangeStore,
} from '@piwin/git';
import { createPermissiveToolAdmission, type HostToolAdmission } from '../tools/tool-admission.js';
import { HostToolExecutionRouter } from '../tools/host-tool-execution-router.js';
import { buildHostFilesystemTools } from '../tools/host-filesystem-tools.js';
import { createExecutionTracker, type ExecutionTracker } from './execution-tracker.js';
import { bindCaptureReceipts, createToolCapturePort, type ToolCapturePort } from './tool-capture.js';

const temporaryDirectories: string[] = [];
const openStores: TurnChangeStore[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

type CaptureHarness = {
  workspaceRoot: string;
  store: TurnChangeStore;
  capture: ToolCapturePort;
  tracker: ExecutionTracker;
  tools: HostToolRegistration[];
  router: HostToolExecutionRouter;
};

async function createHarness(
  admission: HostToolAdmission = createPermissiveToolAdmission(),
): Promise<CaptureHarness> {
  const workspaceRoot = await createTempDir('piwin-tool-capture-ws-');
  const storeRoot = await createTempDir('piwin-tool-capture-store-');
  const store = openTurnChangeStore({ rootDir: storeRoot });
  openStores.push(store);
  const objects = createTurnChangeObjectStore({ rootDir: storeRoot });
  store.registerWorkspace({
    workspaceId: 'ws-1',
    rootPath: workspaceRoot,
    hostInstanceId: 'host-1',
  });
  store.createAttempt({
    changeSetId: 'cs-1',
    attemptId: 'att-1',
    sessionId: 'session-1',
    workspaceId: 'ws-1',
  });
  const capture = createToolCapturePort({ store, changeSetId: 'cs-1' });
  const tracker = createExecutionTracker();
  const tools = buildHostFilesystemTools({
    cwd: workspaceRoot,
    turnChange: {
      workspaceRoot,
      store: objects,
      onReceipt: bindCaptureReceipts(capture),
    },
  });
  const router = new HostToolExecutionRouter({
    tools,
    admission,
    capture,
    tracker,
  });
  return { workspaceRoot, store, capture, tracker, tools, router };
}

function denyWriteAdmission(): HostToolAdmission {
  return {
    ...createPermissiveToolAdmission(),
    policyEvaluator: {
      evaluate: () => ({
        kind: 'decision',
        policy: {
          decision: 'deny',
          reason: 'test-deny',
          action: 'file-write',
          rememberable: false,
        },
      }),
    },
  };
}

function requireTool(tools: HostToolRegistration[], name: string): HostToolRegistration {
  const tool = tools.find((candidate) => candidate.descriptor.name === name);
  if (!tool) {
    throw new Error(`${name} was not registered`);
  }
  return tool;
}

let toolCallSeq = 0;

async function executeWrite(
  router: HostToolExecutionRouter,
  args: Record<string, unknown>,
  toolName = 'write_file',
): Promise<ToolResult> {
  toolCallSeq += 1;
  return router.execute(toolName, args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolCallId: `call-${toolName}-${toolCallSeq}`,
    toolName,
  });
}

describe('tool capture', () => {
  afterEach(async () => {
    for (const store of openStores.splice(0)) {
      store.close();
    }
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('permission deny: target file absent and no file_action rows', async () => {
    const { workspaceRoot, store, router } = await createHarness(denyWriteAdmission());
    const relativePath = 'denied.txt';

    const result = await executeWrite(router, { path: relativePath, content: 'nope' });
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' });
    await expect(stat(join(workspaceRoot, relativePath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(store.listFileActionsByRun('run-1')).toEqual([]);
  });

  it('write_file create then overwrite stores real before/after bytes', async () => {
    const { workspaceRoot, store, router } = await createHarness();
    const relativePath = 'note.txt';
    const first = new TextEncoder().encode('first\n');
    const second = new TextEncoder().encode('second\n');

    const created = await executeWrite(router, { path: relativePath, content: 'first\n' });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.output).toContain(`Wrote ${join(workspaceRoot, relativePath)}`);
    }

    const overwritten = await executeWrite(router, { path: relativePath, content: 'second\n' });
    expect(overwritten.ok).toBe(true);

    const actions = store.listFileActionsByRun('run-1');
    expect(actions).toHaveLength(2);
    const createAction = actions[0];
    const overwriteAction = actions[1];
    if (!createAction || !overwriteAction) {
      throw new Error('expected two file_action rows');
    }

    expect(createAction.beforeExists).toBe(false);
    expect(createAction.afterExists).toBe(true);
    expect(createAction.afterSha).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    if (createAction.afterSha === null) {
      throw new Error('expected afterSha');
    }
    expect(await store.getObject(createAction.afterSha)).toEqual(first);

    expect(overwriteAction.beforeExists).toBe(true);
    expect(overwriteAction.afterExists).toBe(true);
    if (overwriteAction.beforeSha === null || overwriteAction.afterSha === null) {
      throw new Error('expected beforeSha and afterSha');
    }
    expect(await store.getObject(overwriteAction.beforeSha)).toEqual(first);
    expect(await store.getObject(overwriteAction.afterSha)).toEqual(second);
    expect(await readFile(join(workspaceRoot, relativePath))).toEqual(Buffer.from(second));
  });

  it('delete_file removes the file and keeps beforeSha bytes', async () => {
    const { workspaceRoot, store, router } = await createHarness();
    const relativePath = 'gone.txt';
    const bytes = new TextEncoder().encode('remove-me\n');
    await writeFile(join(workspaceRoot, relativePath), bytes);

    const result = await executeWrite(router, { path: relativePath }, 'delete_file');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain(`Deleted ${join(workspaceRoot, relativePath)}`);
    }

    const actions = store.listFileActionsByRun('run-1');
    expect(actions).toHaveLength(1);
    const action = actions[0];
    if (!action) {
      throw new Error('expected a file_action row');
    }
    expect(action.afterExists).toBe(false);
    expect(action.afterSha).toBeNull();
    expect(action.beforeExists).toBe(true);
    if (action.beforeSha === null) {
      throw new Error('expected beforeSha');
    }
    expect(await store.getObject(action.beforeSha)).toEqual(bytes);
    await expect(stat(join(workspaceRoot, relativePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('timeout is not capture end: delayed write_file still records afterSha', async () => {
    const { workspaceRoot, store, tracker, tools, router } = await createHarness();
    const writeFileTool = requireTool(tools, 'write_file');
    const originalExecute = writeFileTool.execute;
    writeFileTool.executionSpec = { maxDurationMs: 40 };
    writeFileTool.execute = async (args, signal, context) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 120);
      });
      return originalExecute(args, signal, context);
    };

    const started = Date.now();
    const result = await executeWrite(router, { path: 'slow.txt', content: 'after-timeout\n' });
    expect(Date.now() - started).toBeLessThan(120);
    expect(result).toMatchObject({
      ok: false,
      code: 'execution-failed',
      details: { reason: 'timeout' },
    });
    expect(tracker.pendingCount()).toBeGreaterThan(0);

    await tracker.waitIdle();
    const actions = store.listFileActionsByRun('run-1');
    expect(actions).toHaveLength(1);
    const action = actions[0];
    if (!action || action.afterSha === null) {
      throw new Error('expected afterSha from the delayed write');
    }
    expect(await store.getObject(action.afterSha)).toEqual(new TextEncoder().encode('after-timeout\n'));
    expect(await readFile(join(workspaceRoot, 'slow.txt'), 'utf8')).toBe('after-timeout\n');
  });

  it('uncontained bash that writes a file does not invent a file_action', async () => {
    const { workspaceRoot, store, router } = await createHarness();
    const result = await executeWrite(
      router,
      { command: 'printf "from-bash\\n" > from-bash.txt' },
      'bash',
    );
    expect(result.ok).toBe(true);
    expect(await readFile(join(workspaceRoot, 'from-bash.txt'), 'utf8')).toBe('from-bash\n');
    expect(store.listFileActionsByRun('run-1')).toEqual([]);
    expect(store.getAttempt('cs-1')?.captureState).toBe('incomplete');
  });

  it('symlink / escape path: writer rejection, zero file_action, target unchanged', async () => {
    const { workspaceRoot, store, router } = await createHarness();
    await writeFile(join(workspaceRoot, 'real.txt'), 'inside\n');
    await symlink(join(workspaceRoot, 'real.txt'), join(workspaceRoot, 'alias.txt'));

    const symlinkResult = await executeWrite(router, {
      path: 'alias.txt',
      content: 'overwrite\n',
    });
    expect(symlinkResult.ok).toBe(false);
    expect((await lstat(join(workspaceRoot, 'alias.txt'))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(workspaceRoot, 'real.txt'), 'utf8')).toBe('inside\n');

    const outside = join(dirname(workspaceRoot), 'piwin-tc-should-not-escape.txt');
    const escapeResult = await executeWrite(router, {
      path: '../piwin-tc-should-not-escape.txt',
      content: 'nope\n',
    });
    expect(escapeResult.ok).toBe(false);
    await expect(stat(outside)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(store.listFileActionsByRun('run-1')).toEqual([]);
  });

  it('does not insert a second file_action for a duplicate unique key', async () => {
    const { store, capture } = await createHarness();
    const put = await store.putObject(new TextEncoder().encode('once\n'));
    const receipt = {
      relativePath: 'dup.txt',
      beforeSha: null as string | null,
      afterSha: put.sha256,
      beforeExists: false,
      afterExists: true,
    };
    const input = {
      runId: 'run-dup',
      toolCallId: 'tool-dup',
      toolName: 'write_file',
      fileEffect: {
        kind: 'exact-paths' as const,
        pathsFromArgs: (args: Record<string, unknown>) => [String(args.path)],
      },
      canonicalArgs: { path: 'dup.txt' },
    };

    const first = capture.beginCapture(input);
    const second = capture.beginCapture(input);
    if (!first || !second) {
      throw new Error('expected captureId');
    }
    capture.recordReceipt({ captureId: first.captureId, receipt });
    capture.recordReceipt({ captureId: second.captureId, receipt });
    await capture.finishCapture({
      captureId: first.captureId,
      result: { ok: true, output: 'Wrote dup.txt' },
    });
    await capture.finishCapture({
      captureId: second.captureId,
      result: { ok: true, output: 'Wrote dup.txt' },
    });

    expect(store.listFileActionsByRun('run-dup')).toHaveLength(1);
  });
});
