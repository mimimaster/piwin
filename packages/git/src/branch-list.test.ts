import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  excludeStaleMergedBranches,
  parseGitBranchListOutput,
  readGitBranchList,
} from './branch-list.js';
import { runGitCommand } from './git-command-runner.js';
import { probeGitRepository } from './repository-probe.js';

const temporaryDirectories: string[] = [];

async function runGit(repositoryPath: string, args: string[]): Promise<string> {
  const result = await runGitCommand({ cwd: repositoryPath, args });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'piwin-branch-list-'));
  temporaryDirectories.push(repositoryPath);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.email', 'piwin-test@example.com']);
  await runGit(repositoryPath, ['config', 'user.name', 'piwin test']);
  await writeFile(join(repositoryPath, 'README.md'), 'base\n');
  await runGit(repositoryPath, ['add', '--all']);
  await runGit(repositoryPath, ['commit', '-m', 'base']);
  return repositoryPath;
}

describe('parseGitBranchListOutput', () => {
  it('parses name, short hash, and current marker', () => {
    const stdout = [
      'main\x1fabc1234\x1f*',
      'feat/ui\x1fdef5678\x1f',
      'fix/typo\x1f\x1f',
    ].join('\n');

    const branches = parseGitBranchListOutput(stdout);
    expect(branches).toEqual([
      { name: 'main', current: true, shortHash: 'abc1234' },
      { name: 'feat/ui', current: false, shortHash: 'def5678' },
      { name: 'fix/typo', current: false, shortHash: null },
    ]);
  });

  it('skips blank lines', () => {
    expect(parseGitBranchListOutput('\n\nmain\x1fabc\x1f*\n\n')).toEqual([
      { name: 'main', current: true, shortHash: 'abc' },
    ]);
  });
});

describe('excludeStaleMergedBranches', () => {
  it('keeps the current branch, unmerged work, and same-tip locals', () => {
    const visible = excludeStaleMergedBranches(
      [
        { name: 'main', current: true, shortHash: 'aaa1111' },
        { name: 'feat/wip', current: false, shortHash: 'bbb2222' },
        { name: 'feat/just-created', current: false, shortHash: 'aaa1111' },
        { name: 'feat/landed', current: false, shortHash: 'ccc3333' },
        {
          name: 'feat/occupied',
          current: false,
          shortHash: 'ccc3333',
          checkedOutWorktreePath: '/tmp/occupied',
        },
      ],
      new Set(['main', 'feat/just-created', 'feat/landed', 'feat/occupied']),
      'aaa1111',
    );
    expect(visible.map((branch) => branch.name)).toEqual([
      'main',
      'feat/wip',
      'feat/just-created',
      'feat/occupied',
    ]);
  });
});

describe('readGitBranchList', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('omits leftover local branches already merged into the default tip', async () => {
    const repositoryPath = await createRepository();
    await runGit(repositoryPath, ['branch', 'feat/landed']);
    await writeFile(join(repositoryPath, 'README.md'), 'next\n');
    await runGit(repositoryPath, ['add', '--all']);
    await runGit(repositoryPath, ['commit', '-m', 'next']);
    await runGit(repositoryPath, ['branch', 'feat/wip']);
    await runGit(repositoryPath, ['checkout', 'feat/wip']);
    await writeFile(join(repositoryPath, 'wip.txt'), 'unique\n');
    await runGit(repositoryPath, ['add', '--all']);
    await runGit(repositoryPath, ['commit', '-m', 'wip']);
    await runGit(repositoryPath, ['checkout', 'main']);

    const listed = await readGitBranchList({
      repository: await probeGitRepository(repositoryPath),
    });
    expect(listed.branches.map((branch) => branch.name).sort()).toEqual(['feat/wip', 'main']);
  });
});
