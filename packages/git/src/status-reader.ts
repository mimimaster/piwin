/**
 * Read branch + dirty state + changed files for a git work tree.
 */
import type { GitRepositoryIdentity, GitStatusSnapshot } from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';
import { parsePorcelainStatus } from './status-parser.js';

export type ReadGitStatusOptions = {
  repository: GitRepositoryIdentity;
  /** Cap number of changed files returned (default 500). */
  maxFiles?: number;
};

export async function readGitStatus(options: ReadGitStatusOptions): Promise<GitStatusSnapshot> {
  if (!options.repository.isRepository) {
    return {
      repository: options.repository,
      branch: null,
      changedFiles: [],
      truncated: false,
      totalChangedFiles: 0,
    };
  }

  const maxFiles = options.maxFiles ?? 500;
  const statusResult = await runGitCommand({
    cwd: options.repository.rootPath,
    args: ['status', '--porcelain=v1', '-b'],
  });
  const parsed = parsePorcelainStatus(statusResult.stdout);

  // Fill head commit (detached or attached)
  const headResult = await runGitCommand({
    cwd: options.repository.rootPath,
    args: ['rev-parse', 'HEAD'],
    allowFailure: true,
  });
  if (headResult.exitCode === 0) {
    parsed.branch.headCommit = headResult.stdout.trim() || null;
  }

  const totalChangedFiles = parsed.changedFiles.length;
  const truncated = totalChangedFiles > maxFiles;
  const changedFiles = truncated
    ? parsed.changedFiles.slice(0, maxFiles)
    : parsed.changedFiles;

  return {
    repository: options.repository,
    branch: parsed.branch,
    changedFiles,
    truncated,
    totalChangedFiles,
  };
}
