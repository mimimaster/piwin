/**
 * Detect active `@` mention tokens in composer text.
 */
import type { ActiveAtToken } from './at-types';

/**
 * Find the `@` token under the caret.
 * Token starts with `@` following whitespace or start of string.
 */
export function detectActiveAtToken(
  text: string,
  caretIndex: number,
): ActiveAtToken | null {
  const safeCaret = Math.max(0, Math.min(caretIndex, text.length));
  let startIndex = safeCaret;
  while (startIndex > 0) {
    const previous = text[startIndex - 1];
    if (previous === undefined || /\s/.test(previous)) {
      break;
    }
    startIndex -= 1;
  }
  if (text[startIndex] !== '@') {
    return null;
  }
  let endIndex = startIndex + 1;
  while (endIndex < text.length) {
    const character = text[endIndex];
    if (character === undefined || /\s/.test(character)) {
      break;
    }
    endIndex += 1;
  }
  if (safeCaret < startIndex || safeCaret > endIndex) {
    return null;
  }
  const raw = text.slice(startIndex, endIndex);
  const query = raw.slice(1);
  return { raw, query, startIndex, endIndex };
}

/**
 * Replace the active `@` token with `replacement` (empty string clears it).
 */
export function replaceActiveAtToken(
  text: string,
  token: ActiveAtToken,
  replacement: string,
): string {
  return text.slice(0, token.startIndex) + replacement + text.slice(token.endIndex);
}
