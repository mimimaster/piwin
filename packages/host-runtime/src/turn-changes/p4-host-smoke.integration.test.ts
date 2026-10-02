/** Real HostRuntime + Git + filesystem; only the model backend is mocked. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import type { HostCommand, HostPush, TurnChangeBackupExport, TurnChangeSummary } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { HostToolExecutionRouter } from '../tools/host-tool-execution-router.js';
import { openTurnChangeRuntime } from './runtime-wiring.js';

it('P4 isolated Host: staged refusal, model notice, backup export and repair guard', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'piwin-p4-host-'));
  // Match deployment: user code/export live outside the protected product root.
  const piwinRoot = join(testRoot, 'host');
  const projectPath = join(testRoot, 'project');
  const destination = join(testRoot, 'export');
  await mkdir(piwinRoot);
  await mkdir(projectPath);
  await mkdir(destination);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: projectPath, encoding: 'utf8' });
  git('init', '-q');
  await writeFile(join(projectPath, 'a.txt'), 'before\n');
  git('add', '.');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  const pushes: HostPush[] = [];
  const host = new HostRuntime({
    mode: 'sdk', mock: true, piwinRoot, permissionModeOverride: 'bypass',
    onPush: (push) => pushes.push(push),
  });
  // Mock model initialization omits the filesystem service. Install the same
  // production runtime under the isolated root, without changing product code.
  host.turnChangeRuntime = openTurnChangeRuntime({
    hostInstanceId: host.hostInstanceId, piwinRoot, push: (push) => host.push(push),
  });
  const data = async <T>(command: HostCommand): Promise<T> => {
    const response = await host.handleCommand(command, { idempotencyKey: crypto.randomUUID() });
    if (!response.success) throw new Error(`${command.type}: ${response.error}`);
    return response.data as T;
  };
  try {
    await data({ type: 'project/open', path: projectPath });
    await data({ type: 'project/trust', path: projectPath });
    const { sessionId } = await data<{ sessionId: string }>({
      type: 'session/create', input: { projectPath, sessionName: 'P4 smoke' },
    });
    const session = await host.ensureLiveSession(sessionId);
    const changes = host.turnChangeRuntime;
    if (!changes) throw new Error('turn-change runtime missing');
    const surface = await host.composeSessionHostToolsForSession(sessionId, 'p4-smoke-generation', undefined, projectPath);
    const router = new HostToolExecutionRouter({
      tools: surface.tools, admission: surface.permissionGate, capture: changes.capture, tracker: changes.tracker,
    });
    const executeEdit = async (oldText: string, newText: string) => {
      const run = host.runRegistry.getForegroundRun(sessionId);
      if (!run) throw new Error('foreground run missing');
      return router.execute('edit', { path: 'a.txt', edits: [{ oldText, newText }] }, new AbortController().signal, {
        sessionId, runtimeGenerationId: 'p4-smoke-generation', runId: run.runId,
        toolCallId: crypto.randomUUID(), toolName: 'edit',
      });
    };
    const originalPrompt = session.prompt.bind(session);
    const prompt = vi.spyOn(session, 'prompt').mockImplementationOnce(async (input) => {
      expect(await executeEdit('before', 'after')).toMatchObject({ ok: true });
      return originalPrompt(input);
    });
    const send = async (text: string): Promise<string> => {
      const { runId } = await data<{ runId: string }>({ type: 'session/prompt', sessionId, input: { text } });
      await vi.waitFor(() => {
        expect(pushes.find((push) => push.type === 'run/terminal' && push.run.runId === runId))
          .toMatchObject({ run: { status: 'completed' } });
      }, { timeout: 10_000 });
      return runId;
    };
    const runId = await send('Change before to after');
    const listed = await data<{ summaries: TurnChangeSummary[] }>({ type: 'turn-changes/list-by-runs', sessionId, runIds: [runId] });
    const summary = listed.summaries[0];
    if (!summary) throw new Error('sealed turn missing');
    expect(summary).toMatchObject({ captureState: 'ready', coverageComplete: true, fileCount: 1 });
    const undoCommand: HostCommand = { type: 'turn-changes/undo', changeSetId: summary.changeSetId, expectedRevision: summary.revision };

    // The index and working file remain byte-identical on refusal.
    git('add', 'a.txt');
    const indexBefore = await readFile(join(projectPath, '.git', 'index'));
    expect(await data(undoCommand)).toMatchObject({ status: 'rejected', reason: 'staged-paths', affectedPaths: ['a.txt'] });
    expect(await readFile(join(projectPath, '.git', 'index'))).toEqual(indexBefore);
    expect(await readFile(join(projectPath, 'a.txt'), 'utf8')).toBe('after\n');
    git('reset', '-q', 'HEAD', '--', 'a.txt');

    const undone = await data<{ operationId: string; status: string }>(undoCommand);
    expect(undone.status).toBe('succeeded');
    expect(await readFile(join(projectPath, 'a.txt'), 'utf8')).toBe('before\n');
    const exported = await data<TurnChangeBackupExport>({
      type: 'turn-changes/export-backup', operationId: undone.operationId, destination,
    });
    expect(exported.exportedPaths).toEqual(['a.txt']);
    expect(await readFile(join(exported.destination, 'a.txt'), 'utf8')).toBe('after\n');
    expect(JSON.parse(await readFile(join(exported.destination, 'manifest.json'), 'utf8')))
      .toMatchObject({ operationId: undone.operationId });
    expect(await readFile(join(projectPath, 'a.txt'), 'utf8')).toBe('before\n');

    // The next actual prompt gets the notice; user transcript does not.
    await send('Continue after undo');
    expect(prompt.mock.calls.at(-1)?.[0].text).toContain('[piwin-turn-changes]');
    expect(prompt.mock.calls.at(-1)?.[0].text).toContain('a.txt');
    expect(prompt.mock.calls.at(-1)?.[0].text).toContain('Re-read these files');
    const messages = await host.loadTranscriptMessages(sessionId);
    expect(messages.find((message) => message.role === 'user' && message.text.includes('Continue after undo'))?.text)
      .not.toContain('[piwin-turn-changes]');
    await send('Notice is delivered once');
    expect(prompt.mock.calls.at(-1)?.[0].text).not.toContain('[piwin-turn-changes]');

    // Persisted failure injection: the undo wrote the file, but failed rollback.
    changes.store.updateOperationStatus(undone.operationId, 'needs-repair');
    prompt.mockImplementationOnce(async (input) => {
      const refused = await executeEdit('before', 'should not write');
      expect(refused).toMatchObject({ ok: false, details: { reason: 'turn-change-needs-repair' } });
      if (!refused.ok) expect(refused.message).toContain(undone.operationId);
      return originalPrompt(input);
    });
    await send('Try edit while repair is needed');
    expect(await readFile(join(projectPath, 'a.txt'), 'utf8')).toBe('before\n');
    const preview = await data<{ confirmationToken: string }>({
      type: 'turn-changes/recovery-preview', operationId: undone.operationId, expectedRevision: summary.revision,
    });
    expect(await data({ type: 'turn-changes/recovery-run', operationId: undone.operationId,
      expectedRevision: summary.revision, confirmationToken: preview.confirmationToken })).toMatchObject({ outcome: 'restored' });
    expect(await data({ type: 'turn-changes/recovery-verify', operationId: undone.operationId,
      expectedRevision: summary.revision })).toMatchObject({ verified: true });
    expect(await readFile(join(projectPath, 'a.txt'), 'utf8')).toBe('after\n');

    await data({ type: 'session/archive', sessionId });
    expect(await data({ type: 'session/delete', sessionId })).toMatchObject({ deleted: true, turnChangeRecordsKept: 1 });
    expect(changes.store.getAttempt(summary.changeSetId)).toBeDefined();
    expect(await readFile(join(exported.destination, 'a.txt'), 'utf8')).toBe('after\n');
  } finally {
    await host.dispose();
    await rm(testRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
}, 30_000);
