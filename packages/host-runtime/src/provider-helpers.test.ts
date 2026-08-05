import { describe, expect, it } from 'vitest';
import {
  findEnabledModel,
  findEnabledProvider,
  getEnabledProviders,
  resolveConfiguredDefaultModelRef,
  resolveDefaultModelRef,
} from './provider-helpers.js';
import type { ModelProviderConfig } from '@piwin/contracts';

function makeProvider(partial: Partial<ModelProviderConfig> & { id: string }): ModelProviderConfig {
  const { id, name, models, protocol, baseUrl, ...rest } = partial;
  return {
    id,
    protocol: protocol ?? 'openai-compatible',
    name: name ?? id,
    baseUrl: baseUrl ?? 'https://api.example.com/v1',
    models: models ?? [{ id: 'model-a' }],
    ...rest,
  };
}

describe('provider-helpers', () => {
  it('getEnabledProviders defaults enabled to true and excludes explicitly disabled', () => {
    const providers = [
      makeProvider({ id: 'a' }),
      makeProvider({ id: 'b', enabled: false }),
      makeProvider({ id: 'c', enabled: true }),
    ];
    expect(getEnabledProviders({ providers })).toHaveLength(2);
    expect(getEnabledProviders({ providers }).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('findEnabledProvider returns enabled provider by id', () => {
    const providers = [makeProvider({ id: 'a' }), makeProvider({ id: 'b', enabled: false })];
    expect(findEnabledProvider({ providers }, 'a')?.id).toBe('a');
    expect(findEnabledProvider({ providers }, 'b')).toBeUndefined();
    expect(findEnabledProvider({ providers }, 'missing')).toBeUndefined();
  });

  it('findEnabledModel returns a model from an enabled provider', () => {
    const providers = [
      makeProvider({ id: 'a', models: [{ id: 'a-1' }, { id: 'a-2' }] }),
      makeProvider({ id: 'b', enabled: false, models: [{ id: 'b-1' }] }),
    ];
    expect(findEnabledModel({ providers }, 'a', 'a-2')?.id).toBe('a-2');
    expect(findEnabledModel({ providers }, 'b', 'b-1')).toBeUndefined();
  });

  it('resolveConfiguredDefaultModelRef only returns the configured default when enabled', () => {
    const config = {
      defaultProviderId: 'a',
      defaultModelId: 'a-1',
      providers: [makeProvider({ id: 'a', models: [{ id: 'a-1' }] })],
    };
    expect(resolveConfiguredDefaultModelRef(config)?.modelId).toBe('a-1');

    const missing = {
      defaultProviderId: 'a',
      defaultModelId: 'missing',
      providers: [makeProvider({ id: 'a', models: [{ id: 'a-1' }] })],
    };
    expect(resolveConfiguredDefaultModelRef(missing)).toBeUndefined();

    const disabled = {
      defaultProviderId: 'a',
      defaultModelId: 'a-1',
      providers: [makeProvider({ id: 'a', enabled: false, models: [{ id: 'a-1' }] })],
    };
    expect(resolveConfiguredDefaultModelRef(disabled)).toBeUndefined();
  });

  it('resolveDefaultModelRef falls back to first enabled provider/model', () => {
    const config = {
      providers: [
        makeProvider({ id: 'b', enabled: false, models: [{ id: 'b-1' }] }),
        makeProvider({ id: 'a', models: [{ id: 'a-1' }] }),
      ],
    };
    const ref = resolveDefaultModelRef(config);
    expect(ref?.providerId).toBe('a');
    expect(ref?.modelId).toBe('a-1');
  });

  it('findEnabledModel excludes disabled models', () => {
    const providers = [
      makeProvider({
        id: 'a',
        models: [{ id: 'a-1' }, { id: 'a-2', enabled: false }],
      }),
    ];
    expect(findEnabledModel({ providers }, 'a', 'a-1')?.id).toBe('a-1');
    expect(findEnabledModel({ providers }, 'a', 'a-2')).toBeUndefined();
  });

  it('resolveConfiguredDefaultModelRef returns undefined when default model is disabled', () => {
    const config = {
      defaultProviderId: 'a',
      defaultModelId: 'a-2',
      providers: [
        makeProvider({
          id: 'a',
          models: [{ id: 'a-1' }, { id: 'a-2', enabled: false }],
        }),
      ],
    };
    expect(resolveConfiguredDefaultModelRef(config)).toBeUndefined();
  });

  it('resolveDefaultModelRef skips disabled models when falling back', () => {
    const config = {
      providers: [
        makeProvider({
          id: 'a',
          models: [{ id: 'a-1', enabled: false }, { id: 'a-2' }],
        }),
      ],
    };
    const ref = resolveDefaultModelRef(config);
    expect(ref?.providerId).toBe('a');
    expect(ref?.modelId).toBe('a-2');
  });

  it('resolveDefaultModelRef returns undefined when all models are disabled', () => {
    const config = {
      providers: [
        makeProvider({
          id: 'a',
          models: [{ id: 'a-1', enabled: false }],
        }),
      ],
    };
    expect(resolveDefaultModelRef(config)).toBeUndefined();
  });
});
