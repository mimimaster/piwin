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
): boolean {
  const trimmedCurrent = current.trim();
  if (trimmedCurrent.length === 0) {
    return true;
  }
  if (priorThinkings.length === 0) {
    return false;
  }

  const normCurrent = normalizeThinking(trimmedCurrent);
  if (normCurrent.length === 0) {
    return true;
  }

  const currentTokens = extractTokens(normCurrent);

  for (const prior of priorThinkings) {
    const trimmedPrior = prior.trim();
    if (trimmedPrior.length === 0) continue;

    if (trimmedCurrent === trimmedPrior) {
      return true;
    }

    const normPrior = normalizeThinking(trimmedPrior);
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
      const priorTokens = extractTokens(normPrior);
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
