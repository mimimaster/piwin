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
 * Failed tools still contribute when the host set changedPaths; otherwise
 * only non-error write-like tools contribute via targetPaths fallback.
 */
export function collectMessageChangedFiles(tools: ToolCardUi[]): MessageChangedFile[] {
  const seen = new Set<string>();
  const files: MessageChangedFile[] = [];

  for (const tool of tools) {
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

    if (tool.status === 'error') {
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

export type MessageChangedFileStats = {
  additions: number;
  deletions: number;
  /** Paths that had a matching git diff-summary entry. */
  matchedPaths: string[];
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
export function matchChangedFileStats(
  changedFiles: MessageChangedFile[],
  gitFiles: Array<{ path: string; additions: number; deletions: number }>,
): MessageChangedFileStats {
  let additions = 0;
  let deletions = 0;
  const matchedPaths: string[] = [];

  for (const file of changedFiles) {
    const match = gitFiles.find((entry) => pathsReferToSameFile(file.path, entry.path));
    if (!match) continue;
    additions += match.additions;
    deletions += match.deletions;
    matchedPaths.push(file.path);
  }

  return { additions, deletions, matchedPaths };
}
