/** Product config shapes stored under ~/.piwin */

import type { WebConfig } from './web.js';
import type { SkillsConfig } from './skills.js';
import type { ExtensionsConfig } from './extensions.js';
import type { PromptsConfig } from './prompts.js';
import type { MemoryConfig } from './memory.js';
import type { ProcessConfig } from './process.js';
import type { ExecutionConfig } from './session-ops.js';
import type { NotesConfig } from './notes.js';
import type { FlashcardsConfig } from './flashcards.js';

export type OpenAiCompatibleProviderConfig = {
  id: string;
  protocol: 'openai-compatible';
  name: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  models: Array<{ id: string; label?: string }>;
};

export type AnthropicCompatibleProviderConfig = {
  id: string;
  protocol: 'anthropic-compatible';
  name: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyRef?: string;
  models: Array<{ id: string; label?: string }>;
};

export type ModelProviderConfig =
  | OpenAiCompatibleProviderConfig
  | AnthropicCompatibleProviderConfig;

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

export type PiwinConfig = {
  hostMode: 'sdk' | 'rpc';
  agentMock?: boolean;
  providers: ModelProviderConfig[];
  defaultProviderId?: string;
  defaultModelId?: string;
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
  /** Cross-session memory (CE-MEM). Absent / disabled until host wires `@piwin/memory`. */
  memory?: MemoryConfig;
  /** Managed process registry (CE-PROC). */
  process?: ProcessConfig;
  /** Default execution mode for new sessions (CE-CHAT / CE-MODE). */
  execution?: ExecutionConfig;
  /** Notes library + local-first RAG (ADR 0018). */
  notes?: NotesConfig;
  /** Flashcards + FSRS review (ADR 0018). */
  flashcards?: FlashcardsConfig;
};

export function createDefaultCompactionConfig(): CompactionConfig {
  return {
    autoEnabledDefault: true,
    writeTranscriptNote: false,
  };
}

export function createDefaultWebConfig(): WebConfig {
  return {
    searchProvider: 'brave',
    searchApiKeyEnv: 'BRAVE_API_KEY',
    searchMaxResults: 5,
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
