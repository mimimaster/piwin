import type { WebFetchResult } from '@piwin/contracts';

const BODY_SEPARATOR = '\n---\n';

/**
 * Model-facing `web_fetch` output: metadata lines + raw extracted text.
 * Avoids JSON-escaping markdown / newlines.
 */
export function formatWebFetchOutput(result: WebFetchResult): string {
  const lines: string[] = [
    `url: ${result.url}`,
    `finalUrl: ${result.finalUrl}`,
  ];
  if (result.title) {
    lines.push(`title: ${result.title}`);
  }
  lines.push(`contentType: ${result.contentType}`);
  if (result.provider) {
    lines.push(`provider: ${result.provider}`);
  }
  if (result.extraction) {
    lines.push(`extraction: ${result.extraction}`);
  }
  lines.push(`byteSize: ${String(result.byteSize)}`);
  if (result.totalChars !== undefined) {
    lines.push(`totalChars: ${String(result.totalChars)}`);
  }
  if (result.range) {
    lines.push(`range: ${String(result.range.start)}-${String(result.range.end)}`);
  }
  if (result.hasMore !== undefined) {
    lines.push(`hasMore: ${String(result.hasMore)}`);
  }
  if (result.nextOffset !== undefined) {
    lines.push(`nextOffset: ${String(result.nextOffset)}`);
  }
  if (result.fromCache !== undefined) {
    lines.push(`fromCache: ${String(result.fromCache)}`);
  }
  lines.push(`truncated: ${String(result.truncated)}`);
  if (result.truncationReason) {
    lines.push(`truncationReason: ${result.truncationReason}`);
  }
  if (result.pageCount !== undefined) {
    lines.push(`pageCount: ${String(result.pageCount)}`);
  }
  if (result.thinContent === true) {
    lines.push('thinContent: true');
    lines.push(
      'note: extracted text looks JS-rendered; set fetchFallback=jina or switch the fetch provider',
    );
  }
  if (result.spillPath) {
    lines.push(`spillPath: ${result.spillPath}`);
    lines.push('note: full extracted text is on disk; use read_file or grep on spillPath');
  }
  if (result.outline && result.outline.length > 0) {
    lines.push('');
    lines.push('outline:');
    for (const heading of result.outline) {
      lines.push(`- ${heading}`);
    }
  }
  return `${lines.join('\n')}${BODY_SEPARATOR}${result.text}`;
}
