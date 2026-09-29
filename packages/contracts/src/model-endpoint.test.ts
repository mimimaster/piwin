import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from './config.js';
import {
  rebaseForProtocol,
  resolveModelEndpoint,
  resolveModelProtocol,
} from './model-endpoint.js';

const cpa: ModelProviderConfig = {
  id: 'cpa',
  name: 'CPA',
  protocol: 'openai-compatible',
  chatApi: 'openai-responses',
  baseUrl: 'http://127.0.0.1:8317/v1',
  apiKeyRef: 'keychain:cpa',
  headers: { 'x-extra': '1' },
  models: [
    { id: 'grok-4.7' },
    { id: 'gemini-3.8-flash-high', protocol: 'google-gemini' },
  ],
};

describe('per-model request protocol', () => {
  it('inherits the provider when the model has no override', () => {
    expect(resolveModelEndpoint(cpa, cpa.models[0])).toBe(cpa);
    expect(resolveModelProtocol(cpa, undefined)).toBe('openai-compatible');
  });

  it('re-versions the gateway base and drops the provider chatApi for an override', () => {
    const view = resolveModelEndpoint(cpa, cpa.models[1]);
    expect(view).toMatchObject({
      id: 'cpa',
      protocol: 'google-gemini',
      baseUrl: 'http://127.0.0.1:8317/v1beta',
      apiKeyRef: 'keychain:cpa',
      headers: { 'x-extra': '1' },
    });
    expect(view.chatApi).toBeUndefined();
  });

  it('rebases between every wire format', () => {
    expect(rebaseForProtocol('http://h:1/v1/', 'google-gemini')).toBe('http://h:1/v1beta');
    expect(rebaseForProtocol('https://g.example/v1beta', 'openai-compatible')).toBe('https://g.example/v1');
    expect(rebaseForProtocol('http://h:1/v1', 'anthropic-compatible')).toBe('http://h:1');
    expect(rebaseForProtocol('http://h:1', 'google-gemini')).toBe('http://h:1/v1beta');
  });

  it('ignores overrides on subscriptions and unknown values', () => {
    const subscription: ModelProviderConfig = {
      id: 'xai',
      name: 'Grok',
      protocol: 'openai-compatible',
      baseUrl: 'oauth://xai',
      source: 'subscription',
      models: [],
    };
    expect(resolveModelProtocol(subscription, { protocol: 'google-gemini' })).toBe('openai-compatible');
    expect(resolveModelProtocol(cpa, { protocol: 'bogus' as never })).toBe('openai-compatible');
  });
});
