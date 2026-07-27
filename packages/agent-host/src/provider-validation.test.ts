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

  it('rejects bad baseUrl and raw key in apiKeyEnv; empty models are allowed', () => {
    const issues = validateProviders([
      sampleProvider({
        baseUrl: 'not-a-url',
        models: [],
        apiKeyEnv: 'sk-abcdefghijklmnop',
      }),
    ]);
    expect(issues.some((issue) => issue.path.includes('baseUrl'))).toBe(true);
    expect(issues.some((issue) => issue.path.includes('apiKeyEnv'))).toBe(true);
  });

  it('accepts Google Gemini and validates model-specific runtime limits', () => {
    const validGoogleProvider: ModelProviderConfig = {
      id: 'company-gemini',
      protocol: 'google-gemini',
      name: 'Company Gemini gateway',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: [
        {
          id: 'gemini-2.5-pro',
          contextWindow: 1_000_000,
          maxOutputTokens: 65_536,
          tooltipMarkdown: 'Long-context coding model.',
        },
      ],
    };

    expect(validateProviders([validGoogleProvider])).toEqual([]);

    const invalidIssues = validateProviders([
      {
        ...validGoogleProvider,
        models: [{ id: 'gemini-2.5-pro', contextWindow: 0, maxOutputTokens: -1 }],
      },
    ]);
    expect(invalidIssues.map((issue) => issue.path)).toContain('providers[0].models[0].contextWindow');
    expect(invalidIssues.map((issue) => issue.path)).toContain('providers[0].models[0].maxOutputTokens');
  });

  it('accepts safe custom headers and rejects unsafe header values', () => {
    expect(
      validateProviders([
        sampleProvider({
          headers: {
            'HTTP-Referer': 'https://piwin.app',
            'X-Title': 'piwin',
          },
        }),
      ]),
    ).toEqual([]);

    const issues = validateProviders([
      sampleProvider({
        headers: {
          'X-Request-ID': 'safe-value\r\nInjected: value',
        },
      }),
    ]);

    expect(issues.map((issue) => issue.path)).toContain('providers[0].headers.X-Request-ID');
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
