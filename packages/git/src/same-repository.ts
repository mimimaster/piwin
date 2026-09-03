/**
 * Same-repo detection via `--git-common-dir`. Worktrees may live on another
 * volume; path prefixes are not a reliable grouping key.
 */
import { probeGitRepository } from './repository-probe.js';

export async function resolveGitCommonDir(projectPath: string): Promise<string | null> {
  const identity = await probeGitRepository(projectPath);
  return identity.commonDir ?? null;
}

/**
 * Return the first trusted project path that shares a git common dir with
 * `candidatePath`. Used so a newly opened worktree inherits trust.
 */
export async function findTrustedSameRepositoryRoot(
  candidatePath: string,
  trustedProjectPaths: readonly string[],
): Promise<string | null> {
  const candidateCommonDir = await resolveGitCommonDir(candidatePath);
  if (!candidateCommonDir) {
    return null;
  }
  for (const trustedPath of trustedProjectPaths) {
    if (trustedPath === candidatePath) {
      continue;
    }
    const trustedCommonDir = await resolveGitCommonDir(trustedPath);
    if (trustedCommonDir === candidateCommonDir) {
      return trustedPath;
    }
  }
  return null;
}
