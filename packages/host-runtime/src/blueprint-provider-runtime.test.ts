import { describe, expect, it } from 'vitest';
import { buildWorkerProviderRegistration } from '@piwin/agent-host';
import { createDefaultPiwinConfig } from './config-store.js';
import { buildProviderEnvelope } from './blueprint-provider-runtime.js';

describe('provider envelope per-model protocol (ADR 0079)', () => {
  it('carries a Host-resolved wire for an overriding model and the worker registers it', async () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'cpa',
        name: 'CPA',
        protocol: 'openai-compatible',
        chatApi: 'openai-responses',
        baseUrl: 'http://127.0.0.1:8317/v1',
        models: [{ id: 'grok-4.7' }, { id: 'gemini-3.8-flash-high', protocol: 'google-gemini' }],
      },
    ];
    const { providers } = await buildProviderEnvelope(config, {
      allowInlineProviderSecrets: false,
      allowWorkerProviderSecretBootstrap: false,
    });
    const cpa = providers.find((provider) => provider.providerId === 'cpa');
    expect(cpa?.models.find((model) => model.id === 'grok-4.7')).not.toHaveProperty('protocol');
    expect(cpa?.models.find((model) => model.id === 'gemini-3.8-flash-high')).toMatchObject({
      protocol: 'google-gemini',
      baseUrl: 'http://127.0.0.1:8317/v1beta',
    });

    if (!cpa) throw new Error('cpa envelope missing');
    const registration = buildWorkerProviderRegistration(cpa, 'gw-key');
    const byId = new Map(registration.models.map((model) => [model.id, model]));
    // The provider chatApi (Responses) applies only to models that inherit it.
    expect(byId.get('grok-4.7')).toMatchObject({ api: 'openai-responses' });
    expect(byId.get('gemini-3.8-flash-high')).toMatchObject({
      api: 'google-generative-ai',
      baseUrl: 'http://127.0.0.1:8317/v1beta',
    });
    expect(registration.streamSimple).toBeTypeOf('function');
  });
});

describe('provider envelope system prompt role (ADR 0082)', () => {
  it('carries only an opted-in role per model to the worker registration', async () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'qwen',
        name: 'Qwen',
        protocol: 'openai-compatible',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        systemPromptRole: 'system',
        models: [{ id: 'qwen3.8-max' }, { id: 'qwen-plus', systemPromptRole: 'developer' }],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-5.6' }],
      },
      {
        id: 'claude',
        name: 'Claude',
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        models: [{ id: 'claude-opus-5', systemPromptRole: 'system' }],
      },
    ];
    const { providers } = await buildProviderEnvelope(config, {
      allowInlineProviderSecrets: false,
      allowWorkerProviderSecretBootstrap: false,
    });
    const byId = new Map(providers.map((provider) => [provider.providerId, provider]));
    expect(byId.get('qwen')?.models).toEqual([
      expect.objectContaining({ id: 'qwen3.8-max', supportsDeveloperRole: false }),
      expect.objectContaining({ id: 'qwen-plus', supportsDeveloperRole: true }),
    ]);
    expect(byId.get('openai')?.models[0]).not.toHaveProperty('supportsDeveloperRole');
    expect(byId.get('claude')?.models[0]).not.toHaveProperty('supportsDeveloperRole');

    const qwen = byId.get('qwen');
    if (!qwen) throw new Error('qwen envelope missing');
    const registration = buildWorkerProviderRegistration(qwen, undefined);
    expect(registration.models[0]?.compat).toEqual({ supportsDeveloperRole: false });
  });
});
