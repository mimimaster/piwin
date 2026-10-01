import type {
  ModelCapability,
  ModelProviderConfig,
  ProviderChatApi,
} from '@piwin/contracts';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  isModelEnabled,
  resolveModelEndpoint,
  resolveSupportsDeveloperRole,
  modelSupportsCapability,
} from '@piwin/contracts';
import { lookupCatalogByModelId } from './model-catalog-reader.js';
import { buildThinkingLevelMap, type PiThinkingLevelMap } from './map-thinking-level.js';
import {
  resolveRegistrationStreamSimple,
  type RegistrationModelStreamFlags,
} from './attach-provider-stream-simple.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

export type PiProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

export type PiModelCompat = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: 'deepseek';
};

/**
 * DeepSeek / Grok behind a local OpenAI-compatible gateway cannot be detected
 * from the base URL (Pi only keys off provider id and vendor hosts). Keep
 * these model-id prefixes as explicit compatibility rules: they mirror Pi's
 * native request shape without changing the product protocol or affecting
 * Anthropic/Google registrations.
 *
 * Grok: keep `store` and developer-role off (same as Pi on `api.x.ai`). Do
 * **not** disable `reasoning_effort`. Pi only writes that field when
 * `compat.supportsReasoningEffort === true`. CPA and similar chat→Responses
 * gateways hard-default `reasoning.effort` to `medium` when the client omits
 * it, so a global `false` made the UI thinking level a no-op.
 *
 * If a specific gateway still loops the reasoning channel when effort is
 * present, narrow that in the gateway/response path — do not drop the UI
 * effort for every grok OpenAI-compat model.
 */
const DEEPSEEK_MODEL_ID_PREFIX = 'deepseek';
const GROK_MODEL_ID_PREFIX = 'grok';

const DEEPSEEK_OPENAI_COMPAT: PiModelCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: 'max_tokens',
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: 'deepseek',
};

const GROK_OPENAI_COMPAT: PiModelCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
};

function openaiCompatModelName(modelId: string): string {
  const id = modelId.trim().toLowerCase();
  const slash = id.lastIndexOf('/');
  return slash >= 0 ? id.slice(slash + 1) : id;
}

/**
 * Resolve the Pi wire compatibility profile hidden by local gateway URLs.
 *
 * `supportsDeveloperRole` is the Host-resolved product setting (ADR 0082);
 * when defined it wins over the model-id rule and also applies to Responses.
 */
export function resolvePiModelCompat(
  api: PiProviderApi,
  modelId: string,
  supportsDeveloperRole?: boolean,
): PiModelCompat | undefined {
  const base = modelIdCompat(api, modelId);
  const isOpenAiWire = api === 'openai-completions' || api === 'openai-responses';
  if (supportsDeveloperRole === undefined || !isOpenAiWire) {
    return base;
  }
  return { ...base, supportsDeveloperRole };
}

function modelIdCompat(api: PiProviderApi, modelId: string): PiModelCompat | undefined {
  if (api !== 'openai-completions') {
    return undefined;
  }
  const modelName = openaiCompatModelName(modelId);
  if (modelName.startsWith(DEEPSEEK_MODEL_ID_PREFIX)) {
    return { ...DEEPSEEK_OPENAI_COMPAT };
  }
  if (modelName.startsWith(GROK_MODEL_ID_PREFIX)) {
    return { ...GROK_OPENAI_COMPAT };
  }
  return undefined;
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
  nativeSearchOptions?: import('@piwin/contracts').NativeSearchAdapterOptions;
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
  /** Existing custom streamSimple to wrap. */
  streamSimple?: NativeSearchStreamSimple;
  /**
   * Inject hosted search into the payload. Only the Host `web_search` native
   * executor sets this; main-session registrations must not (ADR 0043).
   */
  injectNativeSearch?: boolean;
};

/**
 * Pi transport for a product provider row. `chatApi: 'openai-responses'` is
 * honoured only on OpenAI-compatible rows (Pi calls `{baseUrl}/responses`);
 * every other combination keeps the protocol default so a stray value cannot
 * select an impossible wire. Omitted protocol (legacy envelopes) is OpenAI.
 */
export function resolvePiApiForProvider(
  protocol: ModelProviderConfig['protocol'] | undefined,
  chatApi?: ProviderChatApi,
): PiProviderApi {
  switch (protocol) {
    case 'anthropic-compatible':
      return 'anthropic-messages';
    case 'google-gemini':
      return 'google-generative-ai';
    case 'openai-compatible':
    case undefined:
      return chatApi === 'openai-responses' ? 'openai-responses' : 'openai-completions';
  }
}

export function resolvePiModelLimits(model: {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}): { contextWindow: number; maxTokens: number } {
  const catalog = lookupCatalogByModelId(model.id);
  return {
    contextWindow:
      positiveLimit(model.contextWindow) ??
      positiveLimit(catalog?.contextWindow) ??
      DEFAULT_MODEL_CONTEXT_WINDOW,
    maxTokens:
      positiveLimit(model.maxOutputTokens) ??
      positiveLimit(catalog?.maxTokens) ??
      DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  };
}

function positiveLimit(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function buildPiProviderRegistration(
  provider: ModelProviderConfig,
  apiKey?: string,
  options: BuildPiProviderRegistrationOptions = {},
): PiProviderRegistration {
  const api = resolvePiApiForProvider(provider.protocol, provider.chatApi);
  const models: PiModelRegistration[] = provider.models
    .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
    .map((model) => {
      // ADR 0079: a model may speak another wire format than its provider row.
      const endpoint = resolveModelEndpoint(provider, model);
      const modelApi = resolvePiApiForProvider(endpoint.protocol, endpoint.chatApi);
      const thinkingLevelMap =
        model.reasoning === false
          ? undefined
          : buildThinkingLevelMap(model.thinkingLevels, endpoint.protocol);
      const compat = resolvePiModelCompat(
        modelApi,
        model.id,
        resolveSupportsDeveloperRole(provider, model),
      );
      const registration: PiModelRegistration = {
        id: model.id,
        name: model.label?.trim() || model.id,
        api: modelApi,
        baseUrl: endpoint.baseUrl,
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
        ...resolvePiModelLimits(model),
        ...(provider.headers ? { headers: provider.headers } : {}),
      };
      if (model.capabilities?.length) {
        registration.capabilities = [...model.capabilities];
      }
      if (model.nativeSearchAdapter) {
        registration.nativeSearchAdapter = model.nativeSearchAdapter;
      }
      if (model.nativeSearchOptions) {
        registration.nativeSearchOptions = model.nativeSearchOptions;
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

  const streamFlags: RegistrationModelStreamFlags[] = models.map((model) => ({
    id: model.id,
    api: model.api,
    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
    ...(model.nativeSearchAdapter ? { nativeSearchAdapter: model.nativeSearchAdapter } : {}),
    ...(model.nativeSearchOptions ? { nativeSearchOptions: model.nativeSearchOptions } : {}),
  }));
  const streamSimple = resolveRegistrationStreamSimple({
    defaultApi: api,
    models: streamFlags,
    // Optional under exactOptionalPropertyTypes: omit rather than pass undefined.
    ...(options.streamSimple === undefined ? {} : { streamSimple: options.streamSimple }),
    ...(options.injectNativeSearch ? { injectNativeSearch: true } : {}),
  });
  if (streamSimple) {
    registration.streamSimple = streamSimple;
  }

  return registration;
}
