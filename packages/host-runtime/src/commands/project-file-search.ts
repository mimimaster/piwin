/**
 * Bounded project file search behind `project/find-file`.
 *
 * A Desktop path chip carries whatever text the agent wrote, which is often
 * only a file name (`shot.png`) while the file sits in a subfolder. Reporting
 * that plain miss as "file not found" is wrong: the file exists, the *message*
 * was just not a full path.
 *
 * The walk therefore stays inside the browse root, reuses the file tree's
 * ignored directories, never follows symlinks, and stops at a visited-entry
 * budget so a click cannot turn into an unbounded scan of a monorepo.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_FIND_FILE_MAX_MATCHES,
  PROJECT_FIND_FILE_MAX_VISITED,
  type ProjectFileMatch,
} from '@piwin/contracts';
import { IGNORED_DIR_NAMES } from '../project-browse-ignore.js';

/** Directory nesting the walk may reach below the browse root. */
const MAX_SEARCH_DEPTH = 24;

export type ProjectFileSearchInput = {
  /** Browse root from `requireBrowseRoot` (already validated). */
  rootAbsolute: string;
  /** File name, or a relative path fragment that contains `/`. */
  query: string;
  maxMatches?: number | undefined;
  maxVisited?: number | undefined;
};

export type ProjectFileSearchResult = {
  /** Normalized query actually used (posix-style, no leading slash). */
  query: string;
  matches: ProjectFileMatch[];
  /** True when a budget stopped the walk before it finished. */
  truncated: boolean;
};

/** Trimmed posix-style relative input without leading `./`, leading or trailing `/`. */
export function normalizeProjectFileQuery(query: string): string {
  return query
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Match rule. A bare name matches the basename at any depth; anything with a
 * directory part must line up on path segments (so `shots/a.png` also matches
 * `docs/design/inkstone/shots/a.png`, but never `xshots/a.png`).
 */
export function projectFileQueryMatches(relativePath: string, query: string): boolean {
  if (!query) {
    return false;
  }
  if (!query.includes('/')) {
    return path.posix.basename(relativePath) === query;
  }
  return relativePath === query || relativePath.endsWith(`/${query}`);
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, fallback);
}

/** Shallowest match wins; equal depth falls back to path order. */
function compareMatches(left: ProjectFileMatch, right: ProjectFileMatch): number {
  const leftDepth = left.relativePath.split('/').length;
  const rightDepth = right.relativePath.split('/').length;
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

export async function searchProjectFiles(
  input: ProjectFileSearchInput,
): Promise<ProjectFileSearchResult> {
  const query = normalizeProjectFileQuery(input.query);
  const maxMatches = clampLimit(input.maxMatches, PROJECT_FIND_FILE_MAX_MATCHES);
  const maxVisited = clampLimit(input.maxVisited, PROJECT_FIND_FILE_MAX_VISITED);
  const matches: ProjectFileMatch[] = [];
  const pending: Array<{ relativeDir: string; depth: number }> = [{ relativeDir: '', depth: 0 }];
  let visited = 0;
  let truncated = false;

  search: while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      break;
    }
    let dirents;
    try {
      dirents = await readdir(path.join(input.rootAbsolute, current.relativeDir), {
        withFileTypes: true,
      });
    } catch {
      // Unreadable directory (permissions, races) is not a search failure.
      continue;
    }
    // Deterministic order: the same project always yields the same list.
    dirents.sort((left, right) => left.name.localeCompare(right.name));

    for (const dirent of dirents) {
      visited += 1;
      if (visited > maxVisited) {
        truncated = true;
        break search;
      }
      const relativePath = current.relativeDir
        ? `${current.relativeDir}/${dirent.name}`
        : dirent.name;
      if (dirent.isDirectory()) {
        if (current.depth + 1 <= MAX_SEARCH_DEPTH && !IGNORED_DIR_NAMES.has(dirent.name)) {
          pending.push({ relativeDir: relativePath, depth: current.depth + 1 });
        }
        continue;
      }
      // `isFile()` is false for symlinks and sockets — the walk never leaves
      // the browse root through a link.
      if (!dirent.isFile() || !projectFileQueryMatches(relativePath, query)) {
        continue;
      }
      const match: ProjectFileMatch = { relativePath };
      try {
        const fileStats = await stat(path.join(input.rootAbsolute, relativePath));
        match.sizeBytes = fileStats.size;
      } catch {
        /* size optional */
      }
      matches.push(match);
      if (matches.length >= maxMatches) {
        truncated = true;
        break search;
      }
    }
  }

  matches.sort(compareMatches);
  return { query, matches, truncated };
}
