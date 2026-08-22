/** Classify source without rewriting or flattening its document structure. */
export function isFullHtmlDocument(source: string): boolean {
  const patterns = [/<!doctype\s+html\b/i, /<\s*html\b/i, /<\s*head\b/i, /<\s*body\b/i];
  return patterns.some((pattern) => pattern.test(source));
}
