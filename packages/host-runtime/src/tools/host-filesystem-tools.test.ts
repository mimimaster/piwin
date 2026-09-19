/**
 * Tests for host-filesystem-tools: verifies the Host-owned fs/bash tools
 * are correctly composed with permission gates.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration, PermissionMode, ToolResult } from '@piwin/contracts';
import { createJobRegistry } from '@piwin/process';
import { buildHostFilesystemTools } from './host-filesystem-tools.js';
import { createWorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';
import { createBundledRuleSet } from '../permission-defaults.js';
import { createHostToolAdmission } from './tool-admission.js';
import { HostToolExecutionRouter } from './host-tool-execution-router.js';

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

async function executeThroughAdmission(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  getPermissionMode: () => PermissionMode = () => 'auto',
  requestPermission?: (input: {
    action: string;
    detail: string;
    defaultDecision: 'allow' | 'ask' | 'deny';
    signal?: AbortSignal;
  }) => Promise<'allow' | 'ask' | 'deny'>,
): Promise<ToolResult> {
  const admission = createHostToolAdmission({
    rules: createBundledRuleSet(),
    getPermissionMode,
    ...(requestPermission ? { requestPermission } : {}),
    projectRoot: '/tmp',
  });
  const router = new HostToolExecutionRouter({ tools: [tool], admission });
  return router.execute(tool.descriptor.name, args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function outputOf(result: ToolResult): string {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
}

function requireTool(tools: HostToolRegistration[], name: string): HostToolRegistration {
  const tool = tools.find((candidate) => candidate.descriptor.name === name);
  if (!tool) throw new Error(`${name} was not registered`);
  return tool;
}

describe('buildHostFilesystemTools', () => {
  it('returns 6 tools: read_file, write_file, delete_file, list_directory, bash, run_bash', () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const names = tools.map((t) => t.descriptor.name).sort();
    expect(names).toEqual([
      'bash',
      'delete_file',
      'list_directory',
      'read_file',
      'run_bash',
      'write_file',
    ]);
  });

  it('declares Host-local fileEffect without copying it onto descriptor', () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const writeFileTool = requireTool(tools, 'write_file');
    const deleteFileTool = requireTool(tools, 'delete_file');
    const readFileTool = requireTool(tools, 'read_file');
    const listTool = requireTool(tools, 'list_directory');
    const bashTool = requireTool(tools, 'bash');
    const runBashTool = requireTool(tools, 'run_bash');

    expect('fileEffect' in writeFileTool.descriptor).toBe(false);
    expect(writeFileTool.fileEffect?.kind).toBe('exact-paths');
    expect(deleteFileTool.fileEffect?.kind).toBe('exact-paths');
    expect(readFileTool.fileEffect).toEqual({ kind: 'none' });
    expect(listTool.fileEffect).toEqual({ kind: 'none' });
    expect(bashTool.fileEffect).toEqual({ kind: 'uncontained' });
    expect(runBashTool.fileEffect).toEqual({ kind: 'uncontained' });
    if (writeFileTool.fileEffect?.kind === 'exact-paths') {
      expect(writeFileTool.fileEffect.pathsFromArgs({ path: '/tmp/a.ts' })).toEqual(['/tmp/a.ts']);
    }
  });

  it('read_file executes without permission gate', async () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const readFileTool = requireTool(tools, 'read_file');

    // Write a temp file then read it
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpPath = join('/tmp', `piwin-test-${Date.now()}.txt`);
    await writeFile(tmpPath, 'hello world', 'utf-8');

    const result = outputOf(await executeTool(readFileTool, { path: tmpPath }));
    expect(result).toBe('hello world');

    // Cleanup
    const { unlink } = await import('node:fs/promises');
    await unlink(tmpPath);
  });

  it('write_file is admitted by the unified Host gate', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({
      cwd: '/tmp',
    });
    const writeFileTool = requireTool(tools, 'write_file');

    const tmpPath = `piwin-test-write-${Date.now()}.txt`;
    const result = outputOf(
      await executeThroughAdmission(
        writeFileTool,
        { path: tmpPath, content: 'test' },
        () => 'auto',
        requestPermission,
      ),
    );
    expect(result).toContain('Wrote');
    expect(requestPermission).not.toHaveBeenCalled();

    // Cleanup
    const { unlink } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    await unlink(resolve('/tmp', tmpPath));
  });

  it('bash is admitted by the unified Host gate', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({
      cwd: '/tmp',
    });
    const bashTool = requireTool(tools, 'bash');

    const result = outputOf(
      await executeThroughAdmission(
        bashTool,
        { command: 'echo hello' },
        () => 'auto',
        requestPermission,
      ),
    );
    expect(result.trim()).toBe('hello');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('routes production bash execution through the Host JobController', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'piwin-managed-bash-'));
    const jobs = createJobRegistry({
      getTrustedProjectRoots: () => [cwd],
      killGraceMs: 50,
    });
    try {
      const tools = buildHostFilesystemTools({ cwd, jobController: jobs });
      const bashTool = requireTool(tools, 'bash');
      const result = outputOf(await executeTool(bashTool, { command: 'printf managed-bash' }));

      expect(result).toBe('managed-bash');
      await expect(jobs.list({ kind: 'command' })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: expect.any(String),
            status: 'exited',
            terminalReason: 'completed',
          }),
        ]),
      );
    } finally {
      await jobs.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('stops the managed bash process group when the command times out', async () => {
    if (process.platform === 'win32') return;

    const cwd = await mkdtemp(join(tmpdir(), 'piwin-managed-bash-timeout-'));
    const jobs = createJobRegistry({
      getTrustedProjectRoots: () => [cwd],
      killGraceMs: 50,
    });
    try {
      const tools = buildHostFilesystemTools({ cwd, jobController: jobs });
      const bashTool = requireTool(tools, 'bash');
      const result = await executeTool(bashTool, { command: 'sleep 5', timeout: 50 });

      expect(result).toMatchObject({ ok: false, code: 'execution-failed' });
      await expect(jobs.list({ kind: 'command' })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'cancelled', terminalReason: 'user-stop' }),
        ]),
      );
    } finally {
      await jobs.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects write_file with an empty path before prompting', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const writeFileTool = requireTool(tools, 'write_file');
    await expect(
      executeThroughAdmission(
        writeFileTool,
        { path: '   ', content: 'x' },
        () => 'auto',
        requestPermission,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-input' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('bash denies destructive commands without permission gate', async () => {
    const tools = buildHostFilesystemTools({
      cwd: '/tmp',
    });
    const bashTool = requireTool(tools, 'bash');

    // rm -rf / is denied by bundled rules (hard deny)
    await expect(executeThroughAdmission(bashTool, { command: 'rm -rf /' })).resolves.toMatchObject(
      {
        ok: false,
        code: 'permission-denied',
      },
    );
  });

  it('prompts for in-project writes in ask-all mode', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const writeFileTool = requireTool(tools, 'write_file');
    const tmpPath = `piwin-test-ask-write-${Date.now()}.txt`;
    const result = outputOf(
      await executeThroughAdmission(
        writeFileTool,
        { path: tmpPath, content: 'ask' },
        () => 'ask-all',
        requestPermission,
      ),
    );
    expect(result).toContain('Wrote');
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file-write' }),
    );
    const { unlink } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    await unlink(resolve('/tmp', tmpPath));
  });

  it('prompts for unmatched bash in ask-all mode', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const bashTool = requireTool(tools, 'bash');
    await expect(
      executeThroughAdmission(
        bashTool,
        { command: 'echo ask-all-prompt' },
        () => 'ask-all',
        requestPermission,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'bash' }),
    );
  });

  it('reads permission mode at execution time', async () => {
    let permissionMode: PermissionMode = 'auto';
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const bashTool = requireTool(tools, 'bash');

    await expect(
      executeThroughAdmission(bashTool, { command: 'echo auto-mode' }),
    ).resolves.toMatchObject({
      ok: true,
    });

    permissionMode = 'ask-all';
    await expect(
      executeThroughAdmission(bashTool, { command: 'echo ask-all-mode' }, () => permissionMode),
    ).resolves.toMatchObject({
      ok: false,
      code: 'permission-denied',
    });
  });

  it('list_directory returns entries with kind', async () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const listTool = requireTool(tools, 'list_directory');

    const result = outputOf(await executeTool(listTool, { path: '/tmp' }));
    const entries = JSON.parse(result);
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries) {
      expect(entry.kind).toMatch(/^(file|directory)$/);
    }
  });

  it('waits to write_file until an exclusive workspace lease is released', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'piwin-fs-busy-'));
    const gate = createWorkspaceWriteGate();
    const held = await gate.tryAcquire({
      workspaceId: 'ws-fs',
      rootPath: cwd,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    expect(held.ok).toBe(true);
    const tools = buildHostFilesystemTools({
      cwd,
      workspaceWrite: { gate, workspaceId: 'ws-fs', rootPath: cwd },
    });
    const writeTool = requireTool(tools, 'write_file');
    const target = join(cwd, 'blocked.txt');
    let finished = false;
    const pending = executeTool(writeTool, { path: target, content: 'yes' }).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(finished).toBe(false);
    if (held.ok) {
      held.lease.release();
    }
    const after = await pending;
    expect(after.ok).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });

  it('writes different files concurrently and serializes the same file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'piwin-fs-parallel-'));
    const gate = createWorkspaceWriteGate();
    const tools = buildHostFilesystemTools({
      cwd,
      workspaceWrite: { gate, workspaceId: 'ws-fs', rootPath: cwd },
    });
    const writeTool = requireTool(tools, 'write_file');
    const [left, right] = await Promise.all([
      executeTool(writeTool, { path: join(cwd, 'a.ts'), content: 'a' }),
      executeTool(writeTool, { path: join(cwd, 'b.ts'), content: 'b' }),
    ]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);

    const first = await executeTool(writeTool, { path: join(cwd, 'same.ts'), content: 'one' });
    const second = await executeTool(writeTool, { path: join(cwd, 'same.ts'), content: 'two' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });
});
