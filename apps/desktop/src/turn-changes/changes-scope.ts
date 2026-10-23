/**
 * Pure model behind the right-panel Changes scope picker: which files a Git
 * scope shows, which patch it asks Host for, and what its picker entry counts.
 */
import type { GitChangedFile, GitDiffFileStat } from '@piwin/contracts';

export type ChangesScope = 'turn' | 'uncommitted' | 'staged' | 'unstaged' | 'history' | 'result';

/** Scopes that list working-tree files from `git/status`. */
export type WorktreeScope = 'uncommitted' | 'staged' | 'unstaged';

export const WORKTREE_SCOPES: readonly WorktreeScope[] = ['uncommitted', 'staged', 'unstaged'];

/** Sections open by default; the rest stay collapsed so a big change set loads lazily. */
export const DEFAULT_EXPANDED_FILES = 8;

export type ChangeRow = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  /** Worktree-vs-HEAD line stats from `git/diff-summary`; 0 when unknown. */
  additions: number;
  deletions: number;
};

/**
 * `files` always counts; line totals are null where the summary cannot say
 * (it is worktree-vs-HEAD, so it overstates a staged or unstaged slice).
 */
export type ScopeTally = {
  files: number;
  additions: number | null;
  deletions: number | null;
};

export type StageState = 'staged' | 'partial' | 'unstaged';

export function isWorktreeScope(scope: ChangesScope): scope is WorktreeScope {
  return scope === 'uncommitted' || scope === 'staged' || scope === 'unstaged';
}

export function buildChangeRows(
  changedFiles: readonly GitChangedFile[],
  stats: readonly GitDiffFileStat[],
): ChangeRow[] {
  const statsByPath = new Map(stats.map((file) => [file.path, file]));
  return changedFiles.map((file) => {
    const stat = statsByPath.get(file.path);
    return {
      path: file.path,
      status: file.status,
      staged: file.staged,
      unstaged: file.unstaged,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    };
  });
}

export function rowsInScope(rows: readonly ChangeRow[], scope: WorktreeScope): ChangeRow[] {
  switch (scope) {
    case 'uncommitted':
      return [...rows];
    case 'staged':
      return rows.filter((row) => row.staged);
    case 'unstaged':
      return rows.filter((row) => row.unstaged);
  }
}

export function diffScopeFor(scope: WorktreeScope): 'combined' | 'staged' | 'worktree' {
  switch (scope) {
    case 'uncommitted':
      return 'combined';
    case 'staged':
      return 'staged';
    case 'unstaged':
      return 'worktree';
  }
}

export function tallyScope(rows: readonly ChangeRow[], scope: WorktreeScope): ScopeTally {
  const inScope = rowsInScope(rows, scope);
  if (scope !== 'uncommitted') {
    return { files: inScope.length, additions: null, deletions: null };
  }
  let additions = 0;
  let deletions = 0;
  for (const row of inScope) {
    additions += row.additions;
    deletions += row.deletions;
  }
  return { files: inScope.length, additions, deletions };
}

export function stageStateOf(row: Pick<ChangeRow, 'staged' | 'unstaged'>): StageState {
  if (row.staged && row.unstaged) return 'partial';
  return row.staged ? 'staged' : 'unstaged';
}

/** A fully staged file unstages; anything with unstaged edits stages the rest. */
export function nextStageAction(row: Pick<ChangeRow, 'staged' | 'unstaged'>): 'stage' | 'unstage' {
  return stageStateOf(row) === 'staged' ? 'unstage' : 'stage';
}

export function isSectionExpanded(
  path: string,
  index: number,
  overrides: ReadonlyMap<string, boolean>,
): boolean {
  return overrides.get(path) ?? index < DEFAULT_EXPANDED_FILES;
}
