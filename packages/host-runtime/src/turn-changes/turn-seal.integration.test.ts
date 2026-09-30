/**
 * End to end over production pieces: Host file tools and shell with the
 * capture port and write gate, the coordinator, the sealer, and the
 * turn-change commands, in a real git workspace.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  HostCommand,
  HostPush,
  HostResponse,
  HostToolRegistration,
  TurnChangeCheck,
  TurnChangeFileDiff,
  TurnChangeFilePage,
  TurnChangeSummary,
} from '@piwin/contracts';
import type { HostCommandContext } from '../commands/host-command-context.js';
import { handleTurnChangeCommand } from '../commands/turn-change-commands.js';
import { buildHostFilesystemTools } from '../tools/host-filesystem-tools.js';
import { HostToolExecutionRouter } from '../tools/host-tool-execution-router.js';
import { createPermissiveToolAdmission } from '../tools/tool-admission.js';
import { resetWorkspaceFingerprintCooldownsForTests } from '../tools/workspace-fingerprint.js';
import {
  openTurnChangeRuntime,
  recoverTurnChangeRuntimeAtStartup,
  type TurnChangeRuntime,
} from './runtime-wiring.js';
import { createCommandChangeCapturer } from './command-capture.js';
import { bindCaptureReceipts, bindCaptureShellAudit } from './tool-capture.js';
import {
  commitTurnChangeModelNotice,
  readTurnChangeModelNotice,
} from './turn-change-model-notice.js';

let root: string;
let storeDir: string;
let runtime: TurnChangeRuntime;
let tools: HostToolRegistration[];
let router: HostToolExecutionRouter;
let pushes: HostPush[];
let callSeq = 0;

function openRuntime(storageBudgetBytes?: number): void {
  runtime = openTurnChangeRuntime({
    hostInstanceId: 'host-test',
    ...(storageBudgetBytes !== undefined ? { storageBudgetBytes } : {}),
    rootDir: storeDir,
    push: (message) => pushes.push(message),
  });
  tools = buildHostFilesystemTools({
    cwd: root,
    turnChange: {
      workspaceRoot: root,
      store: runtime.objectStore,
      onReceipt: bindCaptureReceipts(runtime.capture, root),
      onShellAudit: bindCaptureShellAudit(runtime.capture),
      commandCapture: runtime.commandCapture,
    },
    workspaceWrite: { gate: runtime.gate, workspaceId: root, rootPath: root },
  });
  router = new HostToolExecutionRouter({
    tools,
    admission: createPermissiveToolAdmission(),
    capture: runtime.capture,
    tracker: runtime.tracker,
  });
}

/** Tools whose commands cannot be imaged, so changed files stay listed by path. */
function useToolsWithoutCommandImages(): void {
  tools = buildHostFilesystemTools({
    cwd: root,
    turnChange: {
      workspaceRoot: root,
      store: runtime.objectStore,
      onReceipt: bindCaptureReceipts(runtime.capture, root),
      onShellAudit: bindCaptureShellAudit(runtime.capture),
      commandCapture: createCommandChangeCapturer({
        store: runtime.objectStore,
        limits: { maxCapturedPaths: 0 },
      }),
    },
    workspaceWrite: { gate: runtime.gate, workspaceId: root, rootPath: root },
  });
  router = new HostToolExecutionRouter({
    tools,
    admission: createPermissiveToolAdmission(),
    capture: runtime.capture,
    tracker: runtime.tracker,
  });
}

async function tool(
  runId: string,
  name: string,
  args: Record<string, unknown>,
  sessionId = 'session-1',
): Promise<void> {
  callSeq += 1;
  const result = await router.execute(name, args, new AbortController().signal, {
    sessionId,
    runtimeGenerationId: 'generation-1',
    runId,
    toolCallId: `call-${String(callSeq)}`,
    toolName: name,
  });
  if (!result.ok) throw new Error(`${name} failed: ${result.message}`);
}

/** One turn segment: begin, run the tools, end, seal. */
async function turn(
  runId: string,
  body: (runId: string) => Promise<void>,
  source: 'prompt' | 'resume' = 'prompt',
): Promise<TurnChangeSummary> {
  runtime.coordinator.beginAttempt({
    sessionId: 'session-1',
    userMessageId: `user-${runId}`,
    runId,
    source,
    workspaceRoot: root,
  });
  await body(runId);
  runtime.coordinator.endRunSegment(runId);
  const summary = await runtime.sealer.onRunEnded(runId);
  if (!summary) throw new Error('expected a sealed summary');
  return summary;
}

async function command(cmd: HostCommand, lockWaitMs?: number): Promise<HostResponse> {
  callSeq += 1;
  // Each client request has its own id; undo/redo idempotency keys on it.
  const response = await handleTurnChangeCommand(cmd, `req-${String(callSeq)}`, {
    turnChangeRuntime: runtime,
    ...(lockWaitMs !== undefined ? { turnChangeLockWaitMs: lockWaitMs } : {}),
  } as HostCommandContext);
  if (!response) throw new Error('not a turn-change command');
  return response;
}

async function data<T>(cmd: HostCommand): Promise<T> {
  const response = await command(cmd);
  if (!response.success) throw new Error(`${cmd.type}: ${response.error}`);
  return response.data as T;
}

const read = (path: string): Promise<string> => readFile(join(root, path), 'utf8');

describe('turn sealing and undo (production shape)', () => {
  beforeEach(async () => {
    resetWorkspaceFingerprintCooldownsForTests();
    root = await mkdtemp(join(tmpdir(), 'piwin-seal-ws-'));
    storeDir = await mkdtemp(join(tmpdir(), 'piwin-seal-store-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
    pushes = [];
    openRuntime();
  });

  afterEach(async () => {
    runtime.close();
    await rm(root, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  });

  it('keeps a turn undoable when its commands only read, then undoes and redoes it', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'bash', { command: 'cat a.txt && git status --short' });
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'two', newText: 'TWO' }] });
      await tool(runId, 'write_file', { path: 'new.md', content: 'x\ny\n' });
    });
    expect(summary).toMatchObject({
      captureState: 'ready',
      coverageComplete: true,
      revision: 1,
      fileCount: 2,
      additions: 3,
      deletions: 1,
      undo: { allowed: true },
      excludedPaths: [],
      incompleteReason: null,
    });
    expect(pushes.filter((push) => push.type === 'turn-changes/updated')).toHaveLength(1);

    const listed = await data<{ summaries: TurnChangeSummary[] }>({
      type: 'turn-changes/list-by-runs',
      sessionId: 'session-1',
      runIds: ['run-1'],
    });
    expect(listed.summaries.map((item) => item.changeSetId)).toEqual([summary.changeSetId]);

    const page = await data<TurnChangeFilePage>({
      type: 'turn-changes/files',
      changeSetId: summary.changeSetId,
      revision: 1,
    });
    const aFile = page.files.find((file) => file.relativePath === 'a.txt');
    expect(aFile).toMatchObject({ kind: 'modified', additions: 1, deletions: 1 });
    expect(page.files.find((file) => file.relativePath === 'new.md')).toMatchObject({ kind: 'added' });
    const diff = await data<TurnChangeFileDiff>({
      type: 'turn-changes/diff',
      changeSetId: summary.changeSetId,
      revision: 1,
      fileId: aFile?.fileId ?? '',
    });
    expect(diff.patch).toContain('-two');
    expect(diff.patch).toContain('+TWO');

    const undo = await data<{ status: string }>({
      type: 'turn-changes/undo',
      changeSetId: summary.changeSetId,
      expectedRevision: 1,
    });
    expect(undo.status).toBe('succeeded');
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    await expect(read('new.md')).rejects.toMatchObject({ code: 'ENOENT' });
    const afterUndo = pushes.filter((push) => push.type === 'turn-changes/updated').pop();
    expect(afterUndo).toMatchObject({
      summary: { disposition: 'undone', redo: { allowed: true }, undo: { allowed: false } },
    });

    const redo = await data<{ status: string }>({
      type: 'turn-changes/redo',
      changeSetId: summary.changeSetId,
      expectedRevision: 1,
    });
    expect(redo.status).toBe('succeeded');
    expect(await read('a.txt')).toBe('one\nTWO\nthree\n');
    expect(await read('new.md')).toBe('x\ny\n');
  });

  it('undoes files a command generated together with the turn’s edits', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      await tool(runId, 'bash', { command: 'printf generated > gen.txt' });
    });
    expect(summary).toMatchObject({
      captureState: 'ready',
      undo: { allowed: true },
      fileCount: 2,
      excludedPaths: [],
      incompleteReason: null,
    });
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    await expect(read('gen.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    await data({ type: 'turn-changes/redo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('gen.txt')).toBe('generated');
  });

  it('undoes a turn that only changed files through commands', async () => {
    await writeFile(join(root, 'wip.txt'), 'uncommitted work\n');
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'bash', { command: "sed -i.bak 's/two/TWO/' a.txt && rm a.txt.bak" });
      await tool(runId, 'bash', { command: 'printf "%s\\n" "more" >> wip.txt' });
    });
    expect(summary).toMatchObject({ captureState: 'ready', undo: { allowed: true }, fileCount: 2 });
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    // The file was dirty before the command: undo restores that, not HEAD.
    expect(await read('wip.txt')).toBe('uncommitted work\n');
  });

  it('keeps a turn undoable when a command changed a file the turn also edited', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      await tool(runId, 'bash', { command: 'printf "\\nappended" >> a.txt' });
    });
    expect(summary).toMatchObject({
      captureState: 'ready',
      coverageComplete: true,
      incompleteReason: null,
      overlappingPaths: [],
      undo: { allowed: true },
    });
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
  });

  it('does not count a commit of the turn’s own edits as a change', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      await tool(runId, 'bash', { command: 'git add -A && git commit -qm "edit a"' });
    });
    expect(summary).toMatchObject({ captureState: 'ready', fileCount: 1, incompleteReason: null });
  });

  it('does not image what a command that moves HEAD or the index did', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      await tool(runId, 'bash', { command: 'git checkout -- a.txt' });
    });
    expect(summary).toMatchObject({
      captureState: 'incomplete',
      incompleteReason: 'command-overlap',
      overlappingPaths: ['a.txt'],
      undo: { allowed: false, reason: 'capture-incomplete' },
    });
  });

  it('still leaves files a command changed out of the undo when they cannot be imaged', async () => {
    useToolsWithoutCommandImages();
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      await tool(runId, 'bash', { command: 'printf generated > gen.txt' });
    });
    expect(summary).toMatchObject({
      captureState: 'ready',
      undo: { allowed: true },
      excludedPaths: ['gen.txt'],
    });
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    expect(await read('gen.txt')).toBe('generated');
  });

  it('refuses a turn whose un-imaged command changed a file the turn also edited', async () => {
    useToolsWithoutCommandImages();
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      await tool(runId, 'bash', { command: 'printf "\\nappended" >> a.txt' });
    });
    expect(summary).toMatchObject({
      captureState: 'incomplete',
      coverageComplete: false,
      incompleteReason: 'command-overlap',
      overlappingPaths: ['a.txt'],
      undo: { allowed: false, reason: 'capture-incomplete' },
    });
    const refused = await command({
      type: 'turn-changes/undo',
      changeSetId: summary.changeSetId,
      expectedRevision: 1,
    });
    expect(refused).toMatchObject({ success: false });
    expect(await read('a.txt')).toBe('ONE\ntwo\nthree\n\nappended');
  });

  it('undoes a file split done with move_lines and move_file', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'move_lines', {
        from: 'a.txt',
        startLine: 2,
        endLine: 3,
        startText: 'two',
        endText: 'three',
        to: 'tail.txt',
        prefix: '# tail\n',
        replacement: 'see tail.txt',
      });
      await tool(runId, 'move_file', { from: 'tail.txt', to: 'parts/tail.txt' });
    });
    expect(await read('a.txt')).toBe('one\nsee tail.txt\n');
    expect(await read('parts/tail.txt')).toBe('# tail\ntwo\nthree\n');
    // tail.txt was created and moved inside the turn: it nets out; two files remain.
    expect(summary).toMatchObject({ captureState: 'ready', undo: { allowed: true }, fileCount: 2 });
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    await expect(read('parts/tail.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(read('tail.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    await data({ type: 'turn-changes/redo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\nsee tail.txt\n');
    expect(await read('parts/tail.txt')).toBe('# tail\ntwo\nthree\n');
  });

  it('records a rename of a tracked file as a delete and an add, and undoes both', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'move_file', { from: 'a.txt', to: 'renamed.txt' });
    });
    expect(summary).toMatchObject({ captureState: 'ready', fileCount: 2, undo: { allowed: true } });
    const page = await data<TurnChangeFilePage>({
      type: 'turn-changes/files',
      changeSetId: summary.changeSetId,
      revision: 1,
    });
    expect(page.files.map((file) => [file.relativePath, file.kind]).sort()).toEqual([
      ['a.txt', 'deleted'],
      ['renamed.txt', 'added'],
    ]);
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    await expect(read('renamed.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  describe('files only commands created that changed after the turn', () => {
    async function summaryOf(runId: string): Promise<TurnChangeSummary> {
      const listed = await data<{ summaries: TurnChangeSummary[] }>({
        type: 'turn-changes/list-by-runs',
        sessionId: 'session-1',
        runIds: [runId],
      });
      const found = listed.summaries[0];
      if (!found) throw new Error('expected a summary');
      return found;
    }

    it('undoes the rest, leaves that file in place, and redo leaves it alone too', async () => {
      const summary = await turn('run-1', async (runId) => {
        await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
        await tool(runId, 'bash', { command: 'printf "gen\\n" > gen.log' });
      });
      expect(summary).toMatchObject({ fileCount: 2, undo: { allowed: true } });
      // A watcher keeps writing the generated file after the turn ended.
      await writeFile(join(root, 'gen.log'), 'gen\nlater\n');

      const check = await data<TurnChangeCheck>({
        type: 'turn-changes/check',
        changeSetId: summary.changeSetId,
        revision: 1,
        direction: 'undo',
      });
      expect(check.availability).toEqual({ allowed: true });

      const undo = await data<{ status: string; skippedPaths?: string[] }>({
        type: 'turn-changes/undo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(undo).toMatchObject({ status: 'succeeded', skippedPaths: ['gen.log'] });
      expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
      expect(await read('gen.log')).toBe('gen\nlater\n');
      expect(await summaryOf('run-1')).toMatchObject({
        disposition: 'undone',
        leftInPlacePaths: ['gen.log'],
        redo: { allowed: true },
      });

      // The undo never reverted gen.log, so redo must not try to rewrite it.
      const redo = await data<{ status: string }>({
        type: 'turn-changes/redo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(redo.status).toBe('succeeded');
      expect(await read('a.txt')).toBe('ONE\ntwo\nthree\n');
      expect(await read('gen.log')).toBe('gen\nlater\n');
      expect(await summaryOf('run-1')).toMatchObject({ disposition: 'applied', leftInPlacePaths: [] });
    });

    it('does not report a generated file that is already gone', async () => {
      const summary = await turn('run-1', async (runId) => {
        await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
        await tool(runId, 'bash', { command: 'printf gen > gen.log' });
      });
      await rm(join(root, 'gen.log'));
      const undo = await data<{ status: string; skippedPaths?: string[] }>({
        type: 'turn-changes/undo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(undo.status).toBe('succeeded');
      expect(undo.skippedPaths).toBeUndefined();
      expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
      expect(await summaryOf('run-1')).toMatchObject({ leftInPlacePaths: [] });
    });

    it('refuses when nothing but such files is left to undo', async () => {
      const summary = await turn('run-1', async (runId) => {
        await tool(runId, 'bash', { command: 'printf gen > gen.log' });
      });
      await writeFile(join(root, 'gen.log'), 'moved on');
      const refused = await data<{ status: string; reason?: string; affectedPaths?: string[] }>({
        type: 'turn-changes/undo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(refused).toMatchObject({ status: 'rejected', reason: 'files-changed', affectedPaths: ['gen.log'] });
      expect(await read('gen.log')).toBe('moved on');
    });

    it('stays strict for a file a Host tool wrote, and for a file a command modified', async () => {
      const summary = await turn('run-1', async (runId) => {
        await tool(runId, 'write_file', { path: 'made.md', content: 'written\n' });
        await tool(runId, 'bash', { command: 'printf "\\nmore" >> a.txt' });
      });
      await writeFile(join(root, 'made.md'), 'written\nlater\n');
      const hostWritten = await data<{ status: string; affectedPaths?: string[] }>({
        type: 'turn-changes/undo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(hostWritten).toMatchObject({ status: 'rejected', affectedPaths: ['made.md'] });

      await writeFile(join(root, 'made.md'), 'written\n');
      await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\nmore\nlater\n');
      const commandModified = await data<{ status: string; affectedPaths?: string[] }>({
        type: 'turn-changes/undo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(commandModified).toMatchObject({ status: 'rejected', affectedPaths: ['a.txt'] });
    });
  });

  it('seals a turn without file changes as no-changes', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'bash', { command: 'ls' });
    });
    expect(summary).toMatchObject({
      captureState: 'ready',
      fileCount: 0,
      undo: { allowed: false, reason: 'no-changes' },
    });
  });

  it('names the later turn that changed a blocked file and diffs against the file now', async () => {
    const first = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'two', newText: 'TWO' }] });
    });
    const second = await turn('run-2', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'three', newText: 'THREE' }] });
    });
    const undo = await data<{ reason?: string; conflicts?: unknown }>({
      type: 'turn-changes/undo',
      changeSetId: first.changeSetId,
      expectedRevision: 1,
    });
    expect(undo).toMatchObject({
      reason: 'files-changed',
      conflicts: [
        {
          relativePath: 'a.txt',
          laterTurns: [{ changeSetId: second.changeSetId, sessionId: 'session-1', runIds: ['run-2'] }],
        },
      ],
    });

    const page = await data<TurnChangeFilePage>({ type: 'turn-changes/files', changeSetId: first.changeSetId, revision: 1 });
    const fileId = page.files[0]?.fileId ?? '';
    const current = await data<TurnChangeFileDiff>({
      type: 'turn-changes/diff',
      changeSetId: first.changeSetId,
      revision: 1,
      fileId,
      against: 'current',
    });
    expect(current.against).toBe('current');
    expect(current.patch).toContain('-three');
    expect(current.patch).toContain('+THREE');
    expect(current.patch).not.toContain('+TWO');
    // The sealed diff is unchanged by what happened later.
    const sealed = await data<TurnChangeFileDiff>({ type: 'turn-changes/diff', changeSetId: first.changeSetId, revision: 1, fileId });
    expect(sealed.patch).toContain('+TWO');
  });

  it('pushes per-file progress ending at done == total', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'write_file', { path: 'p1.md', content: '1\n' });
      await tool(runId, 'write_file', { path: 'p2.md', content: '2\n' });
      await tool(runId, 'write_file', { path: 'p3.md', content: '3\n' });
    });
    pushes = [];
    const response = await handleTurnChangeCommand(
      { type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 },
      'undo-progress',
      { turnChangeRuntime: runtime, push: (message: HostPush) => pushes.push(message) } as unknown as HostCommandContext,
    );
    expect(response).toMatchObject({ success: true, data: { status: 'succeeded' } });
    const progress = pushes.flatMap((push) =>
      push.type === 'turn-changes/operation-updated' && push.progress ? [push.progress] : [],
    );
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 });
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]?.done).toBeGreaterThan(progress[index - 1]?.done ?? 0);
    }
  });

  it('reports and refuses when another session changed the file afterwards', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'two', newText: 'TWO' }] });
    });
    await writeFile(join(root, 'a.txt'), 'one\nTWO\nthree\nlater\n');
    const check = await data<TurnChangeCheck>({
      type: 'turn-changes/check',
      changeSetId: summary.changeSetId,
      revision: 1,
      direction: 'undo',
    });
    expect(check.availability).toEqual({
      allowed: false,
      reason: 'files-changed',
      affectedPaths: ['a.txt'],
      // Written outside any recorded turn: the source is unknown, not guessed.
      conflicts: [{ relativePath: 'a.txt', laterTurns: [] }],
    });
    const undo = await data<{ status: string; reason?: string; affectedPaths?: string[] }>({
      type: 'turn-changes/undo',
      changeSetId: summary.changeSetId,
      expectedRevision: 1,
    });
    expect(undo).toMatchObject({ status: 'rejected', reason: 'files-changed', affectedPaths: ['a.txt'] });
    expect(await read('a.txt')).toBe('one\nTWO\nthree\nlater\n');
  });

  it('refuses undo while a resumed turn is recording, then seals both segments together', async () => {
    const first = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    runtime.coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'user-run-1',
      runId: 'run-2',
      source: 'resume',
      workspaceRoot: root,
    });
    const pending = await command({
      type: 'turn-changes/undo',
      changeSetId: first.changeSetId,
      expectedRevision: 1,
    });
    expect(pending).toMatchObject({ success: false, error: 'capture-pending' });
    await tool('run-2', 'edit', { path: 'a.txt', edits: [{ oldText: 'three', newText: 'THREE' }] });
    runtime.coordinator.endRunSegment('run-2');
    const second = await runtime.sealer.onRunEnded('run-2');
    expect(second).toMatchObject({
      changeSetId: first.changeSetId,
      revision: 2,
      runIds: ['run-1', 'run-2'],
      additions: 2,
      deletions: 2,
      undo: { allowed: true },
    });
    await data({ type: 'turn-changes/undo', changeSetId: first.changeSetId, expectedRevision: 2 });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
  });

  it('starts a new change set when an undone turn is resumed', async () => {
    const first = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    await data({ type: 'turn-changes/undo', changeSetId: first.changeSetId, expectedRevision: 1 });
    const resumed = await turn(
      'run-2',
      async (runId) => {
        await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'two', newText: 'TWO' }] });
      },
      'resume',
    );
    expect(resumed.changeSetId).not.toBe(first.changeSetId);
    expect(resumed).toMatchObject({ revision: 1, fileCount: 1, undo: { allowed: true } });
    const listed = await data<{ summaries: TurnChangeSummary[] }>({
      type: 'turn-changes/list-by-runs',
      sessionId: 'session-1',
      runIds: ['run-1'],
    });
    expect(listed.summaries[0]).toMatchObject({ disposition: 'undone', redo: { allowed: true } });
  });

  it('closes segments a crashed Host left open and seals them on first read', async () => {
    runtime.coordinator.beginAttempt({
      sessionId: 'session-1',
      userMessageId: 'user-run-1',
      runId: 'run-1',
      source: 'prompt',
      workspaceRoot: root,
    });
    await tool('run-1', 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    runtime.close(); // the Host dies mid-turn

    openRuntime();
    const recovery = await recoverTurnChangeRuntimeAtStartup(runtime);
    expect(recovery.orphanedRunIds).toEqual(['run-1']);
    const listed = await data<{ summaries: TurnChangeSummary[] }>({
      type: 'turn-changes/list-by-runs',
      sessionId: 'session-1',
      runIds: ['run-1'],
    });
    expect(listed.summaries[0]).toMatchObject({
      captureState: 'ready',
      fileCount: 1,
      undo: { allowed: true },
    });
  });

  it("does not count another session's edit during a command as the command's change", async () => {
    await writeFile(join(root, 'b.txt'), 'b\n');
    const summary = await turn('run-1', async (runId) => {
      const running = tool(runId, 'bash', { command: 'sleep 0.4; cat a.txt' });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await tool('run-other', 'edit', { path: 'b.txt', edits: [{ oldText: 'b', newText: 'B' }] }, 'session-2');
      await running;
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    expect(summary).toMatchObject({
      captureState: 'ready',
      excludedPaths: [],
      fileCount: 1,
      undo: { allowed: true },
    });
  });

  it('aligns a turn begun under the wrong root to where the tools actually wrote', async () => {
    // A resumed session can start its turn before its project path is known;
    // the turn then begins under the General workspace.
    const wrongRoot = await mkdtemp(join(tmpdir(), 'piwin-seal-general-'));
    try {
      runtime.coordinator.beginAttempt({
        sessionId: 'session-1',
        userMessageId: 'user-run-1',
        runId: 'run-1',
        source: 'prompt',
        workspaceRoot: wrongRoot,
      });
      await tool('run-1', 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
      runtime.coordinator.endRunSegment('run-1');
      const summary = await runtime.sealer.onRunEnded('run-1');
      expect(summary).toMatchObject({ captureState: 'ready', undo: { allowed: true } });
      const undo = await data<{ status: string }>({
        type: 'turn-changes/undo',
        changeSetId: summary?.changeSetId ?? '',
        expectedRevision: 1,
      });
      expect(undo.status).toBe('succeeded');
      expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    } finally {
      await rm(wrongRoot, { recursive: true, force: true });
    }
  });

  it("undoes while another session's command runs, and still yields to repo-wide operations", async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    const rootPath = root;
    // Another session's long test holds the shared shell lease.
    const test = await runtime.gate.tryAcquire({
      workspaceId: rootPath,
      rootPath,
      kind: 'shell',
      mode: 'shared',
      wait: true,
      ownerId: 'session-2',
    });
    if (!test.ok) throw new Error('expected shell lease');
    try {
      const undo = await data<{ status: string }>({
        type: 'turn-changes/undo',
        changeSetId: summary.changeSetId,
        expectedRevision: 1,
      });
      expect(undo.status).toBe('succeeded');
      expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    } finally {
      test.lease.release();
    }

    // A checkout-style exclusive holder still keeps undo/redo out.
    const checkout = await runtime.gate.tryAcquire({
      workspaceId: rootPath,
      rootPath,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    if (!checkout.ok) throw new Error('expected exclusive lease');
    try {
      const busy = await command(
        { type: 'turn-changes/redo', changeSetId: summary.changeSetId, expectedRevision: 1 },
        50,
      );
      expect(busy).toMatchObject({ success: false, error: 'workspace-busy' });
      expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
    } finally {
      checkout.lease.release();
    }
  });

  it('waits out a write in flight on one of its files instead of failing', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    const fileKey = join(realpathSync(root), 'a.txt');
    const writing = await runtime.gate.tryAcquire({
      workspaceId: root,
      rootPath: root,
      kind: 'tool',
      mode: 'shared',
      wait: true,
      paths: [fileKey],
      ownerId: 'session-2',
    });
    if (!writing.ok) throw new Error('expected file lease');
    let settled = false;
    const pending = data<{ status: string }>({
      type: 'turn-changes/undo',
      changeSetId: summary.changeSetId,
      expectedRevision: 1,
    }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(settled).toBe(false);
    writing.lease.release();
    expect((await pending).status).toBe('succeeded');
  });

  it('tells the model after an undo, once, using the root capture recorded', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    expect(readTurnChangeModelNotice({ store: runtime.store, sessionId: 'session-1', workspaceRoot: root })).toBeUndefined();
    await data({ type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: 1 });

    const notice = readTurnChangeModelNotice({ store: runtime.store, sessionId: 'session-1', workspaceRoot: root });
    expect(notice?.text).toContain('a.txt');
    if (notice) commitTurnChangeModelNotice(runtime.store, 'session-1', notice);
    expect(readTurnChangeModelNotice({ store: runtime.store, sessionId: 'session-1', workspaceRoot: root })).toBeUndefined();

    // A redo is its own operation and gets its own note.
    await data({ type: 'turn-changes/redo', changeSetId: summary.changeSetId, expectedRevision: 1 });
    expect(
      readTurnChangeModelNotice({ store: runtime.store, sessionId: 'session-1', workspaceRoot: root })?.text,
    ).toContain('restored (redo)');
  });

  it('counts a session’s undoable turns that outlive a session delete', async () => {
    await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    await turn('run-2', async () => undefined);
    // One turn with file changes; the read-only one does not count.
    expect(runtime.store.countSessionChangeSets('session-1')).toBe(1);
    expect(runtime.store.countSessionChangeSets('session-other')).toBe(0);
  });

  it('keeps working but marks the turn storage-full when undo data is over budget', async () => {
    runtime.close();
    openRuntime(1);
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    expect(await read('a.txt')).toBe('ONE\ntwo\nthree\n');
    expect(summary).toMatchObject({
      captureState: 'incomplete',
      incompleteReason: 'storage-full',
      undo: { allowed: false, reason: 'capture-incomplete' },
    });
  });

  it('exports an undo backup outside the workspace', async () => {
    const summary = await turn('run-1', async (runId) => {
      await tool(runId, 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] });
    });
    const undo = await data<{ operationId: string }>({
      type: 'turn-changes/undo',
      changeSetId: summary.changeSetId,
      expectedRevision: 1,
    });
    const outside = await mkdtemp(join(tmpdir(), 'piwin-seal-export-'));
    try {
      const exported = await data<{ destination: string; exportedPaths: string[] }>({
        type: 'turn-changes/export-backup',
        operationId: undo.operationId,
        destination: outside,
      });
      expect(exported.exportedPaths).toEqual(['a.txt']);
      // The backup is what the file held before the undo: the turn's result.
      expect(await readFile(join(exported.destination, 'a.txt'), 'utf8')).toBe('ONE\ntwo\nthree\n');
      const inside = await command({
        type: 'turn-changes/export-backup',
        operationId: undo.operationId,
        destination: root,
      });
      expect(inside).toMatchObject({ success: false, problem: { code: 'destination-inside-workspace' } });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
