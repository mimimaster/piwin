import { describe, expect, it } from 'vitest';
import { isDeepSeekModel } from './pi-deepseek-cache/lib/helpers.js';

describe('pi-deepseek-cache isDeepSeekModel', () => {
  it('matches bare and vendor-prefixed DeepSeek ids on any provider', () => {
    expect(isDeepSeekModel({ id: 'deepseek-v4-flash', provider: 'custom' })).toBe(true);
    expect(isDeepSeekModel({ id: 'deepseek/deepseek-v4.1-flash', provider: 'openrouter' })).toBe(true);
    expect(isDeepSeekModel({ id: 'whatever', provider: 'deepseek' })).toBe(true);
  });

  it('ignores other models', () => {
    expect(isDeepSeekModel({ id: 'grok-4.5', provider: 'xai' })).toBe(false);
    expect(isDeepSeekModel({ id: 'x-ai/grok-4.5', provider: 'openrouter' })).toBe(false);
    expect(isDeepSeekModel(undefined)).toBe(false);
  });
});
