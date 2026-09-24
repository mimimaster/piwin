import { describe, expect, it } from 'vitest';
import {
  createDefaultCodeSearchConfig,
  createDefaultWebConfig,
  type PiwinConfig,
} from '@piwin/contracts';

import { applySubscriptionLoginDefaults } from './subscription-login-defaults.js';

function config(overrides: Partial<PiwinConfig> = {}): PiwinConfig {
  return {
    providers: [],
    codeSearch: createDefaultCodeSearchConfig(),
    web: createDefaultWebConfig(),
    ...overrides,
  } as PiwinConfig;
}

describe('applySubscriptionLoginDefaults', () => {
  it('turns on code_search and the Devin search source for a fresh setup, and asks about priority', () => {
    const { config: next, followUp } = applySubscriptionLoginDefaults(config(), 'devin');
    expect(next.codeSearch).toMatchObject({ enabled: true, backend: 'windsurf', apiKeyRef: 'oauth:devin' });
    expect(next.codeSearch?.apiKeyEnv).toBeUndefined();
    expect(next.web?.searchSources).toContainEqual({
      id: 'devin',
      kind: 'devin',
      enabled: true,
      apiKeyRef: 'oauth:devin',
    });
    // The packaged default is model-native first: the priority itself is untouched.
    expect(next.web?.searchRoutePolicy).toBe(createDefaultWebConfig().searchRoutePolicy);
    expect(followUp).toEqual({
      enabled: ['code-search', 'web-search-source'],
      suggestExternalSearchPriority: true,
    });
  });

  it('keeps a code_search model or pasted token the user chose', () => {
    const withModel = config({
      codeSearch: {
        ...createDefaultCodeSearchConfig(),
        enabled: false,
        backend: 'model',
        model: { providerId: 'custom', modelId: 'fast' },
      },
    });
    expect(applySubscriptionLoginDefaults(withModel, 'devin').config.codeSearch).toEqual(withModel.codeSearch);

    const withToken = config({
      codeSearch: {
        ...createDefaultCodeSearchConfig(),
        enabled: true,
        backend: 'windsurf',
        apiKeyRef: 'keychain:piwin-code-search-windsurf',
      },
    });
    const result = applySubscriptionLoginDefaults(withToken, 'devin');
    expect(result.config.codeSearch).toEqual(withToken.codeSearch);
    expect(result.followUp?.enabled).toEqual(['web-search-source']);
  });

  it('leaves a Devin source the user switched off, and stays quiet on external-first', () => {
    const web = {
      ...createDefaultWebConfig(),
      searchRoutePolicy: 'external-first' as const,
      searchSources: [{ id: 'devin', kind: 'devin' as const, enabled: false, apiKeyRef: 'oauth:devin' }],
    };
    const settled = config({
      web,
      codeSearch: { ...createDefaultCodeSearchConfig(), enabled: true, backend: 'windsurf', apiKeyRef: 'oauth:devin' },
    });
    const result = applySubscriptionLoginDefaults(settled, 'devin');
    expect(result.config).toBe(settled);
    expect(result.followUp).toBeUndefined();
  });

  it('does nothing for other providers', () => {
    const base = config();
    expect(applySubscriptionLoginDefaults(base, 'openai-codex')).toEqual({ config: base });
  });
});
