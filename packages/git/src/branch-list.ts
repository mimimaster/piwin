/**
 * List local branches for the checkout picker (session branch chip).
 * Remote-tracking refs are intentionally omitted to keep the UI small.
 */
import type {
  GitBranchList,
  GitBranchListEntry,
  GitRepositoryIdentity,
} from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';

const FIELD_SEP = '\x1f';

export type ReadGitBranchListOptions = {
  repository: GitRepositoryIdentity;
  /** Default 80. */
  limit?: number;
};

/**
 * Parse `git for-each-ref` rows: name, short hash, HEAD marker (`*` or empty).
 */
export function parseGitBranchListOutput(stdout: string): GitBranchListEntry[] {
  const branches: GitBranchListEntry[] = [];
  const lines = stdout.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      continue;
    }
    const fields = line.split(FIELD_SEP);
    const name = (fields[0] ?? '').trim();
    if (!name) {
      continue;
    }
    const shortHashRaw = (fields[1] ?? '').trim();
    const headMarker = (fields[2] ?? '').trim();
    branches.push({
      name,
      current: headMarker === '*',
      shortHash: shortHashRaw.length > 0 ? shortHashRaw : null,
    });
  }
  return branches;
}

export async function readGitBranchList(
  options: ReadGitBranchListOptions,
): Promise<GitBranchList> {
  if (!options.repository.isRepository) {
    return {
      repository: options.repository,
      branches: [],
      truncated: false,
      totalBranches: 0,
    };
  }

  const limit = Math.max(1, Math.min(options.limit ?? 80, 200));
  const result = await runGitCommand({
    cwd: options.repository.rootPath,
    args: [
      'for-each-ref',
      `--count=${limit + 1}`,
      '--sort=-committerdate',
      `--format=%(refname:short)${FIELD_SEP}%(objectname:short)${FIELD_SEP}%(HEAD)`,
      'refs/heads/',
    ],
    allowFailure: true,
  });

  if (result.exitCode !== 0) {
    return {
      repository: options.repository,
      branches: [],
      truncated: false,
      totalBranches: 0,
    };
  }

  const parsed = parseGitBranchListOutput(result.stdout);
  const truncated = parsed.length > limit;
  const branches = truncated ? parsed.slice(0, limit) : parsed;
  return {
    repository: options.repository,
    branches,
    truncated,
    totalBranches: truncated ? parsed.length : branches.length,
  };
}
