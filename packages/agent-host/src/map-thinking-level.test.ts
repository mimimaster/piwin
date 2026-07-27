import { describe, expect, it } from 'vitest';
import { mapThinkingLevelToApi } from './map-thinking-level.js';

describe('mapThinkingLevelToApi', () => {
  it('passes through protocol API levels unchanged', () => {
    expect(mapThinkingLevelToApi('medium', 'openai-compatible')).toBe('medium');
    expect(mapThinkingLevelToApi('xhigh', 'openai-compatible')).toBe('xhigh');
    expect(mapThinkingLevelToApi('max', 'anthropic-compatible')).toBe('max');
  });

  it('maps product ultra to protocol API maxima', () => {
    expect(mapThinkingLevelToApi('ultra', 'openai-compatible')).toBe('xhigh');
    expect(mapThinkingLevelToApi('ultra', 'anthropic-compatible')).toBe('max');
    expect(mapThinkingLevelToApi('ultra', 'google-gemini')).toBe('xhigh');
  });
});
