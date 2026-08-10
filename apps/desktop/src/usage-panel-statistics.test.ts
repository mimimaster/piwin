import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageRollup } from '@piwin/contracts';
import {
  formatTokensPerSecond,
  normalizeUsageRollup,
  resolveUsageWindow,
  tokenComponents,
} from './usage-panel-statistics';

afterEach(() => {
  vi.useRealTimers();
});

describe('usage-panel-statistics', () => {
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
});
