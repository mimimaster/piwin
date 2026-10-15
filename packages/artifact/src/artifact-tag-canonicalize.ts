/**
 * Rewrite tag-form artifacts (`<artifact-html …>…</artifact-html>`) into the
 * canonical fence before any Markdown renderer or raw-HTML escaper sees them.
 * Fence ordinals are unchanged, so records indexed on the raw text still line
 * up with records indexed on the canonical text.
 */
import { indexArtifactFences, type ArtifactFenceRecord } from './fence-index.js';

const LINE_START_BACKTICKS = /^ {0,3}(`{3,})/gm;

/** A backtick run longer than any fence-like run inside the body. */
function fenceMarkerFor(source: string): string {
  let longest = 2;
  for (const match of source.matchAll(LINE_START_BACKTICKS)) {
    longest = Math.max(longest, match[1]?.length ?? 0);
  }
  return '`'.repeat(longest + 1);
}

function isLineStart(markdown: string, offset: number): boolean {
  const lineStart = markdown.lastIndexOf('\n', offset - 1) + 1;
  return markdown.slice(lineStart, offset).trim() === '';
}

function isLineEnd(markdown: string, offset: number): boolean {
  const newline = markdown.indexOf('\n', offset);
  return markdown.slice(offset, newline === -1 ? markdown.length : newline).trim() === '';
}

function rewriteTagBlock(markdown: string, fence: ArtifactFenceRecord, parts: string[], copiedTo: number): number {
  const range = fence.tagBlock;
  if (!range) return copiedTo;
  const marker = fenceMarkerFor(fence.source);
  parts.push(markdown.slice(copiedTo, fence.startOffset), `${marker}${fence.info}`);
  if (!isLineEnd(markdown, range.openingEnd)) parts.push('\n');
  if (!range.closing) return range.openingEnd;
  parts.push(markdown.slice(range.openingEnd, range.closing.start));
  if (!isLineStart(markdown, range.closing.start)) parts.push('\n');
  parts.push(marker);
  return range.closing.end;
}

export function canonicalizeArtifactTagBlocks(markdown: string): string {
  const tagged = indexArtifactFences(markdown).filter((fence) => fence.tagBlock);
  if (tagged.length === 0) return markdown;
  const parts: string[] = [];
  let copiedTo = 0;
  for (const fence of tagged) {
    copiedTo = rewriteTagBlock(markdown, fence, parts, copiedTo);
  }
  parts.push(markdown.slice(copiedTo));
  return parts.join('');
}
