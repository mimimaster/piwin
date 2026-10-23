/**
 * Thinking deduplication utility.
 *
 * Detects duplicate or near-duplicate thinking text across assistant messages
 * within the same turn (e.g., when a reasoning model restates the prompt analysis
 * in both the intermediate tool-calling step and the final answer step).
 */

function normalizeThinking(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalized form per raw thinking string. A turn re-checks every earlier
 * reasoning block on each render; without this a 600-step chain re-ran the
 * Unicode regexes over hundreds of kilobytes per streamed token.
 *
 * Bounded by characters, not entries: a streaming block is a new, longer key
 * on every token. The budget holds a full resident window of settled
 * reasoning several times over (~2M chars ≈ 8MB with the normalized copy);
 * past it the cache is dropped wholesale and refills from the next render.
 */
const NORMALIZED_CACHE_CHAR_BUDGET = 2_000_000;
const normalizedCache = new Map<string, { normalized: string; tokens?: Set<string> }>();
let normalizedCacheChars = 0;

function normalizedEntry(text: string): { normalized: string; tokens?: Set<string> } {
  const cached = normalizedCache.get(text);
  if (cached !== undefined) return cached;
  if (normalizedCacheChars + text.length > NORMALIZED_CACHE_CHAR_BUDGET) {
    normalizedCache.clear();
    normalizedCacheChars = 0;
  }
  const entry: { normalized: string; tokens?: Set<string> } = { normalized: normalizeThinking(text) };
  normalizedCache.set(text, entry);
  normalizedCacheChars += text.length;
  return entry;
}

function cachedTokens(text: string): Set<string> {
  const entry = normalizedEntry(text);
  entry.tokens ??= extractTokens(entry.normalized);
  return entry.tokens;
}

function extractTokens(text: string): Set<string> {
  const normalized = normalizeThinking(text);
  if (!normalized) return new Set();

  const tokens = new Set<string>();
  const regex = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    if (match[0].length > 0) {
      tokens.add(match[0]);
    }
  }
  return tokens;
}

/**
 * Checks whether `current` thinking is duplicate or substantially redundant
 * with any of `priorThinkings` in the same turn.
 */
export function isDuplicateThinking(
  current: string,
  priorThinkings: readonly string[],
  /** Compare against only the first N entries (a growing per-turn list). */
  priorCount: number = priorThinkings.length,
): boolean {
  const trimmedCurrent = current.trim();
  if (trimmedCurrent.length === 0) {
    return true;
  }
  const count = Math.min(priorCount, priorThinkings.length);
  if (count === 0) {
    return false;
  }

  const normCurrent = normalizedEntry(trimmedCurrent).normalized;
  if (normCurrent.length === 0) {
    return true;
  }

  const currentTokens = cachedTokens(trimmedCurrent);

  for (let index = 0; index < count; index += 1) {
    const trimmedPrior = (priorThinkings[index] ?? '').trim();
    if (trimmedPrior.length === 0) continue;

    if (trimmedCurrent === trimmedPrior) {
      return true;
    }

    const normPrior = normalizedEntry(trimmedPrior).normalized;
    if (normCurrent === normPrior) {
      return true;
    }

    // Substring with high length overlap (> 70%)
    if (normCurrent.includes(normPrior) || normPrior.includes(normCurrent)) {
      const minLen = Math.min(normCurrent.length, normPrior.length);
      const maxLen = Math.max(normCurrent.length, normPrior.length);
      if (maxLen > 0 && minLen / maxLen > 0.7) {
        return true;
      }
    }

    // Token Jaccard overlap for short-to-medium reasoning summaries (< 500 chars)
    if (normCurrent.length < 500 && normPrior.length < 500 && currentTokens.size > 0) {
      const priorTokens = cachedTokens(trimmedPrior);
      if (priorTokens.size === 0) continue;

      let intersection = 0;
      for (const token of currentTokens) {
        if (priorTokens.has(token)) {
          intersection += 1;
        }
      }
      const union = new Set([...currentTokens, ...priorTokens]).size;
      if (union > 0 && intersection / union >= 0.65) {
        return true;
      }
    }
  }

  return false;
}
