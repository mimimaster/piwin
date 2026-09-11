import { describe, expect, it } from 'vitest';
import type { NoteRecord, NoteSearchHit } from '@piwin/contracts';
import { fuseHybridHits, reciprocalRankFusion } from './hybrid-search.js';
import { cosineSimilarity } from './vector-math.js';

function makeNote(id: string): NoteRecord {
  return {
    id,
    collection: 'default',
    title: id,
    content: `content of ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    relativePath: `default/${id}.md`,
    contentHash: `hash-${id}`,
  };
}

function makeHit(id: string, channel: 'fts' | 'vector', rank: number): NoteSearchHit {
  return {
    note: makeNote(id),
    score: 1 / rank,
    snippet: `${channel}-snippet-${id}`,
    channels: [channel],
    rank: { [channel]: rank },
  };
}

describe('fuseHybridHits', () => {
  it('doc in both channels outranks single-channel docs at same ranks', () => {
    const fused = fuseHybridHits({
      fts: [makeHit('both', 'fts', 1), makeHit('fts-only', 'fts', 2)],
      vector: [makeHit('vec-only', 'vector', 1), makeHit('both', 'vector', 2)],
    });
    expect(fused[0]?.note.id).toBe('both');
    expect(fused[0]?.channels.sort()).toEqual(['fts', 'vector']);
    expect(fused[0]?.rank).toEqual({ fts: 1, vector: 2 });
    // RRF exact: 1/(60+1) + 1/(60+2)
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it('prefers fts snippet for merged hits', () => {
    const fused = fuseHybridHits({
      fts: [makeHit('a', 'fts', 1)],
      vector: [makeHit('a', 'vector', 1)],
    });
    expect(fused[0]?.snippet).toBe('fts-snippet-a');
  });

  it('respects limit and rrfK overrides', () => {
    const fts = [1, 2, 3].map((rank) => makeHit(`f${rank}`, 'fts', rank));
    const fused = fuseHybridHits({ fts, vector: [] }, { limit: 2, rrfK: 1 });
    expect(fused).toHaveLength(2);
    expect(fused[0]?.score).toBeCloseTo(1 / 2, 10);
  });

  it('handles empty channels', () => {
    expect(fuseHybridHits({ fts: [], vector: [] })).toEqual([]);
  });
});

describe('reciprocalRankFusion', () => {
  it('sums 1/(k+rank) across lists and keeps first-list order ties by score', () => {
    const scores = reciprocalRankFusion(
      [
        ['both', 'fts-only'],
        ['vec-only', 'both'],
      ],
      { rrfK: 60 },
    );
    expect(scores.get('both')).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(scores.get('fts-only')).toBeCloseTo(1 / 62, 10);
    expect(scores.get('vec-only')).toBeCloseTo(1 / 61, 10);
  });
});

describe('cosineSimilarity', () => {
  it('identical vectors → 1, orthogonal → 0, opposite → -1', () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    const c = Float32Array.from([-1, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
    expect(cosineSimilarity(a, c)).toBeCloseTo(-1, 6);
  });

  it('returns 0 for mismatched or zero vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1]), Float32Array.from([1, 2]))).toBe(0);
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });
});
