/**
 * Directory-tree rendering shared by the `tree` restricted command and the
 * repo map handed to the search subagent.
 *
 * Extracted so both surfaces walk, sort and exclude identically — a repo map
 * that disagreed with `tree` output would make the subagent's own orientation
 * step misleading. The renderer never leaves `root` and never follows symlinked
 * directories.
 */
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { matchesAnyGlob } from '../glob-match.js';

export type RenderTreeInput = {
  /** Search root; nothing outside it is rendered. */
  root: string;
  /** Absolute directory to start from. */
  startAbsolute: string;
  /** Label for the first line, e.g. `/codebase` or `/codebase/src`. */
  label: string;
  /** Directory levels below the start directory (1 = direct children only). */
  levels: number;
  /** Repo-relative globs that are never rendered. */
  excludePaths: readonly string[];
  /** Stop after this many lines (including the label). */
  maxLines: number;
};

export type RenderTreeResult = {
  lines: string[];
  /** True when {@link RenderTreeInput.maxLines} cut the render short. */
  truncated: boolean;
};

/** Render a directory tree, directories first and lexically sorted. */
export async function renderTreeLines(input: RenderTreeInput): Promise<RenderTreeResult> {
  const root = resolve(input.root);
  const levels = Math.max(1, Math.trunc(input.levels));
  const lines: string[] = [input.label];
  let truncated = false;

  async function render(directory: string, depth: number, prefix: string): Promise<void> {
    if (depth >= levels || truncated) {
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const visible = entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .filter((entry) => {
        const absolutePath = join(directory, entry.name);
        const relativePath = relative(root, absolutePath).replace(/\\/g, '/');
        return !matchesAnyGlob(relativePath, input.excludePaths);
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    for (let index = 0; index < visible.length; index += 1) {
      if (lines.length >= input.maxLines) {
        truncated = true;
        return;
      }
      const entry = visible[index];
      if (!entry) {
        continue;
      }
      const isLast = index === visible.length - 1;
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${entry.name}`);
      if (entry.isDirectory()) {
        await render(join(directory, entry.name), depth + 1, `${prefix}${isLast ? '    ' : '│   '}`);
      }
    }
  }

  await render(input.startAbsolute, 0, '');
  return { lines, truncated };
}
