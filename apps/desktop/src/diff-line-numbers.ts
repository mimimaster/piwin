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

export function computeDiffLineNumbers(lines: ParsedDiffLine[]): DiffLineNumbers[] {
  let oldLine = 0;
  let newLine = 0;
  const out: DiffLineNumbers[] = [];

  for (const line of lines) {
    if (line.kind === 'hunk') {
      const match = HUNK_HEADER.exec(line.text);
      if (match) {
        // Hunk start lines are 1-based; the header reports the first line
        // number of the hunk. Counters begin at start (the next context/del
        // line maps to that number), so set to start - 1 and let the per-line
        // increment land on the correct value.
        oldLine = (Number(match[1]) || 1) - 1;
        newLine = (Number(match[3]) || 1) - 1;
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
