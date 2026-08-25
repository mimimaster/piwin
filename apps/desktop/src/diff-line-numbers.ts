/**
 * Compute real old/new file line numbers for each line of a unified diff.
 *
 * A unified diff hunk header looks like `@@ -12,7 +15,9 @@`. We walk the
 * parsed lines and track two counters — `oldLine` (original file) and
 * `newLine` (modified file) — incrementing per line kind:
 *   - context: both advance
 *   - del:     old advances
 *   - add:     new advances
 *   - meta/hunk/blank: neither advances
 *
 * Returns per-line `{ old: number | null; new: number | null }` so renderers
 * can show a two-column gutter (GitHub-style) or just the relevant column.
 */
import type { ParsedDiffLine } from './diff-view';

export type DiffLineNumbers = {
  old: number | null;
  new: number | null;
};

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

type DiffHunkRange = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

function parseHunkRange(text: string): DiffHunkRange | null {
  const match = HUNK_HEADER.exec(text);
  if (!match) return null;

  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  };
}

export function computeDiffLineNumbers(lines: ParsedDiffLine[]): DiffLineNumbers[] {
  let oldLine = 0;
  let newLine = 0;
  const out: DiffLineNumbers[] = [];

  for (const line of lines) {
    if (line.kind === 'hunk') {
      const range = parseHunkRange(line.text);
      if (range) {
        // Hunk start lines are 1-based; the header reports the first line
        // number of the hunk. Counters begin at start (the next context/del
        // line maps to that number), so set to start - 1 and let the per-line
        // increment land on the correct value.
        oldLine = range.oldStart - 1;
        newLine = range.newStart - 1;
      }
      out.push({ old: null, new: null });
      continue;
    }

    if (line.kind === 'meta' || line.kind === 'blank') {
      out.push({ old: null, new: null });
      continue;
    }

    if (line.kind === 'context') {
      oldLine += 1;
      newLine += 1;
      out.push({ old: oldLine, new: newLine });
      continue;
    }

    if (line.kind === 'del') {
      oldLine += 1;
      out.push({ old: oldLine, new: null });
      continue;
    }

    if (line.kind === 'add') {
      newLine += 1;
      out.push({ old: null, new: newLine });
      continue;
    }

    out.push({ old: null, new: null });
  }

  return out;
}

/**
 * Return the unchanged lines omitted before each hunk header.
 *
 * Git emits only a small amount of context around a change. The distance
 * between adjacent hunk ranges is therefore the exact amount of unchanged
 * source hidden by the patch, and is equal on the old and new sides.
 */
export function computeOmittedLineCounts(lines: ParsedDiffLine[]): Array<number | null> {
  let previousRange: DiffHunkRange | null = null;

  return lines.map((line) => {
    if (line.kind !== 'hunk') return null;

    const range = parseHunkRange(line.text);
    if (!range) return null;

    const previousOldEnd = previousRange ? previousRange.oldStart + previousRange.oldCount : 1;
    const previousNewEnd = previousRange ? previousRange.newStart + previousRange.newCount : 1;
    const oldGap = range.oldStart - previousOldEnd;
    const newGap = range.newStart - previousNewEnd;
    previousRange = range;

    return Math.max(0, Math.min(oldGap, newGap));
  });
}
