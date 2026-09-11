/**
 * Reciprocal Rank Fusion over ranked id lists.
 * Pure — no IO.
 */

export const DEFAULT_RRF_K = 60;

/**
 * Reciprocal Rank Fusion: score(id) = Σ_lists 1 / (k + rank_list(id)).
 * Pure. Duplicate ids across lists accumulate; rank is 1-based position.
 */
export function reciprocalRankFusion(
  rankedIdLists: ReadonlyArray<ReadonlyArray<string>>,
  options?: { rrfK?: number },
): Map<string, number> {
  const rrfK = options?.rrfK && options.rrfK > 0 ? options.rrfK : DEFAULT_RRF_K;
  const scores = new Map<string, number>();
  for (const list of rankedIdLists) {
    for (const [position, id] of list.entries()) {
      const rank = position + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + rank));
    }
  }
  return scores;
}
