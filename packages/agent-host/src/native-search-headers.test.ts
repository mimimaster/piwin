import { describe, expect, it } from 'vitest';
import {
  buildAnthropicSearchHeaders,
  buildGeminiRestHeaders,
  mergeHeaderTokens,
} from './native-search-headers.js';

describe('native search headers', () => {
  it('merges anthropic-beta tokens without replacing existing values', () => {
    expect(
      mergeHeaderTokens({ 'Anthropic-Beta': 'interleaved-thinking-2025-05-14, x' }, 'anthropic-beta', ['X', 'web-search-2025-03-05']),
    ).toEqual({ 'Anthropic-Beta': 'interleaved-thinking-2025-05-14,x,web-search-2025-03-05' });
  });

  it('adds no beta header without a configured token', () => {
    expect(buildAnthropicSearchHeaders({ 'x-custom': '1' }, undefined)).toEqual({ 'x-custom': '1' });
    expect(buildAnthropicSearchHeaders(undefined, '  ')).toBeUndefined();
    expect(buildAnthropicSearchHeaders(undefined, 'web-search-2025-03-05')).toEqual({
      'anthropic-beta': 'web-search-2025-03-05',
    });
  });

  it('applies Gemini protocol defaults first and provider headers after', () => {
    expect(buildGeminiRestHeaders('k', { 'X-Goog-Api-Key': 'override', 'x-gw': 'g' })).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'X-Goog-Api-Key': 'override',
      'x-gw': 'g',
    });
  });
});
