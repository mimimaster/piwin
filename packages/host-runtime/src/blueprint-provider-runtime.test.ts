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
