import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { handleProjectCommand } from './project-commands.js';
import { handleGitCommand } from './git-commands.js';
import { createRemoteProjectId } from '../remote-project-id.js';
import type { HostCommandContext } from './host-command-context.js';
import { createWorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';

const execFileAsync = promisify(execFile);

describe('git commands projectId', () => {
  it('reads status when projectPath is the Host-issued projectId', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-id-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);
    const projectId = createRemoteProjectId(projectPath);
    const context = { piwinRoot: rootDir } as HostCommandContext;

    const status = await handleGitCommand(
      { type: 'git/status', projectPath: projectId },
      'status-id',
      context,
    );
    expect(status?.success).toBe(true);
    expect(status && 'data' in status ? status.data : null).toMatchObject({
      snapshot: {
        repository: { isRepository: true },
      },
    });
  });

  it('fails git/status for an unknown projectId', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-unknown-'));
    const context = { piwinRoot: rootDir } as HostCommandContext;
    const status = await handleGitCommand(
      { type: 'git/status', projectPath: 'project-aaaaaaaaaaaaaaaaaaaaaaaa' },
      'status-unknown',
      context,
    );
    expect(status).toMatchObject({
      success: false,
      error: 'unknown-project',
    });
  });
});

describe('git mutation workspace write gate', () => {
  it('fails git/stage with workspace-busy when the workspace lease is held', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-busy-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');

    const gate = createWorkspaceWriteGate();
    const held = await gate.tryAcquire({
      workspaceId: 'ws-busy',
      rootPath: projectPath,
      kind: 'tool',
    });
    expect(held.ok).toBe(true);

    const context = {
      piwinRoot: rootDir,
      workspaceWriteGate: gate,
    } as HostCommandContext;
    const staged = await handleGitCommand(
      { type: 'git/stage', input: { projectPath, paths: ['README.md'] } },
      'stage-busy',
      context,
    );
    expect(staged).toMatchObject({
      success: false,
    });
    expect(String(staged && 'error' in staged ? staged.error : '')).toMatch(/workspace-busy/);

    if (held.ok) {
      held.lease.release();
    }
    const afterRelease = await handleGitCommand(
      { type: 'git/stage', input: { projectPath, paths: ['README.md'] } },
      'stage-free',
      context,
    );
    expect(afterRelease?.success).toBe(true);
  });

  it('does not acquire the gate for git/status reads', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-read-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: projectPath });

    const gate = createWorkspaceWriteGate();
    const held = await gate.tryAcquire({
      workspaceId: 'ws-read',
      rootPath: projectPath,
      kind: 'integration',
    });
    expect(held.ok).toBe(true);

    const status = await handleGitCommand(
      { type: 'git/status', projectPath },
      'status-busy',
      { piwinRoot: rootDir, workspaceWriteGate: gate } as HostCommandContext,
    );
    expect(status?.success).toBe(true);
    if (held.ok) {
      held.lease.release();
    }
  });
});
