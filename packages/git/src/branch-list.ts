/**
 * List local branches for the checkout picker (session branch chip).
 * Remote-tracking refs are omitted, and local branches already merged into
 * the default tip (and behind it) are dropped so leftover PR branches do
 * not clutter the menu after they land.
 */
import type {
  GitBranchList,
  GitBranchListEntry,
  GitRepositoryIdentity,
} from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';
import { annotateBranchesWithWorktreeOccupancy, listGitWorktrees } from './worktree-list.js';

const FIELD_SEP = '\x1f';
const FETCH_CAP = 200;

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

/**
 * Drop leftover local branches that are already contained by the default tip
 * and no longer point at that tip. Keep the current checkout, occupied
 * worktree branches, unmerged work, and freshly created same-tip branches.
 */
export function excludeStaleMergedBranches(
  branches: readonly GitBranchListEntry[],
  mergedNames: ReadonlySet<string>,
  mergeTipShortHash: string | null,
): GitBranchListEntry[] {
  if (!mergeTipShortHash || mergedNames.size === 0) {
    return [...branches];
  }
  return branches.filter((branch) => {
    if (branch.current) {
      return true;
    }
    if (branch.checkedOutWorktreePath) {
      return true;
    }
    if (!mergedNames.has(branch.name)) {
      return true;
    }
    return branch.shortHash === mergeTipShortHash;
  });
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

  const limit = Math.max(1, Math.min(options.limit ?? 80, FETCH_CAP));
  const result = await runGitCommand({
    cwd: options.repository.rootPath,
    args: [
      'for-each-ref',
      `--count=${FETCH_CAP + 1}`,
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
  const worktrees = await listGitWorktrees(options.repository);
  const annotated = annotateBranchesWithWorktreeOccupancy(
    parsed,
    worktrees.worktrees,
    options.repository.rootPath,
  );
  const mergeTip = await resolveCheckoutPickerMergeTip(options.repository.rootPath);
  const visible = excludeStaleMergedBranches(
    annotated,
    mergeTip.mergedNames,
    mergeTip.shortHash,
  );
  const truncated = visible.length > limit || parsed.length > FETCH_CAP;
  const branches = truncated ? visible.slice(0, limit) : visible;
  return {
    repository: options.repository,
    branches,
    truncated,
    totalBranches: truncated ? visible.length : branches.length,
  };
}

async function resolveCheckoutPickerMergeTip(cwd: string): Promise<{
  mergedNames: Set<string>;
  shortHash: string | null;
}> {
  const originHead = await runGitCommand({
    cwd,
    args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    allowFailure: true,
  });
  const tip =
    originHead.exitCode === 0 && originHead.stdout.trim().length > 0
      ? originHead.stdout.trim()
      : 'HEAD';

  const hashResult = await runGitCommand({
    cwd,
    args: ['rev-parse', '--short', tip],
    allowFailure: true,
  });
  const shortHash = hashResult.exitCode === 0 ? hashResult.stdout.trim() || null : null;

  const mergedResult = await runGitCommand({
    cwd,
    args: ['for-each-ref', '--format=%(refname:short)', `--merged=${tip}`, 'refs/heads/'],
    allowFailure: true,
  });
  const mergedNames = new Set<string>();
  if (mergedResult.exitCode === 0) {
    for (const rawLine of mergedResult.stdout.split('\n')) {
      const name = rawLine.replace(/\r$/, '').trim();
      if (name) {
        mergedNames.add(name);
      }
    }
  }
  return { mergedNames, shortHash };
}
