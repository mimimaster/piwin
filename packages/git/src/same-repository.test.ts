import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGitCommand } from './git-command-runner.js';
import { probeGitRepository } from './repository-probe.js';
import { findTrustedSameRepositoryRoot } from './same-repository.js';
import { readGitBranchList } from './branch-list.js';

const temporaryDirectories: string[] = [];

async function runGit(repositoryPath: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd: repositoryPath, args });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'piwin-same-repo-'));
  temporaryDirectories.push(repositoryPath);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.email', 'piwin-test@example.com']);
  await runGit(repositoryPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(repositoryPath, 'README.md'), 'base\n');
  await runGit(repositoryPath, ['add', '--all']);
  await runGit(repositoryPath, ['commit', '-m', 'base']);
  return repositoryPath;
}

describe('same-repository worktrees', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('shares commonDir between the primary worktree and a linked worktree', async () => {
    const projectPath = await createRepository();
    await runGit(projectPath, ['branch', 'feat/x']);
    const linkedPath = join(projectPath, '..', `linked-${Date.now()}`);
    temporaryDirectories.push(linkedPath);
    await runGit(projectPath, ['worktree', 'add', linkedPath, 'feat/x']);

    const primary = await probeGitRepository(projectPath);
    const linked = await probeGitRepository(linkedPath);
    expect(primary.commonDir).toBeTruthy();
    expect(linked.commonDir).toBe(primary.commonDir);
    expect(primary.isPrimaryWorktree).toBe(true);
    expect(linked.isPrimaryWorktree).toBe(false);

    const trustedRoot = await findTrustedSameRepositoryRoot(linkedPath, [projectPath]);
    expect(trustedRoot).toBe(projectPath);

    const foreign = await createRepository();
    expect(await findTrustedSameRepositoryRoot(linkedPath, [foreign])).toBeNull();
  });

  it('annotates branch-list occupancy for a linked worktree', async () => {
    const projectPath = await createRepository();
    await runGit(projectPath, ['branch', 'feat/x']);
    const linkedPath = join(projectPath, '..', `linked-occ-${Date.now()}`);
    temporaryDirectories.push(linkedPath);
    await runGit(projectPath, ['worktree', 'add', linkedPath, 'feat/x']);

    const listed = await readGitBranchList({
      repository: await probeGitRepository(projectPath),
    });
    const occupied = listed.branches.find((branch) => branch.name === 'feat/x');
    expect(occupied?.checkedOutWorktreePath).toBeTruthy();
    expect(await realpath(occupied?.checkedOutWorktreePath ?? '')).toBe(await realpath(linkedPath));
    const current = listed.branches.find((branch) => branch.current);
    expect(current?.checkedOutWorktreePath).toBeUndefined();
  });
});
