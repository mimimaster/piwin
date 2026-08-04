/** Product config shapes stored under ~/.piwin */

import type { WebConfig } from './web.js';
import type { SkillsConfig } from './skills.js';
import type { ExtensionsConfig } from './extensions.js';
import type { PromptsConfig } from './prompts.js';
import type { ProcessConfig } from './process.js';
import type { NotesConfig } from './notes.js';
import type { FlashcardsConfig } from './flashcards.js';
import type { AutomationConfig } from './automation.js';
import type { MarketplaceConfig } from './marketplace-registry.js';
import type { PermissionConfig } from './permission.js';
import type { WalkthroughConfig } from './walkthrough.js';
import { THINKING_LEVEL_OPTIONS } from './host.js';
import type { ModelRef, SessionScope, ThinkingLevel } from './host.js';
import type { SubagentProfileSettings } from './subagent-profile.js';
import type { RemoteConfig } from './remote.js';

/** Model capability tags. Drives tool routing and settings UI grouping. */
export type ModelCapability = 'chat' | 'image-generation';

/** Input modalities a model accepts (Pi catalog / ModelRuntime). */
export type ModelInputModality = 'text' | 'image';

/** Per-capability route override (request path + timeout). */
export type ModelRouteConfig = {
  /** Custom request path appended to provider baseUrl (e.g. '/images/generations'). */
  path?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
};

/** Per-model identity and optional runtime limits. */
export type ModelConfigEntry = {
  id: string;
  label?: string;
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

export type OpenAiCompatibleProviderConfig = {
  id: string;
  protocol: 'openai-compatible';
  name: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  /** Whether this provider is active. Default true when omitted. */
  enabled?: boolean;
  /** Extra HTTP headers sent with discovery and (when wired) provider requests. */
  headers?: Record<string, string>;
  models: ModelConfigEntry[];
};

export type AnthropicCompatibleProviderConfig = {
  id: string;
  protocol: 'anthropic-compatible';
  name: string;
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
  name: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  /** Whether this provider is active. Default true when omitted. */
  enabled?: boolean;
  /** Extra HTTP headers sent with discovery and (when wired) provider requests. */
  headers?: Record<string, string>;
  models: ModelConfigEntry[];
};

export type ModelProviderConfig =
  OpenAiCompatibleProviderConfig | AnthropicCompatibleProviderConfig | GoogleGeminiProviderConfig;

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

/** Normalized model identity returned from a provider's discovery endpoint. */
export type DiscoveredModel = {
  id: string;
  label?: string;
  /** Filled by host catalog enrich after discover (optional). */
  input?: readonly ModelInputModality[];
  reasoning?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
};

/** Safe model discovery payload. Never includes API credentials. */
export type ModelDiscoveryResult = {
  providerId: string;
  protocol: ModelProviderConfig['protocol'];
  models: DiscoveredModel[];
};

/** Product-level compaction defaults (applied when a live session is ready). */
export type CompactionConfig = {
  /**
   * Applied when a new live session is created if no session override.
   * Default true.
   */
  autoEnabledDefault: boolean;
  /**
   * When true, host may append a system note to product transcript after compact.
   * Default false (banner-only).
   */
  writeTranscriptNote?: boolean;
};

/** Product opt-in for the enhanced Ultra composer effort stop. */
export type ThinkingConfig = {
  ultraEnabled: boolean;
};

/**
 * Settings-backed subagent configuration stored under `PiwinConfig.subagents`.
 *
 * Profiles reference `ModelRef` values already configured in
 * `PiwinConfig.providers`; they never define providers or models. Parallel
 * execution limits and isolation policy live here so there is no second
 * parallelism configuration store.
 */
export type SubagentConfig = {
  /** User-authored profiles. Built-ins are merged by the Host at resolution time. */
  profiles: SubagentProfileSettings[];
  /** Default profile id used when a caller omits `profileId`. */
  defaultProfileId?: string;
  /** Hard ceiling on concurrently running children in one batch. */
  maxConcurrency: number;
  /** Hard ceiling on total tasks in one batch request. */
  maxTasksPerRun: number;
  /** Hard ceiling on parallel write (worktree) tasks in one batch. */
  maxParallelWriteTasks: number;
  /** Whether process isolation is required for parallel runs. */
  processIsolation: 'required' | 'best-effort';
  /** Whether parallel writes are allowed (worktree-only) or disabled. */
  parallelWritePolicy: 'worktree-only' | 'disabled';
  /** When true, parallel writes require a clean parent working tree. */
  requireCleanBaseForParallelWrites: boolean;
};

/** Safe defaults for `PiwinConfig.subagents` when absent or partial. */
export function createDefaultSubagentConfig(): SubagentConfig {
  return {
    profiles: [],
    maxConcurrency: 4,
    maxTasksPerRun: 8,
    maxParallelWriteTasks: 4,
    processIsolation: 'required',
    parallelWritePolicy: 'worktree-only',
    requireCleanBaseForParallelWrites: true,
  };
}

/** Restorable desktop navigation state, stored with the product config. */
export type DesktopComposerProfile = {
  /** Per-next-turn model selection for the Desktop composer only. */
  model?: ModelRef;
  /** Per-next-turn thinking selection for the Desktop composer only. */
  thinkingLevel?: ThinkingLevel;
};

export type DesktopRestoreConfig = {
  composerProfile?: DesktopComposerProfile;
  lastSession?: {
    sessionId: string;
    scope: SessionScope;
  };
};

/** Product session behavior config under `PiwinConfig.session`. */
export type SessionConfig = {
  /** When true (default), host auto-names sessions after first exchange. */
  autoName?: boolean;
};

export function createDefaultSessionConfig(): SessionConfig {
  return { autoName: true };
}

export type ImageGenerationConfig = {
  /** Default model for image generation (independent from chat default). */
  defaultModel?: ModelRef;
};

/**
 * Text-only primary model: describe composer images via a vision model
 * before the main turn (Spec vision-delegation D1). Default off.
 */
export type VisionDelegationConfig = {
  /** Default false. */
  enabled: boolean;
  /**
   * Vision model used for descriptions. Should be a configured model with
   * `input` including `image`. Invalid configs are treated as disabled + warn.
   */
  model?: ModelRef;
  /** Override system prompt for the vision describe call. */
  systemPrompt?: string;
  /** Default 30_000. */
  timeoutMs?: number;
  /** Default true. */
  cacheEnabled?: boolean;
};

export type PiwinConfig = {
  hostMode: 'sdk' | 'rpc';
  agentMock?: boolean;
  providers: ModelProviderConfig[];
  defaultProviderId?: string;
  defaultModelId?: string;
  thinking?: ThinkingConfig;
  desktop?: DesktopRestoreConfig;
  media: {
    maxPasteBytes: number;
    allowedMimeTypes: string[];
  };
  artifact: {
    maxBytes: number;
    htmlUiModeDefault: boolean;
  };
  web?: WebConfig;
  skills?: SkillsConfig;
  extensions?: ExtensionsConfig;
  prompts?: PromptsConfig;
  compaction?: CompactionConfig;
  /** Managed process registry (CE-PROC). */
  process?: ProcessConfig;
  /** Product session behavior. */
  session?: SessionConfig;
  /** Notes library + local-first RAG (ADR 0018). */
  notes?: NotesConfig;
  /** Flashcards + FSRS review (ADR 0018). */
  flashcards?: FlashcardsConfig;
  /** CE-CRON / CE-HOOK (default disabled). */
  automation?: AutomationConfig;
  /** CE-HUB registry source toggles. */
  marketplace?: MarketplaceConfig;
  /** Image generation config (default model, future options). */
  imageGeneration?: ImageGenerationConfig;
  /** Text-only vision delegation (composer images). */
  visionDelegation?: VisionDelegationConfig;
  /** Permission policy mode and rule sets (ADR 0019). */
  permissions?: PermissionConfig;
  /** Walkthrough generation settings (spec §6.1). */
  walkthrough?: WalkthroughConfig;
  /** Settings-backed subagent profiles and parallel execution limits. */
  subagents?: SubagentConfig;
  /** Personal remote gateway (ADR 0027). Default off; W4 future. */
  remote?: RemoteConfig;
};

export function createDefaultCompactionConfig(): CompactionConfig {
  return {
    autoEnabledDefault: true,
    writeTranscriptNote: false,
  };
}

export function createDefaultWebConfig(): WebConfig {
  return {
    searchProvider: 'duckduckgo',
    searchApiKeyEnv: '',
    searchMaxResults: 10,
    searchTimeoutMs: 15000,
    searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }],
    searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 8000 },
    fetchProvider: 'supermarkdown',
    fetchApiKeyEnv: 'FIRECRAWL_API_KEY',
    fetchMaxBytes: 65536,
    fetchTimeoutMs: 15000,
    fetchBlockedUrlPrefixes: ['file:', 'localhost', '127.0.0.1'],
  };
}

export function createDefaultSkillsConfig(): SkillsConfig {
  return {
    extraPaths: [],
    disabledIds: [],
  };
}

export function createDefaultPromptsConfig(): PromptsConfig {
  return {
    extraPaths: [],
    disabledIds: [],
  };
}

export function createDefaultExtensionsConfig(): ExtensionsConfig {
  return {
    extraPaths: [],
    disabledIds: [],
  };
}
