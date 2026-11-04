import type { KnowledgeContextRef, KnowledgeSelectionAnchor } from '@piwin/contracts';

/**
 * Turn a DOM selection inside the reader into a library anchor.
 *
 * The reader renders a bounded window starting at `windowStartLine`, so every
 * `data-line-id` the Markdown renderer stamped is window-relative. The offset
 * is applied here, once, so callers never add it themselves and the anchor
 * always points at a line number the Host can re-read.
 */

/** Shared by the Markdown renderer, the plain-text reader and any future block. */
const ANCHOR_LINE_PATTERN = /^(?:heading|paragraph|quote|list-item|table|code|math|line)-(\d+)-/;

/** Matches the toolbar's own cap; the Host re-bounds whatever we send. */
const MAX_SNAPSHOT_CHARS = 4000;

/** The 1-based line a block belongs to, or null when the node is not anchored. */
export function lineNumberFromAnchor(node: Node | null): number | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const lineId = element?.closest('[data-line-id]')?.getAttribute('data-line-id');
  if (!lineId) return null;
  const match = ANCHOR_LINE_PATTERN.exec(lineId);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type KnowledgeSelectionAnchorInput = {
  baseId: string;
  relativePath: string;
  /** Absolute 1-based line of the first line currently rendered. */
  windowStartLine: number;
};

/**
 * Null when the selection is empty or outside any anchored block — the caller
 * shows no menu rather than guessing at a line range.
 */
export function knowledgeSelectionAnchorFromRange(
  range: Range,
  input: KnowledgeSelectionAnchorInput,
): KnowledgeSelectionAnchor | null {
  const raw = range.toString();
  const text = raw.trim();
  if (!text) return null;

  const windowStartLine = Math.max(1, input.windowStartLine);
  const offset = windowStartLine - 1;
  const startLine = lineNumberFromAnchor(range.startContainer);
  const endLine = lineNumberFromAnchor(range.endContainer);

  const lineStart = startLine === null ? windowStartLine : startLine + offset;
  const lineEnd = Math.max(
    lineStart,
    endLine === null ? lineStart : endLine + offset,
  );

  return {
    baseId: input.baseId,
    scope: 'selection',
    relativePath: input.relativePath,
    lineStart,
    lineEnd,
    snapshotText:
      text.length > MAX_SNAPSHOT_CHARS ? text.slice(0, MAX_SNAPSHOT_CHARS) : text,
    label: lineEnd > lineStart ? `${input.relativePath} · ${lineStart}–${lineEnd}` : `${input.relativePath} · ${lineStart}`,
  };
}

export function knowledgeContextRefFromAnchor(
  anchor: KnowledgeSelectionAnchor,
): KnowledgeContextRef {
  return { kind: 'knowledge-selection', ...anchor };
}
