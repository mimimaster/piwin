import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX,
  CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX,
} from '@piwin/contracts';
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

describe('git checkout', () => {
  it('switches the repository worktree to the requested branch', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-checkout-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=piwin-test',
        '-c',
        'user.email=piwin-test@example.com',
        'commit',
        '-m',
        'initial',
      ],
      { cwd: projectPath },
    );
    await execFileAsync('git', ['branch', 'feat/demo'], { cwd: projectPath });

    const checkout = await handleGitCommand(
      { type: 'git/checkout', input: { projectPath, ref: 'feat/demo' } },
      'checkout',
      { piwinRoot: rootDir } as HostCommandContext,
    );
    expect(checkout?.success).toBe(true);

    const currentBranch = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: projectPath,
    });
    expect(currentBranch.stdout.trim()).toBe('feat/demo');
  });

  it('returns a readable error when the branch is already used by another worktree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-occupied-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
    await execFileAsync('git', ['branch', 'feat/occupied'], { cwd: projectPath });
    const linkedPath = join(rootDir, 'linked');
    await execFileAsync('git', ['worktree', 'add', linkedPath, 'feat/occupied'], {
      cwd: projectPath,
    });

    const checkout = await handleGitCommand(
      { type: 'git/checkout', input: { projectPath, ref: 'feat/occupied' } },
      'checkout-occupied',
      { piwinRoot: rootDir } as HostCommandContext,
    );
    expect(checkout?.success).toBe(false);
    expect(String(checkout && 'error' in checkout ? checkout.error : '')).toContain(
      BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX,
    );

    const listed = await handleGitCommand(
      { type: 'git/branch-list', projectPath, limit: 20 },
      'branches-occupied',
      { piwinRoot: rootDir } as HostCommandContext,
    );
    expect(listed?.success).toBe(true);
    const branches =
      listed && 'data' in listed
        ? (
            listed.data as {
              branches: {
                branches: Array<{
                  name: string;
                  checkedOutWorktreePath?: string;
                }>;
              };
            }
          ).branches.branches
        : [];
    const occupied = branches.find((branch) => branch.name === 'feat/occupied');
    expect(occupied?.checkedOutWorktreePath).toBeTruthy();
    expect(await realpath(occupied?.checkedOutWorktreePath ?? '')).toBe(await realpath(linkedPath));
  });

  it('returns a classified error when local changes would be overwritten', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-git-dirty-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
    await execFileAsync('git', ['checkout', '-b', 'feat/other'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'other\n', 'utf8');
    await execFileAsync('git', ['commit', '-am', 'other'], { cwd: projectPath });
    await execFileAsync('git', ['checkout', 'main'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'dirty\n', 'utf8');

    const checkout = await handleGitCommand(
      { type: 'git/checkout', input: { projectPath, ref: 'feat/other' } },
      'checkout-dirty',
      { piwinRoot: rootDir } as HostCommandContext,
    );
    expect(checkout?.success).toBe(false);
    expect(String(checkout && 'error' in checkout ? checkout.error : '')).toBe(
      CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX,
    );
    expect(String(checkout && 'error' in checkout ? checkout.error : '')).not.toContain('README.md');
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
