/**
 * Near-duplicate detection for card fronts (trigram overlap on normalized
 * text). Safety net behind LLM-side dedup (existing fronts are passed to the
 * model at generation time); this catches what the model misses.
 */

const SIMILARITY_THRESHOLD = 0.85;

export function normalizeFront(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  if (text.length < 3) {
    if (text.length > 0) grams.add(text);
    return grams;
  }
  for (let index = 0; index <= text.length - 3; index += 1) {
    grams.add(text.slice(index, index + 3));
  }
  return grams;
}

/** Jaccard similarity of character trigrams over normalized text (0..1). */
export function frontSimilarity(left: string, right: string): number {
  const leftNorm = normalizeFront(left);
  const rightNorm = normalizeFront(right);
  if (!leftNorm || !rightNorm) return 0;
  if (leftNorm === rightNorm) return 1;
  const leftGrams = trigrams(leftNorm);
  const rightGrams = trigrams(rightNorm);
  let intersection = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) intersection += 1;
  }
  const union = leftGrams.size + rightGrams.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Returns the first existing front considered a near-duplicate, or null. */
export function findNearDuplicate(
  candidateFront: string,
  existingFronts: string[],
  threshold: number = SIMILARITY_THRESHOLD,
): string | null {
  for (const existing of existingFronts) {
    if (frontSimilarity(candidateFront, existing) >= threshold) {
      return existing;
    }
  }
  return null;
}

export function findNearDuplicateItem<T>(
  candidateFront: string,
  existing: readonly T[],
  preview: (item: T) => string,
  threshold: number = SIMILARITY_THRESHOLD,
): T | undefined {
  for (const item of existing) {
    if (frontSimilarity(candidateFront, preview(item)) >= threshold) {
      return item;
    }
  }
  return undefined;
}
