/**
 * CJK-aware pre-tokenization for FTS5 (ADR 0018 §4).
 *
 * FTS5's default `unicode61` tokenizer treats consecutive CJK characters as a
 * single token, which breaks Chinese search. We segment text with
 * `Intl.Segmenter` (ICU dictionary segmentation, stdlib) and store/query
 * space-joined tokens so `unicode61` sees word boundaries.
 */

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * Segment text into search tokens. Word-like segments only (whitespace and
 * punctuation dropped), lowercased for case-insensitive matching.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue;
    const token = segment.segment.trim().toLowerCase();
    if (token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** Space-joined tokens, the form stored in FTS5 columns. */
export function tokenizeForIndex(text: string): string {
  return tokenize(text).join(' ');
}

/**
 * Build an FTS5 MATCH expression from a user query: each token quoted (so
 * FTS5 operators in user input are inert) and AND-joined implicitly.
 * Returns null for queries with no word-like content.
 */
export function buildMatchExpression(query: string): string | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' ');
}
