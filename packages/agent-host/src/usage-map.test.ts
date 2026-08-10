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

  it('maps normalized assistant cache usage and model id', () => {
    const snapshot = mapUsageSnapshot(
      's1',
      {
        model: 'gpt-4o',
        usage: { input: 700, output: 200, cacheRead: 100, cacheWrite: 50, totalTokens: 1050 },
      },
      'assistant-usage',
    );
    expect(snapshot).toMatchObject({
      modelId: 'gpt-4o',
      promptTokens: 700,
      completionTokens: 200,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalTokens: 1050,
      // Context occupancy = input-side (prompt + cache), not billable turn total.
      tokensUsed: 850,
      source: 'assistant-usage',
    });
  });

  it('maps provider cache aliases and derives totals including cache tokens', () => {
    const snapshot = mapUsageSnapshot('s1', {
      input_tokens: 700,
      output_tokens: 200,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    });
    expect(snapshot).toMatchObject({
      promptTokens: 700,
      completionTokens: 200,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalTokens: 1050,
      tokensUsed: 850,
    });
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
