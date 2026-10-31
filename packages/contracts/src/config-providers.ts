/** Provider/model configuration and pure defaults. */
import { THINKING_LEVEL_OPTIONS } from './host.js';
import type { ThinkingLevel } from './host.js';
import type { ModelRequestBody } from './model-request-body.js';
import type { ModelSource } from './subscription-oauth.js';
import type { SystemPromptRoleMode } from './system-prompt-role.js';

/** Model capability tags. Drives tool routing and settings UI grouping. */
export type ModelCapability =
  | 'chat'
  | 'image-generation'
  | 'video-generation'
  | 'speech-to-text'
  | 'text-to-speech'
  | 'realtime-audio'
  | 'native-web-search';

/**
 * Request-shaping mechanism for provider-native web search. The value is
 * deliberately separate from both the model capability tag and the transport
 * protocol: `native-web-search` declares that the model CAN search natively;
 * `nativeSearchAdapter` declares HOW the provider wants that search expressed
 * on the wire.
 *
 * - `openai-web-search-options` — chat/completions `web_search_options` field.
 * - `openai-responses-tool`       — Responses API `tools: [{type: web_search}]`.
 * - `xai-web-search-tool`         — xAI Responses API `tools: [{type: web_search}]`.
 * - `anthropic-web-search-tool`   — Anthropic versioned `web_search_*` tool entry.
 * - `google-search-tool`          — Gemini `googleSearch` tool in `config.tools`.
 *
 * The adapter is the Host `web_search` sub-request wire shape. It is
 * independent of the provider's ordinary chat transport.
 */
export type NativeSearchAdapterKind =
  | 'openai-web-search-options'
  | 'openai-responses-tool'
  | 'xai-web-search-tool'
  | 'anthropic-web-search-tool'
  | 'google-search-tool';

/** Pi chat transport selected independently from provider protocol. */
export type ProviderChatApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'google-vertex'
  | 'bedrock-converse-stream';

export type AnthropicWebSearchToolType =
  | 'web_search_20250305'
  | 'web_search_20260209'
  | 'web_search_20260318';

export type NativeSearchAdapterOptions = {
  /** Options used only with `openai-responses-tool`. Default includeSources=true. */
  openaiResponses?: {
    includeSources?: boolean;
  };
  /** Options used only with `anthropic-web-search-tool`. */
  anthropic?: {
    toolType?: AnthropicWebSearchToolType;
    /** Newer tool versions default to `['direct']` when omitted. */
    allowedCallers?: readonly string[];
    /** Optional compatibility token merged into `anthropic-beta`. */
    betaToken?: string;
  };
};

/**
 * Provider wire formats used by the asynchronous video-generation adapters.
 * The value is deliberately separate from the provider protocol: vendors such
 * as Runway, Luma, and MiniMax do not share the OpenAI-compatible response
 * shape even when their base URL is configured alongside OpenAI providers.
 */
export type VideoGenerationApiStyle =
  | 'openai-videos'
  | 'google-veo'
  | 'runway-tasks'
  | 'luma-generations'
  | 'minimax-tasks'
  | 'xgrok-videos'
  | 'custom';

/**
 * Provider wire formats for image-generation routes. Like video api styles,
 * the value is independent of the provider protocol: a gateway registered as
 * an openai-compatible channel can still expose a Gemini-native image model
 * (e.g. `gemini-3.1-flash-image` behind `:generateContent`), and a
 * google-gemini channel can host OpenAI-shaped endpoints.
 *
 * - `openai` — POST /images/generations with an OpenAI body; parses
 *   `data[].b64_json` / `data[].url` (default for openai-compatible providers).
 * - `imagen` — POST /models/{id}:predict with `instances`/`parameters`;
 *   parses `predictions[].bytesBase64Encoded` (default for google-gemini).
 * - `gemini` — POST /models/{id}:generateContent with `contents` and
 *   `generationConfig.responseModalities: ['TEXT','IMAGE']`; parses
 *   `candidates[].content.parts[].inlineData` (and `fileData.fileUri`).
 */
export type ImageGenerationApiStyle = 'openai' | 'imagen' | 'gemini';

/** Input modalities a model accepts (Pi catalog / ModelRuntime). */
export type ModelInputModality = 'text' | 'image';

/** Per-capability route override (request path + timeout). */
export type ModelRouteConfig = {
  /** Custom request path appended to provider baseUrl (e.g. '/images/generations'). */
  path?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Provider wire format. Video routes use {@link VideoGenerationApiStyle};
   * image-generation routes use {@link ImageGenerationApiStyle} (defaults:
   * `openai` for openai-compatible, `imagen` for google-gemini). Chat routes
   * leave this unset.
   */
  apiStyle?: VideoGenerationApiStyle | ImageGenerationApiStyle;
  /** Polling cadence for async video jobs, in milliseconds. */
  pollIntervalMs?: number;
};

/** Per-model identity and optional runtime limits. */
export type ModelConfigEntry = {
  id: string;
  label?: string;
  /** Categorization: 'package' (subscription / preset bundle model) or 'custom' (user custom model). */
  category?: ModelCategory;
  /**
   * Model context window in tokens.
   * Used for usage ring / limit when host does not report tokensLimit.
   * Default applied at UI/host edges: {@link DEFAULT_MODEL_CONTEXT_WINDOW}.
   */
  contextWindow?: number;
  /** Maximum output tokens accepted by this model endpoint. */
  maxOutputTokens?: number;
  /** Optional Markdown shown when the model is hovered in a picker. */
  tooltipMarkdown?: string;
  /** Optional default thinking/reasoning effort level for this model. */
  thinkingLevel?: ThinkingLevel;
  /**
   * Thinking/reasoning effort levels supported by this model.
   * Omit or use an empty array to hide the composer effort selector.
   * `thinkingLevel`, when present, is the default selected value and must be
   * included in this list when the list is configured.
   */
  thinkingLevels?: readonly ThinkingLevel[];
  /** Capabilities this model supports. Omit = ['chat'] for backward compat. */
  capabilities?: ModelCapability[];
  /**
   * Request protocol for this model when it differs from its provider's
   * (ADR 0079), e.g. a Gemini model on a multi-format gateway row. Omitted =
   * inherit. Resolve through `resolveModelEndpoint`; ignored on subscriptions.
   */
  protocol?: ModelProviderConfig['protocol'];
  /**
   * Wire mechanism for native web search (ADR 0043). Optional: when omitted
   * on a tagged model, Host infers from protocol / official vendor host.
   * An explicit incompatible value fails closed.
   */
  nativeSearchAdapter?: NativeSearchAdapterKind;
  /** Adapter-specific native-search options. Ignored unless the adapter matches. */
  nativeSearchOptions?: NativeSearchAdapterOptions;
  /** Per-capability route overrides (path, timeout). */
  routes?: Partial<Record<ModelCapability, ModelRouteConfig>>;
  /**
   * Input modalities. Omit = treat as `['text']` (safe default: do not assume vision).
   * Source: catalog autocomplete / user checkbox / discover+catalog enrich.
   */
  input?: readonly ModelInputModality[];
  /**
   * Whether the model supports reasoning/thinking.
   * When omitted at Pi registration time, defaults to `true` (legacy behavior).
   */
  reasoning?: boolean;
  /** Overrides the provider `systemPromptRole` (ADR 0082). Omitted = inherit. */
  systemPromptRole?: SystemPromptRoleMode;
  /**
   * Extra HTTP headers for this model's requests, layered over the provider
   * `headers` (a same-named header, compared case-insensitively, wins).
   * Resolve through `resolveModelEndpoint` / `resolveModelHeaders`.
   */
  headers?: Record<string, string>;
  /**
   * Custom JSON deep-merged into every request body for this model (ADR 0095),
   * e.g. OpenRouter `provider` routing. Resolve through
   * `resolveModelRequestBody`; ignored on subscriptions.
   */
  extraBody?: ModelRequestBody;
  /**
   * Whether this model is available for use. Default true when omitted.
   * Disabled models remain in config but are excluded from Pi registration,
   * composer model lists, and default-model resolution.
   */
  enabled?: boolean;
};

/** Default context window when a model omits `contextWindow`. */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000;

/** Default maximum output tokens when a model omits `maxOutputTokens`. */
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 8_192;

/** Re-export the ordered thinking-level option set for consumers of this package. */
export { THINKING_LEVEL_OPTIONS };

/** Categorization for models and providers: 'package' (subscription / preset bundle) or 'custom' (BYOK / self-hosted). */
export type ModelCategory = 'package' | 'custom';

export type OpenAiCompatibleProviderConfig = {
  id: string;
  protocol: 'openai-compatible';
  /**
   * Actual Pi chat transport. Omitted legacy configs resolve to
   * `openai-completions`; Responses must be selected explicitly.
   */
  chatApi?: ProviderChatApi;
  name: string;
  /** Categorization: 'package' (subscription / preset package) or 'custom' (BYOK / self-hosted). */
  category?: ModelCategory;
  /** Omitted or `channel` is BYOK. `subscription` is a Models-page OAuth provider. */
  source?: ModelSource;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  /** Whether this provider is active. Default true when omitted. */
  enabled?: boolean;
  /** Extra HTTP headers sent with discovery and (when wired) provider requests. */
  headers?: Record<string, string>;
  /** System prompt role (ADR 0082). Omitted = Pi default (`developer` for reasoning models). */
  systemPromptRole?: SystemPromptRoleMode;
  models: ModelConfigEntry[];
};

export type AnthropicCompatibleProviderConfig = {
  id: string;
  protocol: 'anthropic-compatible';
  /** Actual Pi chat transport. Defaults to anthropic-messages. */
  chatApi?: ProviderChatApi;
  name: string;
  /** Categorization: 'package' (subscription / preset package) or 'custom' (BYOK / self-hosted). */
  category?: ModelCategory;
  source?: ModelSource;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  /** Whether this provider is active. Default true when omitted. */
  enabled?: boolean;
  /** Extra HTTP headers sent with discovery and (when wired) provider requests. */
  headers?: Record<string, string>;
  models: ModelConfigEntry[];
};

/** Google Generative Language API-compatible provider configuration. */
export type GoogleGeminiProviderConfig = {
  id: string;
  protocol: 'google-gemini';
  /** Actual Pi chat transport. Defaults to google-generative-ai. */
  chatApi?: ProviderChatApi;
  name: string;
  /** Categorization: 'package' (subscription / preset package) or 'custom' (BYOK / self-hosted). */
  category?: ModelCategory;
  source?: ModelSource;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  /** Whether this provider is active. Default true when omitted. */
  enabled?: boolean;
  /** Extra HTTP headers sent with discovery and (when wired) provider requests. */
  headers?: Record<string, string>;
  models: ModelConfigEntry[];
};

/**
 * Google Vertex AI provider (Pi `google-vertex`). Auth is Google ADC
 * (`gcloud auth application-default login`, service account JSON via
 * `credentialsFile` / GOOGLE_APPLICATION_CREDENTIALS) with automatic token
 * refresh, or an optional Vertex API key (express mode) via apiKeyRef/apiKeyEnv.
 * `baseUrl` is optional (empty = Google default endpoint for `location`).
 */
export type GoogleVertexProviderConfig = {
  id: string;
  protocol: 'google-vertex';
  chatApi?: ProviderChatApi;
  name: string;
  category?: ModelCategory;
  source?: ModelSource;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  /** GCP project id (falls back to GOOGLE_CLOUD_PROJECT). Also sent as x-goog-user-project. */
  project?: string;
  /** Vertex location, e.g. `global` or `us-central1` (default `global`). */
  location?: string;
  /** Optional service-account JSON path (else ADC default chain). */
  credentialsFile?: string;
  models: ModelConfigEntry[];
};

/**
 * Amazon Bedrock provider (Pi `bedrock-converse-stream`, Converse/ConverseStream).
 * Auth is the AWS default credential chain (env, profile, SSO, IMDS) or an
 * optional Bedrock API key (bearer, AWS_BEARER_TOKEN_BEDROCK) via apiKeyRef/apiKeyEnv.
 * `baseUrl` is optional (empty = standard bedrock-runtime endpoint for `region`).
 */
export type AmazonBedrockProviderConfig = {
  id: string;
  protocol: 'amazon-bedrock';
  chatApi?: ProviderChatApi;
  name: string;
  category?: ModelCategory;
  source?: ModelSource;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  /** AWS region (falls back to AWS_REGION / AWS_DEFAULT_REGION, then us-east-1). */
  region?: string;
  /** Named AWS profile from ~/.aws/config (SSO profiles supported). */
  profile?: string;
  models: ModelConfigEntry[];
};

export type ModelProviderConfig = (
  | OpenAiCompatibleProviderConfig
  | AnthropicCompatibleProviderConfig
  | GoogleGeminiProviderConfig
  | GoogleVertexProviderConfig
  | AmazonBedrockProviderConfig
) & {
  /** Host projection of the owning extension; shells display it as plain text. */
  extension?: { bundled?: boolean; notice?: string };
  /**
   * Model ids the user removed from a subscription provider. Live catalog
   * refresh must not seed them again until the user adds the id back.
   */
  removedModelIds?: string[];
};

/** Persist subscription deletions across catalog refresh / Host reseed. */
export function rememberRemovedProviderModels(
  provider: ModelProviderConfig,
  nextModels: ModelConfigEntry[],
): ModelProviderConfig {
  if (provider.source !== 'subscription') {
    return { ...provider, models: nextModels };
  }
  const kept = new Set(nextModels.map((model) => model.id));
  const removed = new Set(provider.removedModelIds ?? []);
  for (const model of provider.models) {
    if (!kept.has(model.id)) {
      removed.add(model.id);
    }
  }
  for (const id of kept) {
    removed.delete(id);
  }
  const next: ModelProviderConfig = { ...provider, models: nextModels };
  if (removed.size === 0) {
    if (next.removedModelIds === undefined) {
      return next;
    }
    const { removedModelIds: _removed, ...rest } = next;
    return rest;
  }
  return { ...next, removedModelIds: [...removed].sort() };
}

/** Default Vertex location when the provider row leaves it blank. */
export const DEFAULT_VERTEX_LOCATION = 'global';
/** Default Bedrock region when neither the row nor the environment sets one. */
export const DEFAULT_BEDROCK_REGION = 'us-east-1';

/** Cloud protocols whose auth is a platform credential chain, not a required API key. */
export function isCloudCredentialProtocol(protocol: ModelProviderConfig['protocol'] | undefined): boolean {
  return protocol === 'google-vertex' || protocol === 'amazon-bedrock';
}

/** Canonical transport for configs written before `chatApi` existed. */
export function defaultChatApiForProtocol(
  protocol: ModelProviderConfig['protocol'],
): ProviderChatApi {
  switch (protocol) {
    case 'openai-compatible':
      return 'openai-completions';
    case 'anthropic-compatible':
      return 'anthropic-messages';
    case 'google-gemini':
      return 'google-generative-ai';
    case 'google-vertex':
      return 'google-vertex';
    case 'amazon-bedrock':
      return 'bedrock-converse-stream';
  }
}

/** Resolve the explicit transport while preserving legacy provider configs. */
export function resolveProviderChatApi(
  provider: { protocol: ModelProviderConfig['protocol']; chatApi?: ProviderChatApi },
): ProviderChatApi {
  return provider.chatApi ?? defaultChatApiForProtocol(provider.protocol);
}

/** Default for the optional `enabled` field on providers. */
export const DEFAULT_PROVIDER_ENABLED = true;

/** A provider is active unless explicitly disabled. */
export function isProviderEnabled(provider: { enabled?: boolean }): boolean {
  return provider.enabled !== false;
}

/** Default for the optional `enabled` field on models. */
export const DEFAULT_MODEL_ENABLED = true;

/** A model is available unless explicitly disabled. */
export function isModelEnabled(model: { enabled?: boolean }): boolean {
  return model.enabled !== false;
}

/**
 * Resolves whether a provider belongs to 'package' (subscription / preset package)
 * or 'custom' (BYOK / self-hosted).
 *
 * Precedence:
 * 1. Explicit `category` ('package' | 'custom')
 * 2. `source === 'subscription'` -> 'package'
 * 3. Otherwise -> 'custom'
 */
export function resolveProviderCategory(provider: {
  category?: ModelCategory;
  source?: string;
}): ModelCategory {
  if (provider.category === 'package' || provider.category === 'custom') {
    return provider.category;
  }
  return provider.source === 'subscription' || provider.source === 'extension' ? 'package' : 'custom';
}

/**
 * Resolves whether a model belongs to 'package' or 'custom'.
 * If the model has an explicit category, uses it; otherwise inherits from the provider.
 */
export function resolveModelCategory(
  model: { category?: ModelCategory },
  provider?: { category?: ModelCategory; source?: string },
): ModelCategory {
  if (model.category === 'package' || model.category === 'custom') {
    return model.category;
  }
  if (provider) {
    return resolveProviderCategory(provider);
  }
  return 'custom';
}

/** Resolve one model's product capability with the legacy chat default. */
export function modelSupportsCapability(
  model: Pick<ModelConfigEntry, 'capabilities'>,
  capability: ModelCapability,
): boolean {
  const capabilities = model.capabilities;
  if (capability === 'chat') {
    return (
      capabilities === undefined ||
      capabilities.length === 0 ||
      capabilities.includes('chat') ||
      // Provider-native search produces a text answer, so the tag implies the
      // chat surface even when older UI writes only the auxiliary capability.
      capabilities.includes('native-web-search')
    );
  }
  return capabilities?.includes(capability) ?? false;
}

/** Normalized model identity returned from a provider's discovery endpoint. */
export type DiscoveredModel = {
  id: string;
  label?: string;
  /** Filled by host catalog enrich after discover (optional). */
  input?: readonly ModelInputModality[];
  reasoning?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  /**
   * Capabilities inferred by the host during discovery.
   * Image-only registry rows get `['image-generation']`; chat+image hybrids
   * (Gemini image, heuristic gateway ids) also include `chat`.
   */
  capabilities?: ModelCapability[];
  /**
   * Suggested native-search wire shape from official-vendor discovery.
   * Desktop import fills `ModelConfigEntry.nativeSearchAdapter` only when
   * the configured row does not already have one.
   */
  nativeSearchAdapter?: NativeSearchAdapterKind;
  /**
   * Video-generation suggestion from explicit provider metadata, the curated
   * registry, or a name heuristic. Registry and provider matches may also set
   * `capabilities` to include `video-generation`; heuristic-only matches never
   * auto-enable the capability (ADR 0043).
   */
  videoGenerationSuggestion?: {
    reason: 'provider' | 'registry' | 'heuristic';
    apiStyle?: VideoGenerationApiStyle;
    path?: string;
    label?: string;
  };
};

/** Safe model discovery payload. Never includes API credentials. */
export type ModelDiscoveryResult = {
  providerId: string;
  protocol: ModelProviderConfig['protocol'];
  models: DiscoveredModel[];
  /**
   * Present when the provider answered but exposes no usable `/models`
   * (404/405 or a non-list body). Not a connection failure — chat may still
   * work. Auth, 5xx, timeout and network errors stay thrown.
   */
  catalogUnavailable?: {
    httpStatus?: number;
  };
};
