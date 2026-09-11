import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './hybrid-search.js';
import { cosineSimilarity } from './vector-math.js';

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
