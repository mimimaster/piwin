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
import type { ModelRef, SessionScope, ThinkingLevel } from './host.js';

/** Model capability tags. Drives tool routing and settings UI grouping. */
export type ModelCapability = 'chat' | 'image-generation';

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
  /** Capabilities this model supports. Omit = ['chat'] for backward compat. */
  capabilities?: ModelCapability[];
  /** Per-capability route overrides (path, timeout). */
  routes?: Partial<Record<ModelCapability, ModelRouteConfig>>;
};

/** Default context window when a model omits `contextWindow`. */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000;

export type OpenAiCompatibleProviderConfig = {
  id: string;
  protocol: 'openai-compatible';
  name: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
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
  /** Extra HTTP headers sent with discovery and (when wired) provider requests. */
  headers?: Record<string, string>;
  models: ModelConfigEntry[];
};

export type ModelProviderConfig =
  OpenAiCompatibleProviderConfig | AnthropicCompatibleProviderConfig | GoogleGeminiProviderConfig;

/** Normalized model identity returned from a provider's discovery endpoint. */
export type DiscoveredModel = {
  id: string;
  label?: string;
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
  /** Permission policy mode and rule sets (ADR 0019). */
  permissions?: PermissionConfig;
  /** Walkthrough generation settings (spec §6.1). */
  walkthrough?: WalkthroughConfig;
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
    searchMaxResults: 5,
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
