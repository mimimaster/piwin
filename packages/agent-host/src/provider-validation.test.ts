import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  looksLikeRawApiKey,
  sanitizeProvidersForSave,
  validateProviders,
} from './provider-validation.js';

function sampleProvider(
  overrides: Partial<ModelProviderConfig> = {},
): ModelProviderConfig {
  return {
    id: 'openai',
    protocol: 'openai-compatible',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: [{ id: 'gpt-4o' }],
    ...overrides,
  };
}

describe('validateProviders', () => {
  it('accepts a valid provider', () => {
    expect(validateProviders([sampleProvider()])).toEqual([]);
  });

  it('rejects missing models, bad baseUrl, and raw key in apiKeyEnv', () => {
    const issues = validateProviders([
      sampleProvider({
        baseUrl: 'not-a-url',
        models: [],
        apiKeyEnv: 'sk-abcdefghijklmnop',
      }),
    ]);
    expect(issues.some((issue) => issue.path.includes('baseUrl'))).toBe(true);
    expect(issues.some((issue) => issue.path.includes('models'))).toBe(true);
    expect(issues.some((issue) => issue.path.includes('apiKeyEnv'))).toBe(true);
  });
});

describe('sanitizeProvidersForSave', () => {
  it('redacts raw keys from env/ref fields', () => {
    const { providers, redactedFields } = sanitizeProvidersForSave([
      sampleProvider({
        apiKeyEnv: 'sk-abcdefghijklmnop',
        apiKeyRef: 'sk-ant-abcdefghijklmnop',
      }),
    ]);
    expect(providers[0]?.apiKeyEnv).toBeUndefined();
    expect(providers[0]?.apiKeyRef).toBeUndefined();
    expect(redactedFields.length).toBe(2);
  });
});

describe('looksLikeRawApiKey', () => {
  it('detects common key prefixes', () => {
    expect(looksLikeRawApiKey('sk-1234567890abcdef')).toBe(true);
    expect(looksLikeRawApiKey('OPENAI_API_KEY')).toBe(false);
  });
});
