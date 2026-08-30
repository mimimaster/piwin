/**
 * Aggregate files mutated by tools on a single assistant message.
 *
 * Priority (aligned with walkthrough-source §9.2):
 * 1. presentation.changedPaths (host-authoritative)
 * 2. write-like tools' presentation.targetPaths (legacy / fallback)
 *
 * Never invents paths from free text. Read-only tools are ignored unless the
 * host already marked changedPaths.
 */
import type { ToolPresentation } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';

export type MessageChangedFile = {
  path: string;
  /** Basename for compact display. */
  name: string;
};

const WRITE_LIKE_NAMES = new Set(['write', 'edit', 'apply_patch', 'write_file', 'str_replace']);

export function isWriteLikeToolName(toolName: string, presentation?: ToolPresentation): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (WRITE_LIKE_NAMES.has(normalized)) {
    return true;
  }
  if (
    normalized.includes('write') ||
    normalized.includes('edit') ||
    normalized.includes('replace') ||
    normalized.includes('patch')
  ) {
    return true;
  }
  if (presentation?.actionVerb === 'Edited') {
    return true;
  }
  if (
    presentation?.kind === 'filesystem' &&
    presentation.actionVerb?.toLowerCase().includes('edit')
  ) {
    return true;
  }
  return false;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Collect unique changed file paths from tools attached to one message.
 * Error tools are skipped; non-error tools prefer host changedPaths, falling
 * back to targetPaths for write-like tools.
 */
export function collectMessageChangedFiles(tools: ToolCardUi[]): MessageChangedFile[] {
  const seen = new Set<string>();
  const files: MessageChangedFile[] = [];

  for (const tool of tools) {
    if (tool.status === 'error') {
      continue;
    }
    const presentation = tool.presentation;
    const fromChanged = presentation?.changedPaths?.filter((p) => p.trim().length > 0) ?? [];
    if (fromChanged.length > 0) {
      for (const path of fromChanged) {
        if (seen.has(path)) continue;
        seen.add(path);
        files.push({ path, name: basename(path) });
      }
      continue;
    }

    if (!isWriteLikeToolName(tool.toolName, presentation)) {
      continue;
    }
    const fromTargets = presentation?.targetPaths?.filter((p) => p.trim().length > 0) ?? [];
    for (const path of fromTargets) {
      if (seen.has(path)) continue;
      seen.add(path);
      files.push({ path, name: basename(path) });
    }
  }

  return files;
}

export type MessageChangedFileStat = {
  additions: number;
  deletions: number;
  status?: string;
};

export type MessageChangedFileStats = {
  additions: number;
  deletions: number;
  /** Paths that had a matching git diff-summary entry. */
  matchedPaths: string[];
  /** Per-file diff stats keyed by file.path. */
  byPath: Record<string, MessageChangedFileStat>;
};

/** Exact path or one path is a suffix of the other at a path boundary. */
function pathsReferToSameFile(a: string, b: string): boolean {
  if (a === b) return true;
  const normA = a.replace(/\\/g, '/');
  const normB = b.replace(/\\/g, '/');
  if (normA === normB) return true;
  return normA.endsWith(`/${normB}`) || normB.endsWith(`/${normA}`);
}

/**
 * Filter a git diff-summary file list to the turn's changed paths and sum stats.
 * Paths are matched by exact string or by suffix (repo-relative vs absolute).
 */
import { extractContentFieldFromInputPreview } from './resolve-document-content';

/**
 * Filter a git diff-summary file list to the turn's changed paths and sum stats.
 * Paths are matched by exact string or by suffix (repo-relative vs absolute).
 */
export function matchChangedFileStats(
  changedFiles: MessageChangedFile[],
  gitFiles: Array<{ path: string; additions: number; deletions: number; status?: string }>,
): MessageChangedFileStats {
  let additions = 0;
  let deletions = 0;
  const matchedPaths: string[] = [];
  const byPath: Record<string, MessageChangedFileStat> = {};

  for (const file of changedFiles) {
    const match = gitFiles.find((entry) => pathsReferToSameFile(file.path, entry.path));
    if (!match) continue;
    additions += match.additions;
    deletions += match.deletions;
    matchedPaths.push(file.path);
    byPath[file.path] = {
      additions: match.additions,
      deletions: match.deletions,
      ...(match.status ? { status: match.status } : {}),
    };
  }

  return { additions, deletions, matchedPaths, byPath };
}

export function deriveFallbackStatsForTools(
  tools: ToolCardUi[],
  files: MessageChangedFile[],
  existingStats?: MessageChangedFileStats | null,
): MessageChangedFileStats {
  let additions = existingStats?.additions ?? 0;
  let deletions = existingStats?.deletions ?? 0;
  const matchedPaths = [...(existingStats?.matchedPaths ?? [])];
  const byPath: Record<string, MessageChangedFileStat> = {
    ...(existingStats?.byPath ?? {}),
  };

  for (const file of files) {
    if (byPath[file.path]) continue;

    let fileAdd = 1;
    let fileDel = 0;

    for (const tool of tools) {
      const presentation = tool.presentation;
      const targets = [
        ...(presentation?.targetPaths ?? []),
        ...(presentation?.changedPaths ?? []),
      ];
      if (targets.some((t) => pathsReferToSameFile(file.path, t))) {
        const content = extractContentFieldFromInputPreview(presentation?.inputPreview);
        if (content) {
          fileAdd = Math.max(1, content.split('\n').length);
        }
        break;
      }
    }

    additions += fileAdd;
    deletions += fileDel;
    matchedPaths.push(file.path);
    byPath[file.path] = { additions: fileAdd, deletions: fileDel, status: 'modified' };
  }

  return { additions, deletions, matchedPaths, byPath };
}
