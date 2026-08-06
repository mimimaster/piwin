/**
 * Render the result of Pi compaction as a small, portable Markdown document.
 *
 * This is intentionally separate from the full transcript exporter: compact
 * export is a summary snapshot, while `session/export` remains the complete
 * product transcript export.
 */

export type ExportCompactionMarkdownOptions = {
  summary: string;
};

/**
 * Convert a successful Pi compact result into Markdown without doing any I/O.
 */
export function exportCompactionMarkdown(options: ExportCompactionMarkdownOptions): string {
  const summary = options.summary.trim();
  return `${summary || '_(Pi compact returned no summary.)_'}\n`;
}

/** Suggested basename for a compact summary export. */
export function suggestCompactionExportBasename(sessionId: string): string {
  const shortId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || 'session';
  return `piwin-compact-${shortId}.md`;
}
