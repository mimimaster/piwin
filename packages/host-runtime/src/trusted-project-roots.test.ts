import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openOrCreateProject } from '@piwin/project';
import { getPiwinGeneralWorkspacePath, getPiwinProjectsPath } from './paths.js';
import { listTrustedProjectRoots, trustedWorktreeRoots } from './trusted-project-roots.js';

describe('listTrustedProjectRoots', () => {
  it('always trusts the built-in No Repo workspace', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-roots-'));
    await expect(listTrustedProjectRoots(rootDir)).resolves.toEqual([
      getPiwinGeneralWorkspacePath(rootDir),
    ]);
  });

  it('adds trusted projects and skips untrusted ones', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-roots-store-'));
    const storePath = getPiwinProjectsPath(rootDir);
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-project-'));
    const untrustedDir = await mkdtemp(join(tmpdir(), 'piwin-untrusted-project-'));
    await openOrCreateProject(storePath, trustedDir, { trust: 'trusted' });
    await openOrCreateProject(storePath, untrustedDir, { trust: 'untrusted' });

    const roots = await listTrustedProjectRoots(rootDir);
    expect(roots[0]).toBe(getPiwinGeneralWorkspacePath(rootDir));
    expect(roots).toContain(trustedDir);
    expect(roots).not.toContain(untrustedDir);
  });
});

describe('trustedWorktreeRoots', () => {
  it('grants the live worktree of a dispatched child', () => {
    expect(
      trustedWorktreeRoots(
        [{ worktreePath: '/piwin/worktrees/repo/child' }],
        ['/repo'],
      ),
    ).toEqual(['/piwin/worktrees/repo/child']);
  });

  it('grants a dispatched worktree even when the parent repository is not trusted', () => {
    expect(
      trustedWorktreeRoots(
        [{ worktreePath: '/piwin/worktrees/untrusted/child' }],
        ['/repo'],
      ),
    ).toEqual(['/piwin/worktrees/untrusted/child']);
  });

  it('does not grant readonly children or the rest of the worktree storage', () => {
    expect(
      trustedWorktreeRoots(
        [{}, { worktreePath: '   ' }],
        ['/repo', '/piwin/worktrees'],
      ),
    ).toEqual([]);
  });
});
