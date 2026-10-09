import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageRollup } from '@piwin/contracts';
import {
  formatThinkingLabel,
  formatTokensPerSecond,
  formatUsageDuration,
  formatUsageUsd,
  normalizeUsageRollup,
  resolveUsageWindow,
  tokenComponents,
} from './usage-panel-statistics';

afterEach(() => {
  vi.useRealTimers();
});

describe('usage-panel-statistics', () => {
  it('formats small USD costs without confusing unknown, tiny and genuinely free', () => {
    expect(formatUsageUsd(undefined)).toBe('—');
    expect(formatUsageUsd(Number.NaN)).toBe('—');
    expect(formatUsageUsd(-1)).toBe('—');
    expect(formatUsageUsd(0)).toBe('$0.00');
    expect(formatUsageUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsageUsd(0.006975)).toBe('$0.0070');
    expect(formatUsageUsd(12.345)).toBe('$12.35');
  });

  it('resolves bounded windows and leaves all-time unbounded', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

    expect(resolveUsageWindow('all')).toBeUndefined();
    expect(resolveUsageWindow('30d')).toEqual({ from: '2026-07-10T12:00:00.000Z' });
  });

  it('derives legacy model rows when an older Host omits byModelKey', () => {
    const legacyRollup = {
      scope: { kind: 'global' },
      promptTokens: 60,
      completionTokens: 20,
      cacheReadTokens: 15,
      cacheWriteTokens: 5,
      totalTokens: 100,
      entryCount: 1,
      sessionCount: 1,
      firstAt: '2026-08-09T10:00:00.000Z',
      lastAt: '2026-08-09T10:00:00.000Z',
      byModel: {
        model: {
          promptTokens: 60,
          completionTokens: 20,
          cacheReadTokens: 15,
          cacheWriteTokens: 5,
          totalTokens: 100,
          entryCount: 1,
        },
      },
      byDay: {},
      bySession: [],
    } satisfies Omit<UsageRollup, 'byModelKey'>;

    expect(normalizeUsageRollup(legacyRollup).byModelKey).toEqual([
      expect.objectContaining({ providerId: null, modelId: 'model', totalTokens: 100 }),
    ]);
  });

  it('combines every normalized token component for chart height', () => {
    expect(
      tokenComponents({
        promptTokens: 60,
        completionTokens: 20,
        cacheReadTokens: 15,
        cacheWriteTokens: 5,
        totalTokens: 100,
        entryCount: 1,
      }),
    ).toBe(100);
  });

  it('formats tokens per second with one decimal and an unknown dash', () => {
    expect(formatTokensPerSecond(75.4)).toBe('75.4 tok/s');
    expect(formatTokensPerSecond(123.456)).toBe('123 tok/s');
    expect(formatTokensPerSecond(null)).toBe('—');
  });

  it('carries rounded seconds into the minute instead of printing 60s', () => {
    expect(formatUsageDuration(850)).toBe('850ms');
    expect(formatUsageDuration(5_140)).toBe('5.14s');
    expect(formatUsageDuration(43_400)).toBe('43.4s');
    expect(formatUsageDuration(59_960)).toBe('1m0s');
    expect(formatUsageDuration(70_000)).toBe('1m10s');
    expect(formatUsageDuration(119_735)).toBe('2m0s');
    expect(formatUsageDuration(undefined)).toBe('—');
  });

  it('formats thinking labels for Chinese, English, and unknown states', () => {
    expect(formatThinkingLabel(undefined, true)).toBe('—');
    expect(formatThinkingLabel(null, false)).toBe('—');
    expect(formatThinkingLabel('off', true)).toBe('关');
    expect(formatThinkingLabel('off', false)).toBe('Off');
    expect(formatThinkingLabel('low', true)).toBe('低');
    expect(formatThinkingLabel('low', false)).toBe('Low');
    expect(formatThinkingLabel('medium', true)).toBe('中');
    expect(formatThinkingLabel('medium', false)).toBe('Medium');
    expect(formatThinkingLabel('high', true)).toBe('高');
    expect(formatThinkingLabel('high', false)).toBe('High');
    expect(formatThinkingLabel('xhigh', true)).toBe('极高');
    expect(formatThinkingLabel('xhigh', false)).toBe('xHigh');
    expect(formatThinkingLabel('max', true)).toBe('最大');
    expect(formatThinkingLabel('max', false)).toBe('Max');
    expect(formatThinkingLabel('ultra', true)).toBe('极致');
    expect(formatThinkingLabel('ultra', false)).toBe('Ultra');
  });
});
