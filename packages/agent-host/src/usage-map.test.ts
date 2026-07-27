import { describe, expect, it } from 'vitest';
import { estimateMockUsage, estimateUsageBreakdown, mapUsageSnapshot } from './usage-map.js';

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
    expect(snapshot.breakdown?.source).toBe('host-estimate');
    expect(snapshot.breakdown?.conversationTokens).toBeGreaterThan(0);
  });

  it('maps pi breakdown when present', () => {
    const snapshot = mapUsageSnapshot('s1', {
      tokensUsed: 1000,
      tokensLimit: 8000,
      breakdown: { system: 100, tools: 200, conversation: 700 },
    });
    expect(snapshot?.breakdown?.systemPromptTokens).toBe(100);
    expect(snapshot?.breakdown?.toolDefinitionsTokens).toBe(200);
    expect(snapshot?.breakdown?.conversationTokens).toBe(700);
    expect(snapshot?.breakdown?.source).toBe('pi');
  });

  it('estimates breakdown summing to used', () => {
    const breakdown = estimateUsageBreakdown({ tokensUsed: 1000 });
    const sum =
      (breakdown.systemPromptTokens ?? 0) +
      (breakdown.toolDefinitionsTokens ?? 0) +
      (breakdown.rulesTokens ?? 0) +
      (breakdown.skillsTokens ?? 0) +
      (breakdown.mcpTokens ?? 0) +
      (breakdown.conversationTokens ?? 0);
    expect(sum).toBe(1000);
  });
});
