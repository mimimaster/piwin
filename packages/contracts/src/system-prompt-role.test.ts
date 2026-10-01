import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from './config.js';
import { isSystemPromptRoleMode, resolveSupportsDeveloperRole } from './system-prompt-role.js';

function openAiRow(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'qwen',
    name: 'Qwen',
    protocol: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [{ id: 'qwen3.8-max' }],
    ...overrides,
  } as ModelProviderConfig;
}

describe('system prompt role (ADR 0082)', () => {
  it('leaves the default (developer) alone when nothing is chosen, whatever the host', () => {
    expect(resolveSupportsDeveloperRole(openAiRow(), { id: 'qwen3.8-max' } as never)).toBeUndefined();
    expect(
      resolveSupportsDeveloperRole(openAiRow({ baseUrl: 'http://127.0.0.1:8317/v1' }), undefined),
    ).toBeUndefined();
  });

  it('sends system only when the provider opts in', () => {
    expect(resolveSupportsDeveloperRole(openAiRow({ systemPromptRole: 'system' }), undefined)).toBe(
      false,
    );
    expect(
      resolveSupportsDeveloperRole(openAiRow({ systemPromptRole: 'developer' }), undefined),
    ).toBe(true);
  });

  it('a model override wins over the provider', () => {
    const provider = openAiRow({ systemPromptRole: 'system' });
    expect(resolveSupportsDeveloperRole(provider, { systemPromptRole: 'developer' })).toBe(true);
    expect(resolveSupportsDeveloperRole(openAiRow(), { systemPromptRole: 'system' })).toBe(false);
    expect(resolveSupportsDeveloperRole(provider, {})).toBe(false);
  });

  it('does not apply to non-OpenAI wires or subscription rows', () => {
    const anthropic = {
      id: 'a',
      name: 'A',
      protocol: 'anthropic-compatible',
      baseUrl: 'https://api.anthropic.com',
      models: [],
    } as ModelProviderConfig;
    expect(resolveSupportsDeveloperRole(anthropic, { systemPromptRole: 'system' })).toBeUndefined();
    // A Gemini override on an OpenAI gateway row leaves the OpenAI wire.
    expect(
      resolveSupportsDeveloperRole(openAiRow({ systemPromptRole: 'system' }), {
        protocol: 'google-gemini',
      }),
    ).toBeUndefined();
    expect(
      resolveSupportsDeveloperRole(
        openAiRow({ source: 'subscription', systemPromptRole: 'system' }),
        undefined,
      ),
    ).toBeUndefined();
  });

  it('an OpenAI override on a non-OpenAI row takes the model setting', () => {
    const anthropicGateway = {
      id: 'gw',
      name: 'GW',
      protocol: 'anthropic-compatible',
      baseUrl: 'http://127.0.0.1:8317',
      models: [],
    } as ModelProviderConfig;
    expect(
      resolveSupportsDeveloperRole(anthropicGateway, {
        protocol: 'openai-compatible',
        systemPromptRole: 'system',
      }),
    ).toBe(false);
    expect(
      resolveSupportsDeveloperRole(anthropicGateway, { protocol: 'openai-compatible' }),
    ).toBeUndefined();
  });

  it('guards the mode literal', () => {
    expect(isSystemPromptRoleMode('system')).toBe(true);
    expect(isSystemPromptRoleMode('auto')).toBe(false);
    expect(isSystemPromptRoleMode(undefined)).toBe(false);
  });
});
