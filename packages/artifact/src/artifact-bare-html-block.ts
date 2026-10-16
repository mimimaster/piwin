/**
 * Recovery for artifacts a model wrote as bare HTML (`<div class="x"><style>…`)
 * with no fence at all. The prompt teaches fences; this keeps the slip from
 * reaching the transcript as escaped HTML source. Recognition is deliberately
 * narrow: a top-level container element whose body uses the artifact theme
 * vars, which ordinary HTML in prose or documentation never does.
 */
import { CANONICAL_ARTIFACT_LANGUAGE } from './constants.js';

/** Fence info a recovered bare block gets; the model gave no title. */
export const BARE_HTML_ARTIFACT_INFO = `${CANONICAL_ARTIFACT_LANGUAGE} style="host"`;

/** Only artifact output references these vars; required before recovering. */
const ARTIFACT_THEME_SIGNAL = '--piwin-artifact-';

const CONTAINER_OPENING = /^ {0,3}<(div|section|article|main)(?=[\s>])/i;

export type BareHtmlLine = {
  start: number;
  text: string;
  newlineLength: number;
};

export type BareHtmlBlock = {
  startOffset: number;
  /** Offset just past the line holding the closing tag; null while streaming. */
  endOffset: number | null;
  /** Offset where the closing fence goes (end of the closing line's text). */
  closingAt: number | null;
  source: string;
  /** Index of the first line after the block. */
  cursor: number;
};

/** Net element depth change on one line for `tagName`, ignoring script bodies. */
function depthDelta(text: string, tagName: string, inScript: { value: boolean }): number {
  let delta = 0;
  const pattern = new RegExp(`<(/?)(${tagName}|script)(?=[\\s>/])`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const closing = match[1] === '/';
    const name = match[2]?.toLowerCase();
    if (name === 'script') {
      inScript.value = !closing;
      continue;
    }
    if (inScript.value) continue;
    delta += closing ? -1 : 1;
  }
  return delta;
}

/**
 * A bare HTML artifact starting at `lines[lineIndex]`: a container element at
 * the line start whose matching close ends the block. Returns null unless the
 * block carries the artifact theme signal, so it also stays null while a
 * streamed block has not yet reached its first theme var.
 */
export function indexBareHtmlBlock(lines: readonly BareHtmlLine[], lineIndex: number): BareHtmlBlock | null {
  const first = lines[lineIndex];
  const tagName = first ? CONTAINER_OPENING.exec(first.text)?.[1]?.toLowerCase() : undefined;
  if (!first || !tagName) return null;
  const inScript = { value: false };
  const contentLines: string[] = [];
  let depth = 0;
  let cursor = lineIndex;
  let endOffset: number | null = null;
  let closingAt: number | null = null;
  while (cursor < lines.length) {
    const current = lines[cursor];
    if (!current) break;
    cursor += 1;
    contentLines.push(current.text);
    depth += depthDelta(current.text, tagName, inScript);
    if (depth <= 0) {
      closingAt = current.start + current.text.trimEnd().length;
      endOffset = current.start + current.text.length + current.newlineLength;
      break;
    }
  }
  const source = contentLines.join('\n');
  if (!source.includes(ARTIFACT_THEME_SIGNAL)) return null;
  return { startOffset: first.start, endOffset, closingAt, source, cursor };
}
