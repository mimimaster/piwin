import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  looksLikeRawApiKey,
  sanitizeProvidersForSave,
  validatePiwinConfig,
  validateProviders,
} from './provider-validation.js';

function sampleProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
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

  it('rejects duplicate or out-of-list thinking defaults', () => {
    const issues = validateProviders([
      {
        id: 'thinking-provider',
        protocol: 'openai-compatible',
        name: 'Thinking provider',
        baseUrl: 'https://example.test/v1',
        models: [
          {
            id: 'model',
            thinkingLevels: ['low', 'low'],
            thinkingLevel: 'medium',
          },
        ],
      },
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'providers[0].models[0].thinkingLevels[1]',
        'providers[0].models[0].thinkingLevel',
      ]),
    );
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
    expect(invalidIssues.map((issue) => issue.path)).toContain(
      'providers[0].models[0].contextWindow',
    );
    expect(invalidIssues.map((issue) => issue.path)).toContain(
      'providers[0].models[0].maxOutputTokens',
    );
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

  it('validates image model route invariants and provider support', () => {
    const issues = validateProviders([
      sampleProvider({
        models: [
          {
            id: 'image',
            capabilities: ['image-generation'],
            routes: {
              'image-generation': { path: 'https://other.example/images', timeoutMs: 0 },
            },
          },
          { id: 'image', capabilities: ['image-generation'] },
        ],
      }),
      {
        id: 'anthropic',
        protocol: 'anthropic-compatible',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        models: [{ id: 'not-supported', capabilities: ['image-generation'] }],
      },
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'providers[0].models[0].routes.image-generation.path',
        'providers[0].models[0].routes.image-generation.timeoutMs',
        'providers[0].models[1].id',
        'providers[1].models[0].capabilities',
      ]),
    );
  });

  it('accepts image apiStyle values and rejects video-only or unknown styles', () => {
    expect(
      validateProviders([
        sampleProvider({
          models: [
            {
              id: 'grok-image',
              capabilities: ['image-generation'],
              routes: { 'image-generation': { apiStyle: 'openai' } },
            },
            {
              id: 'gemini-image',
              capabilities: ['image-generation'],
              routes: { 'image-generation': { apiStyle: 'gemini' } },
            },
          ],
        }),
      ]),
    ).toEqual([]);

    const issues = validateProviders([
      sampleProvider({
        models: [
          {
            id: 'bad',
            capabilities: ['image-generation'],
            routes: { 'image-generation': { apiStyle: 'runway-tasks' } },
          },
        ],
      }),
    ]);
    expect(issues.map((issue) => issue.path)).toContain(
      'providers[0].models[0].routes.image-generation.apiStyle',
    );
  });
});

describe('validatePiwinConfig', () => {
  it('requires the image default to reference an enabled image model', () => {
    const provider = sampleProvider({ models: [{ id: 'chat', capabilities: ['chat'] }] });
    const issues = validatePiwinConfig({
      hostMode: 'sdk',
      providers: [provider],
      media: { maxPasteBytes: 1, allowedMimeTypes: ['image/png'] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 1,
      },
      imageGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: provider.id,
          modelId: 'chat',
        },
      },
    });
    expect(issues.map((issue) => issue.path)).toContain('imageGeneration.defaultModel.modelId');
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
