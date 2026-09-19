import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CODE_SEARCH_EXCLUDE_PATHS,
  createDefaultCodeSearchConfig,
  isCodeSearchBackendReady,
  resolveCodeSearchConfig,
} from './code-search.js';

describe('createDefaultCodeSearchConfig', () => {
  it('ships the verified defaults from the plan', () => {
    const config = createDefaultCodeSearchConfig();
    expect(config).toEqual({
      enabled: false,
      backend: 'model',
      maxTurns: 3,
      maxCommands: 8,
      maxResults: 10,
      treeDepth: 3,
      includeSnippets: true,
      excludePaths: [...DEFAULT_CODE_SEARCH_EXCLUDE_PATHS],
      resultMaxLines: 50,
      lineMaxChars: 250,
      timeoutMs: 30_000,
    });
  });

  it('omits model and cloud credentials by default', () => {
    const config = createDefaultCodeSearchConfig();
    expect(config.model).toBeUndefined();
    expect(config.apiKeyRef).toBeUndefined();
    expect(config.apiKeyEnv).toBeUndefined();
  });

  it('returns a fresh exclude list each call so callers cannot alias the default', () => {
    const first = createDefaultCodeSearchConfig();
    const second = createDefaultCodeSearchConfig();
    first.excludePaths?.push('mutated');
    expect(second.excludePaths).toEqual([...DEFAULT_CODE_SEARCH_EXCLUDE_PATHS]);
    expect(resolveCodeSearchConfig().excludePaths).toEqual([...DEFAULT_CODE_SEARCH_EXCLUDE_PATHS]);
  });
});

describe('resolveCodeSearchConfig', () => {
  it('fills every default from an empty config', () => {
    const resolved = resolveCodeSearchConfig();
    expect(resolved.enabled).toBe(false);
    expect(resolved.backend).toBe('model');
    expect(resolved.maxTurns).toBe(3);
    expect(resolved.maxCommands).toBe(8);
    expect(resolved.maxResults).toBe(10);
    expect(resolved.treeDepth).toBe(3);
    expect(resolved.includeSnippets).toBe(true);
    expect(resolved.resultMaxLines).toBe(50);
    expect(resolved.lineMaxChars).toBe(250);
    expect(resolved.timeoutMs).toBe(30_000);
    expect(resolved.model).toBeUndefined();
  });

  it('keeps explicit values and only defaults the omitted ones', () => {
    const resolved = resolveCodeSearchConfig({
      enabled: true,
      backend: 'windsurf',
      apiKeyRef: 'keychain:piwin-code-search-windsurf',
      maxTurns: 5,
      treeDepth: 0,
      includeSnippets: false,
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.backend).toBe('windsurf');
    expect(resolved.apiKeyRef).toBe('keychain:piwin-code-search-windsurf');
    expect(resolved.maxTurns).toBe(5);
    expect(resolved.treeDepth).toBe(0);
    expect(resolved.includeSnippets).toBe(false);
    // untouched fields still fall back to defaults
    expect(resolved.maxCommands).toBe(8);
    expect(resolved.maxResults).toBe(10);
  });

  it('keeps a model ref when the model backend is selected', () => {
    const resolved = resolveCodeSearchConfig({
      enabled: true,
      backend: 'model',
      model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
    });
    expect(resolved.model).toEqual({ providerId: 'custom-openai', modelId: 'gpt-5-mini' });
  });

  it('honors a stored empty exclude list as "exclude nothing"', () => {
    const resolved = resolveCodeSearchConfig({ enabled: true, excludePaths: [] });
    expect(resolved.excludePaths).toEqual([]);
  });

  it('does not expose undefined optional fields as own properties', () => {
    const resolved = resolveCodeSearchConfig({ enabled: true });
    expect(Object.keys(resolved)).not.toContain('apiKeyRef');
    expect(Object.keys(resolved)).not.toContain('apiKeyEnv');
  });
});

describe('isCodeSearchBackendReady', () => {
  it('requires a model on the model backend', () => {
    expect(isCodeSearchBackendReady(resolveCodeSearchConfig({ enabled: true }))).toBe(false);
    expect(
      isCodeSearchBackendReady(
        resolveCodeSearchConfig({
          enabled: true,
          backend: 'model',
          model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
        }),
      ),
    ).toBe(true);
  });

  it('requires credentials on the windsurf backend', () => {
    expect(
      isCodeSearchBackendReady(resolveCodeSearchConfig({ enabled: true, backend: 'windsurf' })),
    ).toBe(false);
    expect(
      isCodeSearchBackendReady(
        resolveCodeSearchConfig({
          enabled: true,
          backend: 'windsurf',
          apiKeyEnv: 'WINDSURF_API_KEY',
        }),
      ),
    ).toBe(true);
  });

  it('does not accept a model as windsurf credentials', () => {
    const resolved = resolveCodeSearchConfig({
      enabled: true,
      backend: 'windsurf',
      model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
    });
    expect(isCodeSearchBackendReady(resolved)).toBe(false);
  });
});
