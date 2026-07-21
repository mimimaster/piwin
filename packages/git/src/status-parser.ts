/**
 * Pure parsers for `git status --porcelain=v1 -b` output.
 */
import type { GitBranchStatus, GitChangedFile, GitFileStatusCode } from '@piwin/contracts';

export type ParsedGitStatus = {
  branch: GitBranchStatus;
  changedFiles: GitChangedFile[];
};

export function parsePorcelainStatus(stdout: string): ParsedGitStatus {
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  let currentBranch: string | null = null;
  let isDetached = false;
  let headCommit: string | null = null;
  let upstreamBranch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const changedFiles: GitChangedFile[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const header = line.slice(3).trim();
      const detachedMatch = header.match(/^HEAD \(no branch\)(?:\.\.\..*)?$/);
      if (detachedMatch) {
        isDetached = true;
        currentBranch = null;
        continue;
      }

      // e.g. main...origin/main [ahead 1, behind 2]
      const trackingMatch = header.match(
        /^([^\s.]+)(?:\.\.\.([^\s\[]+))?(?:\s+\[([^\]]+)\])?$/,
      );
      if (trackingMatch) {
        currentBranch = trackingMatch[1] ?? null;
        upstreamBranch = trackingMatch[2] ?? null;
        const trackingDetail = trackingMatch[3] ?? '';
        const aheadMatch = trackingDetail.match(/ahead\s+(\d+)/);
        const behindMatch = trackingDetail.match(/behind\s+(\d+)/);
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
        behind = behindMatch ? Number(behindMatch[1]) : 0;
      } else {
        currentBranch = header.split('...')[0] ?? header;
      }
      continue;
    }

    const file = parsePorcelainFileLine(line);
    if (file) {
      changedFiles.push(file);
    }
  }

  return {
    branch: {
      currentBranch,
      isDetached,
      headCommit,
      upstreamBranch,
      ahead,
      behind,
      dirty: changedFiles.length > 0,
    },
    changedFiles,
  };
}

export function parsePorcelainFileLine(line: string): GitChangedFile | null {
  if (line.length < 3) {
    return null;
  }

  // Untracked: "?? path"
  if (line.startsWith('?? ')) {
    return {
      path: line.slice(3),
      status: 'untracked',
      staged: false,
      unstaged: true,
    };
  }

  // XY PATH or XY ORIG -> PATH (rename)
  const xy = line.slice(0, 2);
  const rest = line.slice(3);
  const renameParts = rest.split(' -> ');
  const path = (renameParts[1] ?? renameParts[0] ?? '').trim();
  if (!path) {
    return null;
  }

  const previousPath =
    renameParts.length > 1 ? (renameParts[0] ?? '').trim() : undefined;

  const x = xy[0] ?? ' ';
  const y = xy[1] ?? ' ';
  const staged = x !== ' ' && x !== '?';
  const unstaged = y !== ' ' && y !== '?';

  const file: GitChangedFile = {
    path,
    status: mapStatusCode(x, y),
    staged,
    unstaged,
  };
  if (previousPath) {
    file.previousPath = previousPath;
  }
  return file;
}

function mapStatusCode(x: string, y: string): GitFileStatusCode {
  const code = x !== ' ' && x !== '?' ? x : y;
  switch (code) {
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
