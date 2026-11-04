/**
 * URLs printed on a shell row, as plain data.
 *
 * Kept apart from the xterm provider (xterm-url-links.ts) so the parsing rules
 * are unit-testable without a terminal instance: which characters end a URL,
 * and when a closing paren belongs to the URL instead of to the sentence.
 */

export type TerminalUrlMatch = {
  /** 0-based column where the URL starts. */
  start: number;
  /** 0-based, exclusive. */
  end: number;
  text: string;
};

const URL_SOURCE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"`]+$/;
const CLOSER_TO_OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countChar(text: string, char: string): number {
  let count = 0;
  for (const current of text) {
    if (current === char) count += 1;
  }
  return count;
}

/**
 * Sentence punctuation after a URL is not part of it, and a closing bracket is
 * only trimmed when the row did not open one: `(see https://a.dev/x)` drops the
 * paren, while `https://en.wikipedia.org/wiki/Foo_(bar)` keeps its own.
 */
function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, '');
  for (;;) {
    const closer = url.slice(-1);
    const opener = CLOSER_TO_OPENER[closer];
    if (opener === undefined) return url;
    if (countChar(url, closer) <= countChar(url, opener)) return url;
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
  }
}

export function findTerminalUrls(text: string): TerminalUrlMatch[] {
  // Fresh regex per call: a /g lastIndex must not leak between terminal rows.
  const pattern = new RegExp(URL_SOURCE.source, URL_SOURCE.flags);
  const urls: TerminalUrlMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const url = trimUrl(match[0]);
    // A bare scheme is not a link.
    if (url.length <= 'https://'.length) continue;
    urls.push({ start: match.index, end: match.index + url.length, text: url });
  }
  return urls;
}
