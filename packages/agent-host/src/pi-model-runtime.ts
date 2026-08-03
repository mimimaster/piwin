import type { ModelProviderConfig } from '@piwin/contracts';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from '@piwin/contracts';

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
      maxTokens: model.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
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

/**
 * Pi strips ImageContent when `model.input` lacks `"image"` (see pi-ai
 * `downgradeUnsupportedImages`). If the host is about to send native images,
 * force-vision on the Model object passed to `setModel` so pixels are not
 * replaced with "(image omitted: model does not support images)".
 */
export function ensureModelAcceptsImages<T extends { input?: Array<'text' | 'image'> }>(
  model: T,
): T {
  const currentInput = model.input ?? (['text'] as Array<'text' | 'image'>);
  if (currentInput.includes('image')) {
    return model;
  }
  const nextInput: Array<'text' | 'image'> = currentInput.includes('text')
    ? ['text', 'image']
    : [...currentInput, 'image'];
  return { ...model, input: nextInput };
}
