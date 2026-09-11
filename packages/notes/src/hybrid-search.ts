/**
 * RRF fusion of FTS + vector channel results (ADR 0018 §5).
 * Pure given per-channel ranked hits — no IO.
 */
import type { NoteSearchHit } from '@piwin/contracts';

export const DEFAULT_RRF_K = 60;

export type ChannelResults = {
  fts: NoteSearchHit[];
  vector: NoteSearchHit[];
};

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

/**
 * Reciprocal Rank Fusion: score(d) = Σ_channels 1 / (k + rank_channel(d)).
 * Notes surfaced by both channels get both contributions and merged metadata.
 */
export function fuseHybridHits(
  channels: ChannelResults,
  options?: { rrfK?: number; limit?: number },
): NoteSearchHit[] {
  const rrfK = options?.rrfK && options.rrfK > 0 ? options.rrfK : DEFAULT_RRF_K;
  const limit = options?.limit && options.limit > 0 ? Math.floor(options.limit) : 10;
  const scores = reciprocalRankFusion(
    [channels.fts.map((hit) => hit.note.id), channels.vector.map((hit) => hit.note.id)],
    { rrfK },
  );

  const fused = new Map<string, NoteSearchHit>();

  const addChannel = (hits: NoteSearchHit[], channel: 'fts' | 'vector'): void => {
    for (const [position, hit] of hits.entries()) {
      const rank = position + 1;
      const existing = fused.get(hit.note.id);
      if (existing) {
        if (!existing.channels.includes(channel)) {
          existing.channels.push(channel);
        }
        existing.rank[channel] = rank;
        // Prefer the FTS snippet (keyword-anchored) over vector's leading slice.
        if (channel === 'fts') {
          existing.snippet = hit.snippet;
        }
      } else {
        fused.set(hit.note.id, {
          note: hit.note,
          score: scores.get(hit.note.id) ?? 0,
          snippet: hit.snippet,
          channels: [channel],
          rank: { [channel]: rank },
        });
      }
    }
  };

  addChannel(channels.fts, 'fts');
  addChannel(channels.vector, 'vector');

  return [...fused.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
