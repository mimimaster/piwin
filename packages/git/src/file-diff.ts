/**
 * Single-file unified patch for Review split view.
 */
import type { GitFileDiff, GitRepositoryIdentity } from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';
import { assertSafeRepoRelativePaths } from './path-safety.js';

export type ReadGitFileDiffOptions = {
  repository: GitRepositoryIdentity;
  path: string;
  scope?: 'worktree' | 'staged' | 'combined';
  /** Soft cap on returned patch characters. */
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 200_000;

export async function readGitFileDiff(
  options: ReadGitFileDiffOptions,
): Promise<GitFileDiff> {
  const scope = options.scope ?? 'combined';
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (!options.repository.isRepository) {
    return emptyDiff(options.repository, options.path, scope);
  }

  const [safePath] = assertSafeRepoRelativePaths(options.repository.rootPath, [
    options.path,
  ]);
  if (!safePath) {
    throw new Error('path is empty');
  }

  const args =
    scope === 'staged'
      ? ['diff', '--cached', '--', safePath]
      : scope === 'worktree'
        ? ['diff', '--', safePath]
        : ['diff', 'HEAD', '--', safePath];

  let result = await runGitCommand({
    cwd: options.repository.rootPath,
    args,
    allowFailure: true,
  });

  // Empty repo (no HEAD): fall back to unstaged diff for combined/staged.
  if (result.exitCode !== 0 && scope === 'combined') {
    result = await runGitCommand({
      cwd: options.repository.rootPath,
      args: ['diff', '--', safePath],
      allowFailure: true,
    });
  }

  // Untracked file: show full content as additions via /dev/null style when possible.
  if (!result.stdout.trim() && scope === 'combined') {
    const untracked = await runGitCommand({
      cwd: options.repository.rootPath,
      args: ['ls-files', '--others', '--exclude-standard', '--', safePath],
      allowFailure: true,
    });
    if (untracked.stdout.trim() === safePath || untracked.stdout.includes(safePath)) {
      const show = await runGitCommand({
        cwd: options.repository.rootPath,
        args: ['diff', '--no-index', '--', '/dev/null', safePath],
        allowFailure: true,
      });
      // git --no-index exits 1 when files differ; stdout still has the patch.
      result = show;
    }
  }

  let patch = result.stdout ?? '';
  const isBinary =
    /Binary files .* differ/i.test(patch) || /GIT binary patch/i.test(patch);
  let truncated = false;
  if (patch.length > maxChars) {
    patch = patch.slice(0, maxChars);
    truncated = true;
  }

  const { additions, deletions } = countPatchStats(patch);

  const diff: GitFileDiff = {
    repository: options.repository,
    path: safePath,
    scope,
    isBinary,
    patch: isBinary ? '' : patch,
    truncated,
  };
  if (additions !== undefined) diff.additions = additions;
  if (deletions !== undefined) diff.deletions = deletions;
  return diff;
}

export function countPatchStats(patch: string): {
  additions?: number;
  deletions?: number;
} {
  let additions = 0;
  let deletions = 0;
  let sawHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      sawHunk = true;
      continue;
    }
    if (!sawHunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  if (!sawHunk) {
    return {};
  }
  return { additions, deletions };
}

function emptyDiff(
  repository: GitRepositoryIdentity,
  path: string,
  scope: GitFileDiff['scope'],
): GitFileDiff {
  return {
    repository,
    path,
    scope,
    isBinary: false,
    patch: '',
    truncated: false,
  };
}
