/**
 * Bounded worktree + index summary against HEAD.
 *
 * Line counts come from `git diff --numstat`; per-file status must come from
 * `git diff --name-status` (and porcelain untracked). Numstat counts alone
 * cannot distinguish a tracked edit that only adds lines from a new file.
 */
import type {
  GitChangedFile,
  GitDiffFileStat,
  GitDiffSummary,
  GitFileStatusCode,
  GitRepositoryIdentity,
} from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';
import { parsePorcelainStatus } from './status-parser.js';

export type ReadGitDiffSummaryOptions = {
  repository: GitRepositoryIdentity;
  maxFiles?: number;
};

export type GitNumstatRow = {
  path: string;
  previousPath?: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
};

export type GitNameStatusRow = {
  path: string;
  previousPath?: string;
  status: GitFileStatusCode;
};

export async function readGitDiffSummary(
  options: ReadGitDiffSummaryOptions,
): Promise<GitDiffSummary> {
  if (!options.repository.isRepository) {
    return emptySummary(options.repository);
  }

  const maxFiles = options.maxFiles ?? 500;
  const cwd = options.repository.rootPath;
  const [nameStatusStdout, numstatStdout, porcelainResult] = await Promise.all([
    readDiffAgainstHead(cwd, '--name-status'),
    readDiffAgainstHead(cwd, '--numstat'),
    runGitCommand({
      cwd,
      args: ['status', '--porcelain=v1'],
      allowFailure: true,
    }),
  ]);

  const files = mergeDiffSummaryFiles(
    parseNameStatus(nameStatusStdout),
    parseNumstat(numstatStdout),
    parsePorcelainStatus(porcelainResult.stdout).changedFiles,
  );
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

export function parseNameStatus(stdout: string): GitNameStatusRow[] {
  const files: GitNameStatusRow[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const statusRaw = parts[0];
    if (statusRaw === undefined || parts.length < 2) {
      continue;
    }
    const status = mapNameStatusCode(statusRaw);
    if (status === 'renamed' || status === 'copied') {
      const previousPath = parts[1]?.trim() ?? '';
      const path = parts.slice(2).join('\t');
      if (!path) {
        continue;
      }
      const row: GitNameStatusRow = { path, status };
      if (previousPath) {
        row.previousPath = previousPath;
      }
      files.push(row);
      continue;
    }
    files.push({
      path: parts.slice(1).join('\t'),
      status,
    });
  }
  return files;
}

export function parseNumstat(stdout: string): GitNumstatRow[] {
  const files: GitNumstatRow[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    // additions\tdeletions\tpath  (binary: -\t-\tpath; rename: old => new)
    const parts = line.split('\t');
    if (parts.length < 3) {
      continue;
    }
    const additionsRaw = parts[0] ?? '0';
    const deletionsRaw = parts[1] ?? '0';
    const pathField = parts.slice(2).join('\t');
    const additions = additionsRaw === '-' ? 0 : Number(additionsRaw);
    const deletions = deletionsRaw === '-' ? 0 : Number(deletionsRaw);
    const { path, previousPath } = splitNumstatPath(pathField);
    const row: GitNumstatRow = {
      path,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      isBinary: additionsRaw === '-' || deletionsRaw === '-',
    };
    if (previousPath !== undefined) {
      row.previousPath = previousPath;
    }
    files.push(row);
  }
  return files;
}

export function mergeDiffSummaryFiles(
  nameStatus: readonly GitNameStatusRow[],
  numstat: readonly GitNumstatRow[],
  porcelainFiles: readonly GitChangedFile[] = [],
): GitDiffFileStat[] {
  const numstatByPath = indexNumstat(numstat);
  const seen = new Set<string>();
  const files: GitDiffFileStat[] = [];

  for (const row of nameStatus) {
    const stats = lookupNumstat(numstatByPath, row.path, row.previousPath);
    files.push({
      path: row.path,
      status: row.status,
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
    });
    markSeen(seen, row.path, row.previousPath);
  }

  for (const row of numstat) {
    if (seen.has(row.path)) {
      continue;
    }
    files.push({
      path: row.path,
      status: 'modified',
      additions: row.additions,
      deletions: row.deletions,
    });
    markSeen(seen, row.path, row.previousPath);
  }

  for (const file of porcelainFiles) {
    if (file.status !== 'untracked' || seen.has(file.path)) {
      continue;
    }
    files.push({
      path: file.path,
      status: 'untracked',
      additions: 0,
      deletions: 0,
    });
    seen.add(file.path);
  }

  return files;
}

async function readDiffAgainstHead(
  cwd: string,
  format: '--name-status' | '--numstat',
): Promise<string> {
  const againstHead = await runGitCommand({
    cwd,
    args: ['diff', format, '-M', 'HEAD'],
    allowFailure: true,
  });
  if (againstHead.exitCode === 0) {
    return againstHead.stdout;
  }
  const fallback = await runGitCommand({
    cwd,
    args: ['diff', format, '-M'],
    allowFailure: true,
  });
  return fallback.stdout;
}

function splitNumstatPath(pathField: string): {
  path: string;
  previousPath?: string;
} {
  const separator = ' => ';
  const index = pathField.indexOf(separator);
  if (index === -1) {
    return { path: pathField };
  }
  const previousPath = pathField.slice(0, index);
  const path = pathField.slice(index + separator.length);
  if (!path) {
    return { path: pathField };
  }
  return { path, previousPath };
}

function mapNameStatusCode(raw: string): GitFileStatusCode {
  switch (raw.charAt(0)) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    case 'U':
      return 'conflicted';
    case '?':
      return 'untracked';
    default:
      return 'unknown';
  }
}

function indexNumstat(rows: readonly GitNumstatRow[]): Map<string, GitNumstatRow> {
  const map = new Map<string, GitNumstatRow>();
  for (const row of rows) {
    map.set(row.path, row);
    if (row.previousPath !== undefined && !map.has(row.previousPath)) {
      map.set(row.previousPath, row);
    }
  }
  return map;
}

function lookupNumstat(
  map: Map<string, GitNumstatRow>,
  path: string,
  previousPath: string | undefined,
): GitNumstatRow | undefined {
  return map.get(path) ?? (previousPath !== undefined ? map.get(previousPath) : undefined);
}

function markSeen(seen: Set<string>, path: string, previousPath: string | undefined): void {
  seen.add(path);
  if (previousPath !== undefined) {
    seen.add(previousPath);
  }
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
