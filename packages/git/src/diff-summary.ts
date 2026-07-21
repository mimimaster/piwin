/**
 * Bounded numstat summary for worktree + index changes.
 */
import type {
  GitDiffFileStat,
  GitDiffSummary,
  GitFileStatusCode,
  GitRepositoryIdentity,
} from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';

export type ReadGitDiffSummaryOptions = {
  repository: GitRepositoryIdentity;
  maxFiles?: number;
};

export async function readGitDiffSummary(
  options: ReadGitDiffSummaryOptions,
): Promise<GitDiffSummary> {
  if (!options.repository.isRepository) {
    return emptySummary(options.repository);
  }

  const maxFiles = options.maxFiles ?? 500;
  // Combined unstaged + staged against HEAD
  const result = await runGitCommand({
    cwd: options.repository.rootPath,
    args: ['diff', '--numstat', 'HEAD'],
    allowFailure: true,
  });

  // Empty repo (no HEAD) — fall back to unstaged only
  const stdout =
    result.exitCode === 0
      ? result.stdout
      : (
          await runGitCommand({
            cwd: options.repository.rootPath,
            args: ['diff', '--numstat'],
            allowFailure: true,
          })
        ).stdout;

  const files = parseNumstat(stdout);
  const totalFiles = files.length;
  const truncated = totalFiles > maxFiles;
  const limited = truncated ? files.slice(0, maxFiles) : files;

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of limited) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    repository: options.repository,
    files: limited,
    totalAdditions,
    totalDeletions,
    truncated,
    totalFiles,
  };
}

export function parseNumstat(stdout: string): GitDiffFileStat[] {
  const files: GitDiffFileStat[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    // additions\tdeletions\tpath  (binary: -\t-\tpath)
    const parts = line.split('\t');
    if (parts.length < 3) {
      continue;
    }
    const additionsRaw = parts[0] ?? '0';
    const deletionsRaw = parts[1] ?? '0';
    const path = parts.slice(2).join('\t');
    const additions = additionsRaw === '-' ? 0 : Number(additionsRaw);
    const deletions = deletionsRaw === '-' ? 0 : Number(deletionsRaw);
    files.push({
      path,
      status: inferStatus(additions, deletions, additionsRaw === '-'),
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  return files;
}

function inferStatus(
  additions: number,
  deletions: number,
  isBinary: boolean,
): GitFileStatusCode {
  if (isBinary) {
    return 'modified';
  }
  if (additions > 0 && deletions === 0) {
    return 'added';
  }
  if (deletions > 0 && additions === 0) {
    return 'deleted';
  }
  return 'modified';
}

function emptySummary(repository: GitRepositoryIdentity): GitDiffSummary {
  return {
    repository,
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
    truncated: false,
    totalFiles: 0,
  };
}
