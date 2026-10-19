import { describe, expect, it } from 'vitest';
import {
  buildStatusMetrics,
  contextBar,
  contextTone,
  formatCompactTokens,
  formatStatusSeconds,
  formatStatusUsd,
  pickStatusTier,
  ttftTone,
} from './status-metrics.js';

describe('status metrics formatting', () => {
  it('formats token counts compactly', () => {
    expect(formatCompactTokens(950)).toBe('950');
    expect(formatCompactTokens(38_000)).toBe('38k');
    expect(formatCompactTokens(92_400)).toBe('92k');
    expect(formatCompactTokens(1_240_000)).toBe('1.2M');
    expect(formatCompactTokens(200_000)).toBe('200k');
  });
  it('formats seconds for ttft and elapsed', () => {
    expect(formatStatusSeconds(820)).toBe('0.82s');
    expect(formatStatusSeconds(12_300)).toBe('12.3s');
    expect(formatStatusSeconds(65_000)).toBe('1m05s');
  });
  it('formats usd', () => {
    expect(formatStatusUsd(0.42)).toBe('$0.42');
    expect(formatStatusUsd(0.004)).toBe('<$0.01');
    expect(formatStatusUsd(12.345)).toBe('$12.35');
  });
  it('draws a context bar', () => {
    expect(contextBar(0.46, 6)).toBe('▰▰▰▱▱▱');
    expect(contextBar(0, 6)).toBe('▱▱▱▱▱▱');
    expect(contextBar(1.2, 4)).toBe('▰▰▰▰');
  });
  it('maps thresholds to tones', () => {
    expect(contextTone(0.69)).toBe('ok');
    expect(contextTone(0.7)).toBe('warn');
    expect(contextTone(0.9)).toBe('critical');
    expect(ttftTone(2000)).toBe('ok');
    expect(ttftTone(2001)).toBe('warn');
    expect(ttftTone(5001)).toBe('critical');
  });
  it('picks width tiers', () => {
    expect(pickStatusTier(140)).toBe('wide');
    expect(pickStatusTier(120)).toBe('wide');
    expect(pickStatusTier(100)).toBe('medium');
    expect(pickStatusTier(79)).toBe('narrow');
  });
});

describe('buildStatusMetrics', () => {
  const totals = {
    sessionId: 's', userTurnCount: 3, entryCount: 5,
    promptTokens: 300_000, completionTokens: 38_000, cacheReadTokens: 900_000, cacheWriteTokens: 0, totalTokens: 1_238_000,
    estimatedCostUsd: 0.42, pricedEntryCount: 5,
    latestRequest: { messageId: 'm', completionTokens: 860, durationMs: 10_820, firstTokenMs: 820, firstTokenKind: 'reasoning' as const },
  };
  it('combines totals, last request and context', () => {
    const m = buildStatusMetrics({ totals, context: { tokensUsed: 92_000, tokensLimit: 200_000, estimated: true } });
    expect(m.ttftMs).toBe(820);
    expect(Math.round(m.tokensPerSecond ?? 0)).toBe(86);
    expect(m.lastDurationMs).toBe(10_820);
    expect(m.userTurnCount).toBe(3);
    expect(m.inputTokens).toBe(1_200_000);
    expect(m.outputTokens).toBe(38_000);
    expect(Math.round((m.cacheHitRate ?? 0) * 100)).toBe(75);
    expect(m.costUsd).toBe(0.42);
    expect(m.context).toEqual({ used: 92_000, limit: 200_000, ratio: 0.46, estimated: true, tone: 'ok' });
  });
  it('hides cost unless asked, and without price data', () => {
    expect(buildStatusMetrics({ totals }).costUsd).toBe(0.42);
    expect(buildStatusMetrics({ totals: { ...totals, pricedEntryCount: 0, estimatedCostUsd: 0 } }).costUsd).toBeUndefined();
    expect(buildStatusMetrics({ totals: (({ estimatedCostUsd: _drop, ...rest }) => rest)(totals) }).costUsd).toBeUndefined();
  });
  it('prefers the latest live request timing', () => {
    const m = buildStatusMetrics({ totals, lastRequest: { completionTokens: 100, durationMs: 2100, firstTokenMs: 3100 } });
    expect(m.ttftMs).toBe(3100);
    expect(m.ttftTone).toBe('warn');
  });
  it('omits a zero turn count', () => {
    expect(buildStatusMetrics({ totals: { ...totals, userTurnCount: 0 } }).userTurnCount).toBeUndefined();
  });
  it('is empty without data', () => {
    const m = buildStatusMetrics({});
    expect(m).toEqual({});
  });
});
