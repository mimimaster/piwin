/**
 * Normalize full HTML documents into a fragment suitable for artifact embedding.
 * Ported from openwebui_m htmlDocumentFragment.ts (pure, host-agnostic).
 */

export function isFullHtmlDocument(source: string): boolean {
  const patterns = [
    /<!doctype\s+html\b/i,
    /<\s*html\b/i,
    /<\s*head\b/i,
    /<\s*body\b/i,
  ];
  return patterns.some((pattern) => pattern.test(source));
}

export function normalizeHtmlDocumentToArtifactFragment(source: string): string {
  if (!isFullHtmlDocument(source)) {
    return source;
  }

  let result = source;
  result = result.replace(/<!doctype\s+[^>]*>/gi, '');
  result = result.replace(/<\s*html\b[^>]*>/gi, '');
  result = result.replace(/<\/\s*html\s*>/gi, '');
  result = result.replace(/<\s*head\b[^>]*>/gi, '');
  result = result.replace(/<\/\s*head\s*>/gi, '');
  result = result.replace(/<\s*body\b[^>]*>/gi, '');
  result = result.replace(/<\/\s*body\s*>/gi, '');
  result = result.replace(/<\s*meta\b[^>]*\/\s*>/gi, '');
  result = result.replace(/<\s*meta\b[^>]*>/gi, '');
  result = result.replace(/<\s*title\b[^>]*>[\s\S]*?<\/\s*title\s*>/gi, '');
  result = result.trim();

  if (result && !/^<\s*(?:div|section|main|article)\b/i.test(result)) {
    result = `<div class="artifact-root">\n  ${result}\n</div>`;
  }

  return result;
}
