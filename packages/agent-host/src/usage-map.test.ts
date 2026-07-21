import { describe, expect, it } from 'vitest';
import { estimateMockUsage, mapUsageSnapshot } from './usage-map.js';

describe('usage-map', () => {
  it('maps pi-like contextUsage without inventing fields', () => {
    const snapshot = mapUsageSnapshot('s1', {
      contextUsage: { tokensUsed: 1200, tokensLimit: 8000, promptTokens: 900, completionTokens: 300 },
    });
    expect(snapshot).toMatchObject({
      sessionId: 's1',
      tokensUsed: 1200,
      tokensLimit: 8000,
      promptTokens: 900,
      completionTokens: 300,
      totalTokens: 1200,
      source: 'pi-contextUsage',
    });
    expect(snapshot?.contextRatio).toBeCloseTo(0.15);
  });

  it('returns null when no token fields present', () => {
    expect(mapUsageSnapshot('s1', { foo: 1 })).toBeNull();
  });

  it('estimates mock usage', () => {
    const snapshot = estimateMockUsage('s1', 'hello world', 'reply text');
    expect(snapshot.source).toBe('host-estimate');
    expect(snapshot.totalTokens).toBeGreaterThan(0);
    expect(snapshot.tokensLimit).toBe(128_000);
  });
});
