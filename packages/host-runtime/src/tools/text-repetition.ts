/**
 * Pure text-loop finder for the idle-loop notice
 * (docs/plans/2026-09-28-run-idle-loop-notice.md).
 *
 * 2026-09-30 session-muny5im0-8df7puba: a model streamed one 107-character
 * sentence 748 times in a single reply. Tool-call fingerprints never see
 * that, so the reply text itself is checked for a periodic tail.
 */

import { RUN_TEXT_LOOP_MIN_REPEATS, RUN_TEXT_LOOP_MIN_UNIT_CHARS } from '@piwin/contracts';

/**
 * Tail scanned per check. It bounds the prefix-function pass; a loop longer
 * than the window is then measured by comparing backwards, which is linear.
 */
const TAIL_WINDOW_CHARS = 8_192;

export type TrailingRepetition = {
  /** One full repetition, taken from where the periodic tail begins. */
  unit: string;
  repeats: number;
  /** Length of the periodic tail in characters. */
  chars: number;
};

/**
 * Finds a tail made of one unit of at least RUN_TEXT_LOOP_MIN_UNIT_CHARS
 * repeated at least RUN_TEXT_LOOP_MIN_REPEATS times back to back.
 *
 * The unit is the smallest period of the tail, so `====` rules, `ab` runs and
 * other short-period output never qualify however long they are.
 */
export function findTrailingRepetition(text: string): TrailingRepetition | undefined {
  const length = text.length;
  if (length < RUN_TEXT_LOOP_MIN_UNIT_CHARS * RUN_TEXT_LOOP_MIN_REPEATS) return undefined;
  const tail = text.slice(-TAIL_WINDOW_CHARS);
  const reversed = reverse(tail);
  const border = borderLengths(reversed);

  // A suffix of `tail` is a prefix of `reversed`; its smallest period is
  // (prefix length - longest border). Keep the longest qualifying prefix.
  let bestLength = 0;
  let bestPeriod = 0;
  for (let index = 0; index < reversed.length; index += 1) {
    const prefixLength = index + 1;
    const period = prefixLength - (border[index] ?? 0);
    if (
      period >= RUN_TEXT_LOOP_MIN_UNIT_CHARS &&
      Math.floor(prefixLength / period) >= RUN_TEXT_LOOP_MIN_REPEATS
    ) {
      bestLength = prefixLength;
      bestPeriod = period;
    }
  }
  if (bestPeriod === 0) return undefined;
  // Only suffixes are considered, so a loop the reply already left behind is
  // never reported. Extend backwards past the window to measure the whole run.
  let start = length - bestLength;
  while (start > 0 && text[start - 1] === text[start - 1 + bestPeriod]) start -= 1;
  const chars = length - start;
  return {
    unit: text.slice(start, start + bestPeriod),
    repeats: Math.floor(chars / bestPeriod),
    chars,
  };
}

function reverse(text: string): string {
  let out = '';
  for (let index = text.length - 1; index >= 0; index -= 1) out += text[index];
  return out;
}

/** Prefix function: `border[i]` is the longest proper border of `text[0..i]`. */
function borderLengths(text: string): Uint32Array {
  const border = new Uint32Array(text.length);
  let matched = 0;
  for (let index = 1; index < text.length; index += 1) {
    while (matched > 0 && text[index] !== text[matched]) matched = border[matched - 1] ?? 0;
    if (text[index] === text[matched]) matched += 1;
    border[index] = matched;
  }
  return border;
}
