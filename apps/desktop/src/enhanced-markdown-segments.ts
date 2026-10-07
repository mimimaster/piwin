/**
 * Splits a review document into Markdown and the one HTML construct the doc
 * surface renders itself: a top-level `<details>` disclosure.
 *
 * Raw HTML is escaped before the document reaches the Markdown renderer, so a
 * disclosure has to be lifted out first. Only a `<details>` that opens a line
 * outside a code fence counts — prose that merely mentions the tag (inline
 * code, a fenced example) stays ordinary Markdown.
 */
export type EnhancedMarkdownSegment =
  | { type: 'markdown'; text: string; startLine: number }
  | { type: 'details'; summary: string; content: string; startLine: number };

const DEFAULT_DETAILS_SUMMARY = 'Details';
/** CommonMark: a fence or HTML block may be indented by at most three spaces. */
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const DETAILS_OPEN_PATTERN = /^ {0,3}<details(?:\s[^>]*)?>/i;
const DETAILS_CLOSE_PATTERN = /<\/details\s*>/i;
const SUMMARY_PATTERN = /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary\s*>/i;

type OpenFence = { marker: '`' | '~'; length: number };

function readFenceOpen(line: string): OpenFence | null {
  const match = FENCE_OPEN_PATTERN.exec(line);
  const run = match?.[1];
  if (!run) return null;
  return { marker: run.startsWith('`') ? '`' : '~', length: run.length };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  const run = match?.[1];
  return run !== undefined && run.startsWith(fence.marker) && run.length >= fence.length;
}

function countMatches(line: string, pattern: RegExp): number {
  return line.match(new RegExp(pattern.source, 'gi'))?.length ?? 0;
}

/** Body of a disclosure: its lines without the wrapper and summary markup. */
function readDetailsBody(lines: readonly string[]): { summary: string; content: string } {
  const joined = lines.join('\n');
  const summaryMatch = SUMMARY_PATTERN.exec(joined);
  const summary = summaryMatch?.[1]?.replace(/\s+/g, ' ').trim() || DEFAULT_DETAILS_SUMMARY;
  let body = summaryMatch
    ? joined.slice(0, summaryMatch.index) + joined.slice(summaryMatch.index + summaryMatch[0].length)
    : joined;
  body = body.replace(/^ {0,3}<details(?:\s[^>]*)?>/i, '');
  const closeIndex = body.toLowerCase().lastIndexOf('</details');
  if (closeIndex >= 0) {
    body = body.slice(0, closeIndex);
  }
  return { summary, content: body.replace(/^\s*\n/, '').replace(/\s+$/, '') };
}

export function splitEnhancedMarkdownSegments(text: string): EnhancedMarkdownSegment[] {
  const lines = text.split(/\r?\n/);
  const segments: EnhancedMarkdownSegment[] = [];
  let markdownLines: string[] = [];
  let markdownStartLine = 0;
  let fence: OpenFence | null = null;

  const flushMarkdown = (): void => {
    if (markdownLines.some((line) => line.trim().length > 0)) {
      segments.push({
        type: 'markdown',
        text: markdownLines.join('\n'),
        startLine: markdownStartLine,
      });
    }
    markdownLines = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      markdownLines.push(line);
      index += 1;
      continue;
    }
    const opened = readFenceOpen(line);
    if (opened) {
      fence = opened;
      markdownLines.push(line);
      index += 1;
      continue;
    }
    if (!DETAILS_OPEN_PATTERN.test(line)) {
      if (markdownLines.length === 0) markdownStartLine = index;
      markdownLines.push(line);
      index += 1;
      continue;
    }

    flushMarkdown();
    const startLine = index;
    const detailsLines: string[] = [];
    let depth = 0;
    let innerFence: OpenFence | null = null;
    // A disclosure may nest; an unclosed one runs to the end of the document
    // rather than swallowing nothing and printing its tags.
    while (index < lines.length) {
      const current = lines[index] ?? '';
      detailsLines.push(current);
      index += 1;
      if (innerFence) {
        if (closesFence(current, innerFence)) innerFence = null;
        continue;
      }
      const innerOpened = readFenceOpen(current);
      if (innerOpened) {
        innerFence = innerOpened;
        continue;
      }
      depth += countMatches(current, /<details(?:\s[^>]*)?>/);
      depth -= countMatches(current, DETAILS_CLOSE_PATTERN);
      if (depth <= 0) break;
    }
    segments.push({ type: 'details', ...readDetailsBody(detailsLines), startLine });
    markdownStartLine = index;
  }
  flushMarkdown();
  return segments;
}
