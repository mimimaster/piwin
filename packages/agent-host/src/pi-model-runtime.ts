import type { ModelCapability, ModelProviderConfig, ResolvedSearchRoute } from '@piwin/contracts';
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
import { resolvePiNativeSearchStream } from './pi-native-search-stream.js';

export type PiProviderApi = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';

export type PiModelCompat = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsFinishReason?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: 'deepseek';
};

/**
 * DeepSeek models behind a local OpenAI-compatible gateway cannot be detected
 * from the base URL. Keep this model-id prefix as an explicit compatibility
 * rule: it mirrors Pi's DeepSeek/OpenCode request shape without changing the
 * product protocol or affecting Anthropic/Google registrations.
 */
const DEEPSEEK_MODEL_ID_PREFIX = 'deepseek';

const DEEPSEEK_OPENAI_COMPAT: PiModelCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: 'max_tokens',
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: 'deepseek',
};

/**
 * OpenAI-completions gateways (CPA, OpenCode Zen, llama.cpp) often close the
 * SSE stream without `finish_reason`. Pi 0.84 still treats that as a retryable
 * transport error unless this flag is false.
 */
const OPENAI_COMPLETIONS_COMPAT: PiModelCompat = {
  supportsFinishReason: false,
};

/** Resolve the Pi wire compatibility profile hidden by local gateway URLs. */
export function resolvePiModelCompat(
  api: PiProviderApi,
  modelId: string,
): PiModelCompat | undefined {
  if (api !== 'openai-completions') {
    return undefined;
  }
  if (modelId.trim().toLowerCase().startsWith(DEEPSEEK_MODEL_ID_PREFIX)) {
    return { ...DEEPSEEK_OPENAI_COMPAT, ...OPENAI_COMPLETIONS_COMPAT };
  }
  return { ...OPENAI_COMPLETIONS_COMPAT };
}

export type PiModelRegistration = {
  id: string;
  name: string;
  api: PiProviderApi;
  baseUrl: string;
  reasoning: boolean;
  compat?: PiModelCompat;
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
  /** Declared native-search request-shaping mechanism (ADR 0043). */
  nativeSearchAdapter?: import('@piwin/contracts').NativeSearchAdapterKind;
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
      const compat = resolvePiModelCompat(api, model.id);
      const registration: PiModelRegistration = {
        id: model.id,
        name: model.label?.trim() || model.id,
        api,
        baseUrl: provider.baseUrl,
        // Omit → true: preserve legacy "all models reasoning-capable" registration.
        reasoning: model.reasoning ?? true,
        ...(compat ? { compat } : {}),
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
      if (model.nativeSearchAdapter) {
        registration.nativeSearchAdapter = model.nativeSearchAdapter;
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
    ...(model.nativeSearchAdapter ? { nativeSearchAdapter: model.nativeSearchAdapter } : {}),
  }));
  if (providerNeedsNativeSearchWrapper(nativeFlags, options.searchRoute)) {
    const wrapped = wrapStreamSimpleForNativeSearch(options.streamSimple, {
      models: nativeFlags,
      searchRoute: options.searchRoute ?? null,
      fallbackStreamSimple: resolvePiNativeSearchStream(api),
    });
    if (wrapped) {
      registration.streamSimple = wrapped;
    }
  } else if (options.streamSimple) {
    registration.streamSimple = options.streamSimple;
  }

  return registration;
}
