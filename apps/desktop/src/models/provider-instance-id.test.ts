import { describe, expect, it } from 'vitest';
import {
  allocateUniqueProviderId,
  allocateUniqueProviderName,
} from './provider-instance-id.js';

describe('allocateUniqueProviderId', () => {
  it('keeps the preferred id when free', () => {
    expect(allocateUniqueProviderId('openai', ['anthropic'])).toBe('openai');
  });

  it('allocates numeric suffixes for collisions', () => {
    expect(allocateUniqueProviderId('openai', ['openai'])).toBe('openai-2');
    expect(allocateUniqueProviderId('openai', ['openai', 'openai-2'])).toBe('openai-3');
  });

  it('falls back to provider when preferred is blank', () => {
    expect(allocateUniqueProviderId('  ', ['provider'])).toBe('provider-2');
  });
});

describe('allocateUniqueProviderName', () => {
  it('keeps the preferred name when free', () => {
    expect(allocateUniqueProviderName('OpenAI', ['Anthropic'])).toBe('OpenAI');
  });

  it('allocates spaced numeric suffixes for collisions', () => {
    expect(allocateUniqueProviderName('OpenAI', ['OpenAI'])).toBe('OpenAI 2');
    expect(allocateUniqueProviderName('OpenAI', ['OpenAI', 'OpenAI 2'])).toBe('OpenAI 3');
  });
});
