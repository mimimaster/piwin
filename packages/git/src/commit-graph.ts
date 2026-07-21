/**
 * Commit history graph (linear parent links) from `git log`.
 * Separate from Pi session tree — never conflate the two in UI.
 */
import type { GitCommitGraph, GitCommitGraphNode, GitRepositoryIdentity } from '@piwin/contracts';
import { runGitCommand } from './git-command-runner.js';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

export type ReadGitCommitGraphOptions = {
  repository: GitRepositoryIdentity;
  /** Default 40. */
  limit?: number;
};

export async function readGitCommitGraph(
  options: ReadGitCommitGraphOptions,
): Promise<GitCommitGraph> {
  if (!options.repository.isRepository) {
    return {
      repository: options.repository,
      nodes: [],
      truncated: false,
    };
  }

  const limit = Math.max(1, Math.min(options.limit ?? 40, 200));
  // Fetch limit+1 to detect truncation
  const result = await runGitCommand({
    cwd: options.repository.rootPath,
    args: [
      'log',
      `--max-count=${limit + 1}`,
      `--pretty=format:%H${FIELD_SEP}%h${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`,
    ],
    allowFailure: true,
  });

  if (result.exitCode !== 0) {
    return {
      repository: options.repository,
      nodes: [],
      truncated: false,
    };
  }

  const nodes = parseGitLogRecords(result.stdout);
  const truncated = nodes.length > limit;
  return {
    repository: options.repository,
    nodes: truncated ? nodes.slice(0, limit) : nodes,
    truncated,
  };
}

export function parseGitLogRecords(stdout: string): GitCommitGraphNode[] {
  const nodes: GitCommitGraphNode[] = [];
  const records = stdout.split(RECORD_SEP);
  for (const record of records) {
    const trimmed = record.replace(/^\n+|\n+$/g, '');
    if (!trimmed) {
      continue;
    }
    const fields = trimmed.split(FIELD_SEP);
    if (fields.length < 6) {
      continue;
    }
    const hash = fields[0] ?? '';
    const shortHash = fields[1] ?? hash.slice(0, 7);
    const parentsRaw = fields[2] ?? '';
    const authorName = fields[3] ?? '';
    const authorDateIso = fields[4] ?? '';
    const subject = fields.slice(5).join(FIELD_SEP);
    if (!hash) {
      continue;
    }
    nodes.push({
      hash,
      shortHash,
      subject,
      authorName,
      authorDateIso,
      parentHashes: parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [],
    });
  }
  return nodes;
}
