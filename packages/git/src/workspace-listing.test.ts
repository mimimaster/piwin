import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGitCommand } from './git-command-runner.js';
import {
  gitRepositoryIdFromCommonDir,
  readGitWorkspaceListing,
} from './workspace-listing.js';

const temporaryDirectories: string[] = [];

async function runGit(repositoryPath: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd: repositoryPath, args });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'piwin-listing-'));
  temporaryDirectories.push(repositoryPath);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.email', 'piwin-test@example.com']);
  await runGit(repositoryPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(repositoryPath, 'README.md'), 'base\n');
  await runGit(repositoryPath, ['add', '--all']);
  await runGit(repositoryPath, ['commit', '-m', 'base']);
  return repositoryPath;
}

describe('readGitWorkspaceListing', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('shares gitRepositoryId across linked worktrees and reports the current branch', async () => {
    const projectPath = await createRepository();
    await runGit(projectPath, ['branch', 'feat/x']);
    const linkedPath = join(projectPath, '..', `listing-linked-${Date.now()}`);
    temporaryDirectories.push(linkedPath);
    await runGit(projectPath, ['worktree', 'add', linkedPath, 'feat/x']);

    const primary = await readGitWorkspaceListing(projectPath);
    const linked = await readGitWorkspaceListing(linkedPath);
    expect(primary?.currentBranch).toBe('main');
    expect(primary?.isPrimaryWorktree).toBe(true);
    expect(linked?.currentBranch).toBe('feat/x');
    expect(linked?.isPrimaryWorktree).toBe(false);
    expect(linked?.gitRepositoryId).toBe(primary?.gitRepositoryId);
    expect(primary?.gitRepositoryId).toHaveLength(16);
    expect(await realpath(primary?.gitRootPath ?? '')).toBe(await realpath(projectPath));
    expect(await realpath(linked?.gitRootPath ?? '')).toBe(await realpath(linkedPath));
  });

  it('reports the checkout root for a subdirectory of the primary worktree', async () => {
    const projectPath = await createRepository();
    const nestedPath = join(projectPath, 'apps');
    await mkdir(nestedPath);
    const nested = await readGitWorkspaceListing(nestedPath);
    expect(await realpath(nested?.gitRootPath ?? '')).toBe(await realpath(projectPath));
    expect(nested?.isPrimaryWorktree).toBe(true);
    expect(nested?.gitRepositoryId).toBe((await readGitWorkspaceListing(projectPath))?.gitRepositoryId);
  });

  it('returns null for a non-git directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-listing-plain-'));
    temporaryDirectories.push(directory);
    expect(await readGitWorkspaceListing(directory)).toBeNull();
  });

  it('hashes the same commonDir to the same id', () => {
    expect(gitRepositoryIdFromCommonDir('/repo/.git')).toBe(
      gitRepositoryIdFromCommonDir('/repo/.git'),
    );
    expect(gitRepositoryIdFromCommonDir('/repo/.git')).not.toBe(
      gitRepositoryIdFromCommonDir('/other/.git'),
    );
  });
});
