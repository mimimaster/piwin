import { describe, expect, it } from 'vitest';
import {
  createDefaultCodemodeConfig,
  normalizeCodemodeConfig,
  validateCodemodeConfig,
} from './codemode.js';

describe('normalizeCodemodeConfig', () => {
  it('enables fresh and legacy omitted config by default', () => {
    expect(createDefaultCodemodeConfig().enabled).toBe(true);
    for (const value of [undefined, null, {}, [], { maxCalls: 2 }]) {
      expect(normalizeCodemodeConfig(value).enabled).toBe(true);
    }
  });

  it('keeps an explicit operator disable override', () => {
    expect(normalizeCodemodeConfig({ enabled: false })).toEqual({
      ...createDefaultCodemodeConfig(),
      enabled: false,
    });
  });

  it('does not widen malformed or out-of-range limits', () => {
    expect(normalizeCodemodeConfig({ enabled: 'yes', timeoutMs: 0, maxCalls: 10_000 })).toEqual(
      createDefaultCodemodeConfig(),
    );
    expect(validateCodemodeConfig({ enabled: 'yes', timeoutMs: 0 }).map((issue) => issue.path)).toEqual([
      'codemode.enabled',
      'codemode.timeoutMs',
    ]);
  });

  it('keeps an explicit in-range enabled config', () => {
    expect(
      normalizeCodemodeConfig({
        enabled: true,
        timeoutMs: 5_000,
        memoryLimitBytes: 8_388_608,
        maxCalls: 2,
        maxConcurrency: 1,
        maxOutputChars: 1_000,
        maxTools: 4,
      }),
    ).toMatchObject({ enabled: true, timeoutMs: 5_000, maxCalls: 2, maxTools: 4 });
  });
});
