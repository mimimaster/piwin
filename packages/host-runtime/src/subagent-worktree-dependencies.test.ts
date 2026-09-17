import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectWorktreeDependencyInstall,
  formatWorktreeDependencyGuidance,
  prepareWorktreeDependencies,
} from './subagent-worktree-dependencies.js';

describe('worktree dependency setup', () => {
  let root: string;
  let parent: string;
  let worktree: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-wt-deps-'));
    parent = join(root, 'parent');
    worktree = join(root, 'worktree');
    await mkdir(parent, { recursive: true });
    await mkdir(worktree, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('picks the package manager from the lockfile', async () => {
    expect(await detectWorktreeDependencyInstall(worktree)).toBeUndefined();

    await writeFile(join(worktree, 'package-lock.json'), '{}');
    expect((await detectWorktreeDependencyInstall(worktree))?.manager).toBe('npm');

    await writeFile(join(worktree, 'yarn.lock'), '');
    expect((await detectWorktreeDependencyInstall(worktree))?.args).toContain('--frozen-lockfile');
    await writeFile(join(worktree, '.yarnrc.yml'), '');
    expect((await detectWorktreeDependencyInstall(worktree))?.args).toContain('--immutable');

    await writeFile(join(worktree, 'bun.lock'), '');
    expect((await detectWorktreeDependencyInstall(worktree))?.manager).toBe('bun');

    await writeFile(join(worktree, 'pnpm-lock.yaml'), '');
    expect(await detectWorktreeDependencyInstall(worktree)).toEqual({
      manager: 'pnpm',
      command: 'pnpm',
      args: ['install', '--frozen-lockfile', '--prefer-offline', '--config.confirmModulesPurge=false'],
    });
  });

  it('skips when the parent checkout never installed dependencies', async () => {
    await writeFile(join(worktree, 'pnpm-lock.yaml'), '');
    const runCommand = vi.fn(async () => undefined);

    const setup = await prepareWorktreeDependencies({
      worktreePath: worktree,
      parentRepoPath: parent,
      runCommand,
    });

    expect(setup).toMatchObject({ status: 'skipped' });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('installs inside the worktree when the parent has node_modules', async () => {
    await mkdir(join(parent, 'node_modules'));
    await writeFile(join(worktree, 'pnpm-lock.yaml'), '');
    const runCommand = vi.fn(async () => undefined);

    const setup = await prepareWorktreeDependencies({
      worktreePath: worktree,
      parentRepoPath: parent,
      runCommand,
      timeoutMs: 1234,
    });

    expect(setup).toMatchObject({ status: 'installed', manager: 'pnpm' });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm', cwd: worktree, timeoutMs: 1234 }),
    );
  });

  it('records a bounded failure instead of throwing', async () => {
    await mkdir(join(parent, 'node_modules'));
    await writeFile(join(worktree, 'pnpm-lock.yaml'), '');

    const setup = await prepareWorktreeDependencies({
      worktreePath: worktree,
      parentRepoPath: parent,
      runCommand: async () => {
        throw new Error(`ERR_PNPM_OUTDATED_LOCKFILE ${'x'.repeat(2000)}`);
      },
    });

    expect(setup.status).toBe('failed');
    expect(setup.reason?.length).toBeLessThanOrEqual(601);
  });

  it('tells the child what happened and forbids symlinking to another checkout', () => {
    expect(formatWorktreeDependencyGuidance({ status: 'installed', manager: 'pnpm' })).toContain(
      'installed in this worktree by the Host (pnpm)',
    );
    const failed = formatWorktreeDependencyGuidance({
      status: 'failed',
      manager: 'pnpm',
      reason: 'network down\nstack',
    });
    expect(failed).toContain('pnpm: network down)');
    expect(failed).not.toContain('stack');
    for (const text of [failed, formatWorktreeDependencyGuidance(undefined)]) {
      expect(text).toContain('Never symlink node_modules');
    }
  });
});
