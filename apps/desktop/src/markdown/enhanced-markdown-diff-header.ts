import type { DiffActionType } from './enhanced-markdown-types.js';

export type EnhancedDiffHeader = {
  action: DiffActionType;
  /** Upper-cased file kind badge, when the line names one or the path has one. */
  ext: string | undefined;
  path: string;
};

const DIFF_HEADER_PATTERN =
  /^\[(MODIFY|NEW|DELETE|RENAME)\]\s*(?:(?:`?([A-Za-z0-9_-]+)`?|\[([A-Za-z0-9_-]+)\])\s+)?(.*)$/i;

/**
 * Reads a plan's file-change line: `[MODIFY] TS src/a.ts`, `[NEW] src/b.ts`,
 * `[DELETE] [css] old.css`. Returns null when the text is not one, including
 * an action with no path after it.
 */
export function parseEnhancedDiffHeader(text: string): EnhancedDiffHeader | null {
  const match = DIFF_HEADER_PATTERN.exec(text.trim());
  if (!match?.[1]) return null;
  const action = match[1].toUpperCase() as DiffActionType;
  let ext = match[2] || match[3] || '';
  let path = (match[4] ?? '').trim();
  const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(path);
  if (linkMatch?.[1]) {
    path = linkMatch[1];
  }
  if (path.length === 0) return null;
  if (!ext) {
    ext = /\.([a-zA-Z0-9]+)$/.exec(path)?.[1] ?? '';
  }
  return { action, ext: ext ? ext.toUpperCase() : undefined, path };
}

/** Every non-empty line is a file-change line, or null. */
export function parseEnhancedDiffHeaderLines(text: string): EnhancedDiffHeader[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const headers: EnhancedDiffHeader[] = [];
  for (const line of lines) {
    const header = parseEnhancedDiffHeader(line);
    if (!header) return null;
    headers.push(header);
  }
  return headers;
}
