/**
 * Bounded, exclusion-aware directory discovery for the `code_search` search
 * subagent. Never leaves the search root and never follows symlinked
 * directories, so a restricted command cannot be talked out of its sandbox.
 */
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { matchesAnyGlob } from '../glob-match.js';
import { isInsideRoot } from './codebase-paths.js';

/** Files discovered in one command before the walk gives up. */
export const MAX_SCANNED_FILES = 5_000;

/** Bytes inspected when sniffing for binary content. */
export const BINARY_SNIFF_BYTES = 1_024;

export type WalkedFile = {
  absolutePath: string;
  /** `/`-separated path relative to the search root. */
  relativePath: string;
};

export type WalkResult = {
  files: WalkedFile[];
  directories: string[];
  /** True when {@link MAX_SCANNED_FILES} stopped the walk early. */
  truncated: boolean;
};

export type WalkOptions = {
  /** Collect directory entries too (used by the `glob` command). */
  directories?: boolean;
};

/**
 * Depth-first walk with exclude patterns and a hard file budget. Never leaves
 * the search root and never follows symlinked directories.
 */
export async function walk(
  root: string,
  startAbsolute: string,
  excludePaths: readonly string[],
  options: WalkOptions = {},
): Promise<WalkResult> {
  const files: WalkedFile[] = [];
  const directories: string[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (truncated) {
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const entry of sorted) {
      if (truncated) {
        return;
      }
      const absolutePath = join(directory, entry.name);
      if (!isInsideRoot(root, absolutePath)) {
        continue;
      }
      const relativePath = relative(resolve(root), absolutePath).replace(/\\/g, '/');
      if (matchesAnyGlob(relativePath, excludePaths)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (options.directories) {
          directories.push(relativePath);
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (files.length >= MAX_SCANNED_FILES) {
        truncated = true;
        return;
      }
      files.push({ absolutePath, relativePath });
    }
  }

  try {
    const startStat = await stat(startAbsolute);
    if (startStat.isFile()) {
      const relativePath = relative(resolve(root), startAbsolute).replace(/\\/g, '/');
      return { files: [{ absolutePath: startAbsolute, relativePath }], directories, truncated };
    }
    if (!startStat.isDirectory()) {
      return { files, directories, truncated };
    }
  } catch {
    return { files, directories, truncated };
  }

  await visit(startAbsolute);
  return { files, directories, truncated };
}
