import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolResult } from '@piwin/contracts';
import { createWorkspaceWriteGate, type WorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';
import { runWithWorkspaceWriteGate, type WorkspaceWriteBinding } from './run-with-workspace-write-gate.js';

let root: string;
let gate: WorkspaceWriteGate;
let binding: WorkspaceWriteBinding;

function writeAs(ownerId: string, text: string, file = 'f.ts'): Promise<ToolResult> {
  const filePath = join(root, file);
  return runWithWorkspaceWriteGate({
    workspaceWrite: binding,
    runId: `run-${ownerId}`,
    ownerId,
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

/** A shell lease held by `ownerId` while `body` runs, as runHostShell does. */
async function shellAs(ownerId: string, body: () => Promise<void>): Promise<void> {
  const acquired = await gate.tryAcquire({
    workspaceId: root,
    rootPath: root,
    kind: 'shell',
    mode: 'shared',
    wait: true,
    ownerId,
  });
  if (!acquired.ok) throw new Error('expected shell lease');
  try {
    await body();
  } finally {
    acquired.lease.release();
  }
}

describe('runWithWorkspaceWriteGate', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gate-write-'));
    gate = createWorkspaceWriteGate();
    binding = { gate, workspaceId: root, rootPath: root };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses once to overwrite a file another session wrote since this session did', async () => {
    expect((await writeAs('a', 'v1')).ok).toBe(true);
    expect((await writeAs('b', 'v2')).ok).toBe(true);

    const refused = await writeAs('a', 'v3');
    expect(refused).toMatchObject({
      ok: false,
      details: { reason: 'file-changed-by-other-session' },
    });
    expect(await readFile(join(root, 'f.ts'), 'utf8')).toBe('v2');

    // After re-reading, a deliberate retry goes through.
    expect((await writeAs('a', 'v3')).ok).toBe(true);
    expect(await readFile(join(root, 'f.ts'), 'utf8')).toBe('v3');
  });

  it("refuses when another session's shell was running while the file moved", async () => {
    expect((await writeAs('a', 'v1')).ok).toBe(true);
    await shellAs('b', () => writeFile(join(root, 'f.ts'), 'formatted by b'));
    expect((await writeAs('a', 'v2')).ok).toBe(false);
  });

  it("allows drift when this session also ran shells while another session only searched", async () => {
    expect((await writeAs('a', 'v1')).ok).toBe(true);
    await shellAs('b', async () => undefined);
    await shellAs('a', () => writeFile(join(root, 'f.ts'), 'formatted by a'));
    expect((await writeAs('a', 'v2')).ok).toBe(true);
  });

  it("allows drift from this session's own shell (formatter, codegen)", async () => {
    expect((await writeAs('a', 'v1')).ok).toBe(true);
    await shellAs('a', () => writeFile(join(root, 'f.ts'), 'formatted by a'));
    expect((await writeAs('a', 'v2')).ok).toBe(true);
  });

  it('does not refuse when another session touched a different file', async () => {
    expect((await writeAs('a', 'v1')).ok).toBe(true);
    expect((await writeAs('b', 'other', 'g.ts')).ok).toBe(true);
    await writeFile(join(root, 'f.ts'), 'edited in an external editor');
    expect((await writeAs('a', 'v2')).ok).toBe(true);
  });

  it('reports queue time separately from the body', async () => {
    const holder = await gate.tryAcquire({
      workspaceId: root,
      rootPath: root,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    if (!holder.ok) throw new Error('expected holder');
    let clock = 1_000;
    const pending = runWithWorkspaceWriteGate({
      workspaceWrite: binding,
      runId: 'run',
      signal: new AbortController().signal,
      mode: 'shared',
      kind: 'shell',
      wait: true,
      now: () => clock,
      run: async () => ({ ok: true, output: 'ran' }),
    });
    clock = 4_500;
    holder.lease.release();
    const result = await pending;
    expect(result.details?.workspaceWrite).toEqual({ lock: 'shared', queuedMs: 3_500 });
  });
});
