import { describe, expect, it } from 'vitest';
import type { CompactionConfig, ModelProviderConfig } from './config.js';
import {
  findReadyCompactionDelegate,
  resolveActiveCompactionDelegation,
} from './compaction.js';

function makeProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'delegate-provider',
    protocol: 'openai-compatible',
    name: 'Delegate',
    baseUrl: 'https://delegate.example.test/v1',
    models: [{ id: 'summary-model', capabilities: ['chat'] }],
    ...overrides,
  };
}

describe('compaction delegation helpers', () => {
  it('returns undefined when delegation is absent, disabled, or lacks a model', () => {
    expect(resolveActiveCompactionDelegation(undefined)).toBeUndefined();
    expect(resolveActiveCompactionDelegation({ autoEnabledDefault: true })).toBeUndefined();
    expect(
      resolveActiveCompactionDelegation({
        autoEnabledDefault: true,
        delegation: {
          enabled: false,
          model: {
            protocol: 'openai-compatible',
            providerId: 'delegate-provider',
            modelId: 'summary-model',
          },
        },
      }),
    ).toBeUndefined();
    expect(
      resolveActiveCompactionDelegation({
        autoEnabledDefault: true,
        delegation: { enabled: true },
      }),
    ).toBeUndefined();
  });

  it('resolves the active delegation target when enabled with a model', () => {
    const model = {
      protocol: 'openai-compatible' as const,
      providerId: 'delegate-provider',
      modelId: 'summary-model',
    };
    const compaction: CompactionConfig = {
      autoEnabledDefault: true,
      delegation: { enabled: true, model },
    };

    expect(resolveActiveCompactionDelegation(compaction)).toEqual({ model });
  });

  it('findReadyCompactionDelegate checks provider and model enablement plus chat capability', () => {
    const model = {
      protocol: 'openai-compatible' as const,
      providerId: 'delegate-provider',
      modelId: 'summary-model',
    };
    const compaction: CompactionConfig = {
      autoEnabledDefault: true,
      delegation: { enabled: true, model },
    };

    expect(
      findReadyCompactionDelegate({
        compaction,
        providers: [makeProvider()],
      }),
    ).toEqual(model);

    expect(
      findReadyCompactionDelegate({
        compaction,
        providers: [makeProvider({ enabled: false })],
      }),
    ).toBeUndefined();

    expect(
      findReadyCompactionDelegate({
        compaction,
        providers: [makeProvider({ models: [{ id: 'summary-model', enabled: false }] })],
      }),
    ).toBeUndefined();

    expect(
      findReadyCompactionDelegate({
        compaction,
        providers: [makeProvider({ models: [{ id: 'summary-model', capabilities: ['image-generation'] }] })],
      }),
    ).toBeUndefined();
  });
});
