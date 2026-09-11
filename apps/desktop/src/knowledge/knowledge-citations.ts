/**
 * Knowledge citation markers in assistant replies.
 *
 * Replies cite retrieved passages as `[n]`. Markers are linked only when every
 * ref resolves, so an unmatched `[n]` stays plain text. Pure text logic: no
 * transcript or tool types, so Markdown rendering stays free of chat imports.
 */
import type { KnowledgeCitation } from '@piwin/contracts';

export type KnowledgeCitationIndex = ReadonlyMap<number, KnowledgeCitation>;

export const EMPTY_KNOWLEDGE_CITATION_INDEX: KnowledgeCitationIndex = new Map();

/**
 * An absolute, parseable URL: rehype-harden blocks relative hrefs such as
 * `#kb-cite-1`. The anchor renderer intercepts it, so it never navigates.
 */
const CITATION_HREF_PREFIX = 'https://kb-cite.piwin.invalid/';
/** `[1]` or `[1, 2]`; never a link `[1](…)` or a definition `[1]:`. Footnotes `[^1]` do not match. */
const MARKER_PATTERN = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:])/g;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;

export function knowledgeCitationHref(ref: number): string {
  return `${CITATION_HREF_PREFIX}${ref}`;
}

export function parseKnowledgeCitationHref(href: string | undefined): number | null {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return null;
  const ref = Number(href.slice(CITATION_HREF_PREFIX.length));
  return Number.isInteger(ref) && ref > 0 ? ref : null;
}

export function linkKnowledgeCitationMarkers(
  markdown: string,
  index: KnowledgeCitationIndex,
): string {
  if (index.size === 0 || !markdown.includes('[')) return markdown;
  return mapProse(markdown, (prose) =>
    prose.replace(MARKER_PATTERN, (marker: string, body: string, offset: number, whole: string) => {
      const previous = offset > 0 ? whole.charAt(offset - 1) : '';
      // `[label][1]` reference links, `![1]` images, and escaped `\[1]` stay as written.
      if (previous === ']' || previous === '!' || previous === '\\') return marker;
      const refs = refsFromMarker(body);
      if (!refs.every((ref) => index.has(ref))) return marker;
      return refs.map((ref) => `[${ref}](${knowledgeCitationHref(ref)})`).join('');
    }),
  );
}

/** Resolved refs in first-appearance order, ignoring code. */
export function citedKnowledgeRefs(markdown: string, index: KnowledgeCitationIndex): number[] {
  if (index.size === 0 || !markdown.includes('[')) return [];
  const seen = new Set<number>();
  mapProse(markdown, (prose) => {
    for (const match of prose.matchAll(MARKER_PATTERN)) {
      for (const ref of refsFromMarker(match[1] ?? '')) {
        if (index.has(ref)) seen.add(ref);
      }
    }
    return prose;
  });
  return [...seen];
}

export function citationsForRefs(
  index: KnowledgeCitationIndex,
  refs: readonly number[],
): KnowledgeCitation[] {
  return refs.flatMap((ref) => {
    const citation = index.get(ref);
    return citation ? [citation] : [];
  });
}

export function knowledgeCitationLocation(citation: KnowledgeCitation): string | null {
  if (citation.pageStart !== undefined) {
    return citation.pageEnd !== undefined && citation.pageEnd !== citation.pageStart
      ? `p.${citation.pageStart}–${citation.pageEnd}`
      : `p.${citation.pageStart}`;
  }
  if (citation.startLine !== undefined) {
    return citation.endLine !== undefined && citation.endLine !== citation.startLine
      ? `L${citation.startLine}–${citation.endLine}`
      : `L${citation.startLine}`;
  }
  return null;
}

function refsFromMarker(body: string): number[] {
  return body.split(',').map((part) => Number(part.trim()));
}

/** Apply `visit` to prose only; fenced blocks and inline code spans pass through untouched. */
function mapProse(markdown: string, visit: (prose: string) => string): string {
  const output: string[] = [];
  let prose: string[] = [];
  let openFence: string | null = null;
  const flushProse = () => {
    if (prose.length === 0) return;
    output.push(mapInlineProse(prose.join('\n'), visit));
    prose = [];
  };
  for (const line of markdown.split('\n')) {
    if (openFence !== null) {
      output.push(line);
      const close = FENCE_OPEN.exec(line)?.[1];
      if (
        close !== undefined &&
        line.trim() === close &&
        close.charAt(0) === openFence.charAt(0) &&
        close.length >= openFence.length
      ) {
        openFence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line)?.[1];
    if (open !== undefined) {
      flushProse();
      openFence = open;
      output.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return output.join('\n');
}

function mapInlineProse(text: string, visit: (prose: string) => string): string {
  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    const start = match.index ?? 0;
    result += visit(text.slice(cursor, start)) + match[0];
    cursor = start + match[0].length;
  }
  return result + visit(text.slice(cursor));
}
