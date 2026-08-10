import type {
  ModelCapability,
  ModelProviderConfig,
  NativeWebSearchMode,
  ResolvedSearchRoute,
} from '@piwin/contracts';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  isModelEnabled,
  modelSupportsCapability,
} from '@piwin/contracts';
import { buildThinkingLevelMap, type PiThinkingLevelMap } from './map-thinking-level.js';
import {
  providerNeedsNativeSearchWrapper,
  wrapStreamSimpleForNativeSearch,
  type NativeSearchModelFlags,
  type NativeSearchStreamSimple,
} from './native-web-search.js';

export type PiProviderApi = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';

export type PiModelRegistration = {
  id: string;
  name: string;
  api: PiProviderApi;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: PiThinkingLevelMap;
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
  /** Product capability tags retained for native-search request shaping. */
  capabilities?: ModelCapability[];
  nativeWebSearchMode?: NativeWebSearchMode;
};

export type PiProviderRegistration = {
  name: string;
  baseUrl: string;
  api: PiProviderApi;
  apiKey?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  models: PiModelRegistration[];
  /**
   * Optional custom streamSimple. When native search routing is active the
   * Host wraps this (or the Pi default) to inject/disable provider search.
   */
  streamSimple?: NativeSearchStreamSimple;
};

export type PiModelRuntime = {
  registerProvider: (providerId: string, registration: PiProviderRegistration) => void;
  getModel: (providerId: string, modelId: string) => PiModelRegistration | undefined;
  refresh: (options: { allowNetwork: boolean }) => Promise<unknown>;
};

export type BuildPiProviderRegistrationOptions = {
  /** Resolved search outlet for this generation (ADR 0043). */
  searchRoute?: ResolvedSearchRoute | null | undefined;
  /** Existing custom streamSimple to wrap. */
  streamSimple?: NativeSearchStreamSimple;
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
  options: BuildPiProviderRegistrationOptions = {},
): PiProviderRegistration {
  const api = resolvePiApiForProvider(provider.protocol);
  const models: PiModelRegistration[] = provider.models
    .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
    .map((model) => {
      const thinkingLevelMap =
        model.reasoning === false
          ? undefined
          : buildThinkingLevelMap(model.thinkingLevels, provider.protocol);
      const registration: PiModelRegistration = {
        id: model.id,
        name: model.label?.trim() || model.id,
        api,
        baseUrl: provider.baseUrl,
        // Omit → true: preserve legacy "all models reasoning-capable" registration.
        reasoning: model.reasoning ?? true,
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
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
      };
      if (model.capabilities?.length) {
        registration.capabilities = [...model.capabilities];
      }
      if (model.nativeWebSearchMode) {
        registration.nativeWebSearchMode = model.nativeWebSearchMode;
      }
      return registration;
    });

  const registration: PiProviderRegistration = {
    name: provider.name,
    baseUrl: provider.baseUrl,
    api,
    authHeader: Boolean(apiKey || provider.apiKeyEnv?.trim() || provider.apiKeyRef?.trim()),
    models,
  };
  if (apiKey) {
    registration.apiKey = apiKey;
  }
  if (provider.headers) {
    registration.headers = provider.headers;
  }

  const nativeFlags: NativeSearchModelFlags[] = models.map((model) => ({
    id: model.id,
    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
    ...(model.nativeWebSearchMode ? { nativeWebSearchMode: model.nativeWebSearchMode } : {}),
  }));
  if (providerNeedsNativeSearchWrapper(nativeFlags, options.searchRoute)) {
    const wrapped = wrapStreamSimpleForNativeSearch(options.streamSimple, {
      models: nativeFlags,
      searchRoute: options.searchRoute ?? null,
    });
    if (wrapped) {
      registration.streamSimple = wrapped;
    }
  } else if (options.streamSimple) {
    registration.streamSimple = options.streamSimple;
  }

  return registration;
}
