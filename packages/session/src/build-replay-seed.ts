/**
 * Build full-fidelity replay seeds from transcript rows plus native context
 * copies (spec: session-conversation-tree §4.4).
 *
 * Budget fills newest-to-oldest. A row is atomic: either all of its native
 * entries are usable (present, none truncated, within budget) and it seeds
 * natively, or the whole row falls back to bounded text. Rows beyond the
 * budget are dropped, mirroring the bounded text-injection path.
 */

import type {
  NativeContextEntry,
  SessionSeedMessage,
  SessionTranscriptMessage,
} from '@piwin/contracts';

export const DEFAULT_REPLAY_SEED_MAX_CHARS = 400_000;
const MAX_TEXT_CHARS_PER_MESSAGE = 4_000;

export type ReplaySeedSourceRow = {
  message: SessionTranscriptMessage;
  native: NativeContextEntry[];
};

export function buildReplaySeedMessages(
  rows: readonly ReplaySeedSourceRow[],
  options: { maxChars?: number } = {},
): { seedMessages: SessionSeedMessage[]; nativeRowCount: number } {
  const maxChars = options.maxChars ?? DEFAULT_REPLAY_SEED_MAX_CHARS;
  const selected: SessionSeedMessage[] = [];
  let usedChars = 0;
  let nativeRowCount = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const source = rows[index];
    if (source === undefined) continue;
    const seed = buildRowSeed(source);
    if (seed === undefined) continue;
    const cost = seedChars(seed);
    if (usedChars + cost > maxChars) break;
    usedChars += cost;
    if (seed.native !== undefined) nativeRowCount += 1;
    selected.unshift(seed);
  }
  return { seedMessages: selected, nativeRowCount };
}

function buildRowSeed(source: ReplaySeedSourceRow): SessionSeedMessage | undefined {
  const { message, native } = source;
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const text = message.text.slice(0, MAX_TEXT_CHARS_PER_MESSAGE);
  const timestamp = Date.parse(message.createdAt) || Date.now();
  const usableNative = native.length > 0 && native.every((entry) => entry.truncated !== true);
  if (usableNative) {
    return { role, text, timestamp, native: [...native] };
  }
  if (text.trim().length === 0) return undefined;
  return { role, text, timestamp };
}

function seedChars(seed: SessionSeedMessage): number {
  if (seed.native !== undefined) {
    let total = 0;
    for (const entry of seed.native) total += entry.payload.length;
    return total;
  }
  return seed.text.length + 1;
}
