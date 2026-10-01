/**
 * Production-shaped check of the optimistic workspace policy: managed bash
 * through the Host JobController, the turn-change object store and receipts,
 * one write gate, two sessions working in the same git checkout at once.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import type { TurnChangeWriteReceipt } from '@piwin/git';
import { createJobRegistry } from '@piwin/process';
import { openTurnChangeRuntime, type TurnChangeRuntime } from '../turn-changes/runtime-wiring.js';
import { buildHostFilesystemTools } from './host-filesystem-tools.js';
import { resetWorkspaceFingerprintCooldownsForTests } from './workspace-fingerprint.js';

let root: string;
let store: string;
let runtime: TurnChangeRuntime;
let jobs: ReturnType<typeof createJobRegistry>;
let tools: HostToolRegistration[];
const receipts: TurnChangeWriteReceipt[] = [];

async function call(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools.find((candidate) => candidate.descriptor.name === name);
  if (!tool) throw new Error(`${name} missing`);
  const signal = new AbortController().signal;
  const context = {
    sessionId,
    runtimeGenerationId: `generation-${sessionId}`,
    runId: `run-${sessionId}`,
    toolName: name,
  };
  // The router prepares arguments (path resolution, edit normalization) first.
  const prepared = tool.prepareArgs ? await tool.prepareArgs(args, context, signal) : { ok: true as const, arguments: args };
  if (!prepared.ok) return prepared.result;
  return tool.execute(prepared.arguments, signal, context);
}

function textOf(result: ToolResult): string {
  return result.ok ? result.output : `${result.code}: ${result.message}`;
}

describe('optimistic workspace policy (production shape)', () => {
  beforeEach(async () => {
    resetWorkspaceFingerprintCooldownsForTests();
    root = await mkdtemp(join(tmpdir(), 'piwin-optimistic-ws-'));
    store = await mkdtemp(join(tmpdir(), 'piwin-optimistic-store-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
    await writeFile(join(root, 'a.txt'), 'top\nmiddle\nbottom\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
    runtime = openTurnChangeRuntime({ hostInstanceId: 'host-test', rootDir: store });
    jobs = createJobRegistry({ getTrustedProjectRoots: () => [root], killGraceMs: 50 });
    receipts.length = 0;
    tools = buildHostFilesystemTools({
      cwd: root,
      jobController: jobs,
      turnChange: {
        workspaceRoot: root,
        store: runtime.objectStore,
        onReceipt: (receipt) => receipts.push(receipt),
      },
      workspaceWrite: { gate: runtime.gate, workspaceId: root, rootPath: root },
    });
  });

  afterEach(async () => {
    await jobs.dispose();
    runtime.close();
    await rm(root, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  });

  it('lets session B read, edit and write while session A runs a long managed command', async () => {
    const long = call('a', 'bash', { command: 'sleep 1.2; cat a.txt' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const startedAt = Date.now();
    const grep = await call('b', 'bash', { command: 'grep -n middle a.txt' });
    const edit = await call('b', 'edit', {
      path: 'a.txt',
      edits: [{ oldText: 'bottom', newText: 'BOTTOM' }],
    });
    const created = await call('b', 'write_file', { path: 'notes.md', content: '# notes\n' });
    const elapsed = Date.now() - startedAt;

    expect(textOf(grep)).toContain('2:middle');
    expect(textOf(edit)).toContain('Successfully replaced 1 block(s)');
    expect(created.ok).toBe(true);
    // None of it queued behind A's 1.2s command.
    expect(elapsed).toBeLessThan(800);
    expect(grep.details?.workspaceWrite?.queuedMs ?? 0).toBeLessThan(100);

    const result = await long;
    expect(result.ok).toBe(true);
    const text = textOf(result);
    expect(text).toContain('[workspace] Other sessions were active');
    expect(text).toMatch(/Written by other sessions: .*a\.txt/);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('top\nmiddle\nBOTTOM\n');

    // Host file tools still produce undo receipts under optimistic shells.
    expect(receipts.map((receipt) => receipt.relativePath).sort()).toEqual(['a.txt', 'notes.md']);
  });

  it('queues a listed repo-wide command until the running shell finishes', async () => {
    const long = call('a', 'bash', { command: 'sleep 0.6; echo done' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const restore = await call('b', 'bash', { command: 'git restore a.txt' });
    expect(restore.ok).toBe(true);
    expect(restore.details?.workspaceWrite).toMatchObject({ lock: 'exclusive' });
    expect(restore.details?.workspaceWrite?.queuedMs ?? 0).toBeGreaterThanOrEqual(300);
    expect(textOf(await long)).toContain('done');
  });

  it('refuses a stale whole-file overwrite but not a targeted edit', async () => {
    expect((await call('a', 'write_file', { path: 'a.txt', content: 'one\ntwo\n' })).ok).toBe(true);
    expect(
      (await call('b', 'edit', { path: 'a.txt', edits: [{ oldText: 'two', newText: 'TWO' }] })).ok,
    ).toBe(true);
    const overwrite = await call('a', 'write_file', { path: 'a.txt', content: 'one\ntwo\nthree\n' });
    expect(overwrite).toMatchObject({ ok: false, details: { reason: 'file-changed-by-other-session' } });
    expect(
      (await call('a', 'edit', { path: 'a.txt', edits: [{ oldText: 'one', newText: 'ONE' }] })).ok,
    ).toBe(true);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('ONE\nTWO\n');
  });

  it("reports each call's own change, not the file's diff against HEAD", async () => {
    // Session A changes the first line; the file now differs from HEAD there.
    expect((await call('a', 'edit', { path: 'a.txt', edits: [{ oldText: 'top', newText: 'TOP' }] })).ok).toBe(true);
    const b = await call('b', 'edit', {
      path: 'a.txt',
      edits: [{ oldText: 'bottom', newText: 'BOTTOM' }],
    });
    expect(b.details?.fileChange).toMatchObject({
      path: 'a.txt',
      status: 'modified',
      additions: 1,
      deletions: 1,
      binary: false,
    });
    const patch = b.details?.fileChange?.patch ?? '';
    expect(patch).toContain('-bottom');
    expect(patch).toContain('+BOTTOM');
    // A's change is context at most, never one of B's added lines.
    expect(patch).not.toContain('+TOP');

    const created = await call('b', 'write_file', { path: 'new.md', content: 'x\ny\n' });
    expect(created.details?.fileChange).toMatchObject({ path: 'new.md', status: 'added', additions: 2, deletions: 0 });
    const removed = await call('b', 'delete_file', { path: 'new.md' });
    expect(removed.details?.fileChange).toMatchObject({ status: 'deleted', additions: 0, deletions: 2 });
    expect(b.details?.workspaceWrite?.executionMs).toBeGreaterThanOrEqual(0);
  });
});
