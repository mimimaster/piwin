import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeWorktreeDependencyFingerprint,
  detectWorktreeDependencyInstall,
  findDependenciesOutsideWorktree,
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

  it('reuses the existing install when the dependency fingerprint is unchanged', async () => {
    await mkdir(join(parent, 'node_modules'));
    await mkdir(join(worktree, 'node_modules'));
    await writeFile(join(worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 1\n');
    const fingerprint = await computeWorktreeDependencyFingerprint(worktree);
    expect(fingerprint).toBeDefined();
    const runCommand = vi.fn(async () => undefined);

    const setup = await prepareWorktreeDependencies({
      worktreePath: worktree,
      parentRepoPath: parent,
      previousFingerprint: fingerprint,
      runCommand,
    });

    expect(setup).toMatchObject({ status: 'reused', manager: 'pnpm', fingerprint });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('reinstalls when the lockfile changed and leaves a stale install', async () => {
    await mkdir(join(parent, 'node_modules'));
    await mkdir(join(worktree, 'node_modules'));
    await writeFile(join(worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 1\n');
    const stale = await computeWorktreeDependencyFingerprint(worktree);
    await writeFile(join(worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 2\n');

    expect(await computeWorktreeDependencyFingerprint(worktree)).not.toBe(stale);
    const runCommand = vi.fn(async () => undefined);
    const setup = await prepareWorktreeDependencies({
      worktreePath: worktree,
      parentRepoPath: parent,
      previousFingerprint: stale,
      runCommand,
    });
    expect(setup.status).toBe('installed');
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('ignores a matching fingerprint when the workspace has no dependencies left', async () => {
    await mkdir(join(parent, 'node_modules'));
    await writeFile(join(worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 1\n');
    const fingerprint = await computeWorktreeDependencyFingerprint(worktree);
    const runCommand = vi.fn(async () => undefined);

    const setup = await prepareWorktreeDependencies({
      worktreePath: worktree,
      parentRepoPath: parent,
      previousFingerprint: fingerprint,
      runCommand,
    });
    expect(setup.status).toBe('installed');
  });

  it('has no fingerprint without a lockfile', async () => {
    expect(await computeWorktreeDependencyFingerprint(worktree)).toBeUndefined();
  });

  it('reports dependency links that resolve outside the workspace', async () => {
    const outside = join(root, 'main-checkout-node-modules');
    await mkdir(outside);
    await mkdir(join(worktree, 'node_modules'));
    await symlink(outside, join(worktree, 'node_modules', 'left-pad'));

    const local = join(worktree, 'node_modules', 'local-pkg');
    await mkdir(local);
    await mkdir(join(worktree, 'node_modules', '@scope'));
    await symlink(local, join(worktree, 'node_modules', '@scope', 'child'));

    expect(await findDependenciesOutsideWorktree(worktree)).toEqual([
      'node_modules/left-pad',
    ]);
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
    const reused = formatWorktreeDependencyGuidance({
      status: 'reused',
      manager: 'pnpm',
    });
    expect(reused).toContain('unchanged since the Host installed them');
    for (const text of [failed, reused, formatWorktreeDependencyGuidance(undefined)]) {
      expect(text).toContain('Never symlink node_modules');
    }
  });
});
