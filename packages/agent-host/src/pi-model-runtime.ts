import type { ModelProviderConfig } from '@piwin/contracts';
import { DEFAULT_MODEL_CONTEXT_WINDOW } from '@piwin/contracts';

export type PiProviderApi = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';

export type PiModelRegistration = {
  id: string;
  name: string;
  api: PiProviderApi;
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
};

export type PiProviderRegistration = {
  name: string;
  baseUrl: string;
  api: PiProviderApi;
  apiKey?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  models: PiModelRegistration[];
};

export type PiModelRuntime = {
  registerProvider: (providerId: string, registration: PiProviderRegistration) => void;
  getModel: (providerId: string, modelId: string) => PiModelRegistration | undefined;
  refresh: (options: { allowNetwork: boolean }) => Promise<unknown>;
};

export function resolvePiApiForProvider(protocol: ModelProviderConfig['protocol']): PiProviderApi {
  switch (protocol) {
    case 'anthropic-compatible':
      return 'anthropic-messages';
    case 'google-gemini':
      return 'google-generative-ai';
    case 'openai-compatible':
      return 'openai-completions';
  }
}

export function buildPiProviderRegistration(
  provider: ModelProviderConfig,
  apiKey?: string,
): PiProviderRegistration {
  const api = resolvePiApiForProvider(provider.protocol);
  const registration: PiProviderRegistration = {
    name: provider.name,
    baseUrl: provider.baseUrl,
    api,
    authHeader: Boolean(apiKey || provider.apiKeyEnv?.trim() || provider.apiKeyRef?.trim()),
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.label?.trim() || model.id,
      api,
      baseUrl: provider.baseUrl,
      // Omit → true: preserve legacy "all models reasoning-capable" registration.
      reasoning: model.reasoning ?? true,
      // Omit → ['text']: safe default; do not claim vision without config.
      input: model.input ? [...model.input] : (['text'] as Array<'text' | 'image'>),
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: model.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW,
      maxTokens: model.maxOutputTokens ?? 8_192,
      ...(provider.headers ? { headers: provider.headers } : {}),
    })),
  };
  if (apiKey) {
    registration.apiKey = apiKey;
  }
  if (provider.headers) {
    registration.headers = provider.headers;
  }
  return registration;
}
