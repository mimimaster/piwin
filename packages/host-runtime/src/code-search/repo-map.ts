/**
 * Repo map for the `code_search` subagent prompt.
 *
 * Devin's own repo-map wrapper is not in the binary, but the subagent prompt
 * explicitly tells the model to orient itself with `tree`, so the loop hands it
 * a bounded tree up front instead of spending its first round on one. Depth
 * falls back until the map fits the byte budget, and the final fallback is a
 * top-level listing rather than an empty prompt.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderTreeLines } from './tree-render.js';

/** Byte budget for a rendered repo map. */
export const DEFAULT_CODE_SEARCH_REPO_MAP_MAX_BYTES = 250 * 1024;

/** Line budget, so a pathological directory cannot flood the prompt. */
export const DEFAULT_CODE_SEARCH_REPO_MAP_MAX_LINES = 4_000;

/** Small repos get more depth; large ones start shallow. */
const SMALL_REPO_ENTRIES = 500;
const MEDIUM_REPO_ENTRIES = 5_000;

/**
 * Depth heuristic by top-level entry count. Mirrors the reference behaviour
 * (small → 4, medium → 3, large → 2) and is piwin's own calibration, not a
 * value read out of Devin.
 */
export function suggestRepoMapDepth(topLevelEntryCount: number): number {
  if (topLevelEntryCount < SMALL_REPO_ENTRIES) {
    return 4;
  }
  if (topLevelEntryCount <= MEDIUM_REPO_ENTRIES) {
    return 3;
  }
  return 2;
}

async function countTopLevelEntries(root: string): Promise<number> {
  try {
    return (await readdir(root)).length;
  } catch {
    return 0;
  }
}

export type CodeSearchRepoMap = {
  text: string;
  /** Depth actually rendered. */
  depth: number;
  /** True when the requested depth did not fit and a shallower one was used. */
  fellBack: boolean;
  /** True when even the line budget was hit. */
  truncated: boolean;
};

/**
 * Render a project tree for the subagent prompt.
 *
 * `depth: 0` selects the heuristic depth. Depths are tried from the requested
 * value down to 1 until the result fits both budgets.
 */
export async function buildCodeSearchRepoMap(input: {
  root: string;
  depth?: number;
  excludePaths: readonly string[];
  maxBytes?: number;
  maxLines?: number;
}): Promise<CodeSearchRepoMap> {
  const root = resolve(input.root);
  const maxBytes = input.maxBytes ?? DEFAULT_CODE_SEARCH_REPO_MAP_MAX_BYTES;
  const maxLines = input.maxLines ?? DEFAULT_CODE_SEARCH_REPO_MAP_MAX_LINES;
  const requestedDepth =
    input.depth && input.depth > 0
      ? Math.min(6, Math.trunc(input.depth))
      : suggestRepoMapDepth(await countTopLevelEntries(root));

  let lastResult: CodeSearchRepoMap | undefined;
  for (let depth = requestedDepth; depth >= 1; depth -= 1) {
    const { lines, truncated } = await renderTreeLines({
      root,
      startAbsolute: root,
      label: '/codebase',
      levels: depth,
      excludePaths: input.excludePaths,
      maxLines,
    });
    const text = lines.join('\n');
    const candidate: CodeSearchRepoMap = {
      text,
      depth,
      fellBack: depth < requestedDepth,
      truncated,
    };
    if (Buffer.byteLength(text, 'utf-8') <= maxBytes) {
      return candidate;
    }
    lastResult = candidate;
  }

  return (
    lastResult ?? {
      text: '/codebase',
      depth: 0,
      fellBack: true,
      truncated: false,
    }
  );
}
