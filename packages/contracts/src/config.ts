/** Product config shapes stored under ~/.piwin */

import {
  DEFAULT_FETCH_CACHE_TTL_MS,
  DEFAULT_FETCH_FALLBACK,
  DEFAULT_FETCH_RETURN_MAX_CHARS,
  DEFAULT_FETCH_STORE_MAX_CHARS,
  DEFAULT_SEARCH_ROUTE_POLICY,
  DEFAULT_SEARCH_NATIVE_TIMEOUT_MS,
  type WebConfig,
} from './web.js';
import type { SkillsConfig } from './skills.js';
import type { ExtensionsConfig } from './extensions.js';
import type { PromptsConfig } from './prompts.js';
import type { NotesConfig } from './notes.js';
import type { FlashcardsConfig } from './flashcards.js';
import type { KnowledgeConfig } from './knowledge.js';
import type { AutomationConfig } from './automation.js';
import type { MarketplaceConfig } from './marketplace-registry.js';
import type { PermissionConfig } from './permission.js';
import type { WalkthroughConfig } from './walkthrough.js';
import type { HealthConfig } from './health-summary.js';
import type { CodeSearchConfig } from './code-search.js';
import type { ArtifactConfig } from './artifact.js';
import type { BrowserWorkbenchConfig } from './browser-workbench-config.js';
import type { CodemodeConfig } from './codemode.js';
import type { ModelRef, SessionScope, ThinkingLevel } from './host.js';
import type { SubagentProfileSettings } from './subagent-profile.js';
import type { OrchestrationSchemeSettings } from './orchestration-scheme.js';
import type { RemoteConfig } from './remote.js';
import type { NetworkConfig } from './network-proxy.js';
import type { ReplyWriterConfig } from './reply-writer.js';
import type { SessionLifecycleConfig } from './session-lifecycle.js';
import type { SessionColdStorageConfig } from './session-cold-storage.js';

export * from './config-providers.js';
import type { ModelProviderConfig } from './config-providers.js';

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

/**
 * Windows bash tool offer state. The shell itself is never configured: it is
 * detected on every launch, so a Git Bash installed later — by any route —
 * takes effect without touching config. This records only that the offer was
 * answered.
 */
export type ShellConfig = {
  /** True once the user declined the Git Bash offer. Suppresses the offer only. */
  windowsBashOfferDeclined?: boolean;
};

/**
 * Persisted Job settings retained under the historical `process` config key.
 * Runtime lifecycle data belongs to JobRecord/JobController, not this config.
 */
export type ProcessConfig = {
  enabled?: boolean;
  /** Admission cap for concurrently active Jobs. */
  maxProcesses?: number;
  /** Default lifetime choice for manually configured process tools. */
  killOnSessionEnd?: boolean;
  /** Whether Host disposal stops remaining Jobs. */
  killOnHostDispose?: boolean;
};

export function createDefaultProcessConfig(): ProcessConfig {
  return {
    enabled: true,
    maxProcesses: 8,
    killOnSessionEnd: false,
    killOnHostDispose: true,
  };
}

/** Product opt-in for the enhanced Ultra composer effort stop. */
export type ThinkingConfig = {
  ultraEnabled: boolean;
  /** Host-shared default thinking stop. Composer chrome stays in this window. */
  defaultLevel?: ThinkingLevel;
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
  /** Model for new freehand read-only model-facing subagents; omitted inherits the parent. */
  freehandReadonlyModel?: ModelRef;
  /**
   * 同时运行的子代理上限（跨所有 batch）。同时决定 worker 进程池大小
   * `deriveWorkerPoolSize(N) = N + 1`（主会话预留，上限 `ABSOLUTE_MAX_RESIDENT_RUNTIMES`）与
   * supervisor 进程上限 `deriveSupervisorMaxWorkers(N) = 池 + 1`（+1 为代际替换/compaction 候选并存余量）。
   */
  maxConcurrency: number;
  /** Hard ceiling on total tasks in one batch request. */
  maxTasksPerRun: number;
  /** Whether process isolation is required for parallel runs. */
  processIsolation: 'required' | 'best-effort';
  /** Whether parallel writes are allowed (worktree-only) or disabled. */
  parallelWritePolicy: 'worktree-only' | 'disabled';
  /** Explicit consent policy for dirty-base parallel writes. */
  dirtyBasePolicy: 'ask' | 'bypass';
  /** User-authored orchestration schemes (builtins merged at resolve time). */
  schemes?: OrchestrationSchemeSettings[];
  /**
   * Auto: a sidekick candidate above either bound needs an independent
   * reviewer. Omitted fields use the builtin default (5 files / 300 lines).
   */
  leadReviewLimit?: { maxFiles?: number; maxChangedLines?: number };
};

/** Default `subagents.maxConcurrency` (user-facing parallel child ceiling). */
export const DEFAULT_SUBAGENT_MAX_CONCURRENCY = 4;

/** Safe defaults for `PiwinConfig.subagents` when absent or partial. */
export function createDefaultSubagentConfig(): SubagentConfig {
  return {
    profiles: [],
    maxConcurrency: DEFAULT_SUBAGENT_MAX_CONCURRENCY,
    maxTasksPerRun: 8,
    processIsolation: 'required',
    parallelWritePolicy: 'worktree-only',
    dirtyBasePolicy: 'ask',
  };
}

/**
 * Product execution admission (local Host). Caps simultaneous leaf Runs
 * (`session-turn` / `subagent-task`), not Session count or Worker count.
 */
export type ExecutionConfig = {
  /** Default 8. Legal range 1–8 in v1. */
  maxConcurrentRuns: number;
  /**
   * Available-memory floor in MiB. A shell tool call is refused while system
   * available memory is below this, so the model serializes instead of the
   * machine thrashing. `0` disables the gate.
   *
   * Why this exists (2026-09-12): `maxConcurrentRuns` counts Runs and
   * `process.maxProcesses` counts Jobs, so a single `bash` call running
   * `pnpm test` scored 1 against both while forking ten ~1 GiB vitest workers.
   * Nothing in the product measured the fan-out inside one tool call, and the
   * machine hit out-of-application-memory with every quota still green.
   */
  minAvailableMemoryMiB: number;
};

/** Default simultaneous leaf executions on a local Host. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 8;

/** v1 product safety ceiling for {@link ExecutionConfig.maxConcurrentRuns}. */
export const MAX_CONCURRENT_RUNS = 8;

/**
 * Default shell admission floor. One full-repo typecheck peaked at 2.2 GiB and
 * one desktop vitest run at ~1.5 GiB on the 2026-09-12 machine, so 2 GiB is the
 * smallest floor that still refuses the state that preceded the incident
 * (1.25 GiB available) without tripping during ordinary work.
 */
export const DEFAULT_MIN_AVAILABLE_MEMORY_MIB = 2048;

/** Upper bound for {@link ExecutionConfig.minAvailableMemoryMiB}. */
export const MAX_MIN_AVAILABLE_MEMORY_MIB = 16384;

export function createDefaultExecutionConfig(): ExecutionConfig {
  return {
    maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
    minAvailableMemoryMiB: DEFAULT_MIN_AVAILABLE_MEMORY_MIB,
  };
}

/** Clamp a user-provided execution block; omitted fields fall back to defaults. */
export function normalizeExecutionConfig(
  input: Partial<ExecutionConfig> | undefined,
): ExecutionConfig {
  const defaults = createDefaultExecutionConfig();
  const runs = input?.maxConcurrentRuns;
  const floor = input?.minAvailableMemoryMiB;
  return {
    maxConcurrentRuns:
      runs === undefined || !Number.isFinite(runs)
        ? defaults.maxConcurrentRuns
        : Math.max(1, Math.min(MAX_CONCURRENT_RUNS, Math.floor(runs))),
    // 0 is a real value here (gate off), so it must survive the clamp.
    minAvailableMemoryMiB:
      floor === undefined || !Number.isFinite(floor)
        ? defaults.minAvailableMemoryMiB
        : Math.max(0, Math.min(MAX_MIN_AVAILABLE_MEMORY_MIB, Math.floor(floor))),
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
  /**
   * Scheme preselected on the Desktop composer when a new conversation starts.
   * Omitted means Off. Existing conversations keep their own choice.
   */
  defaultOrchestrationSchemeId?: string;
};

/** Product session behavior config under `PiwinConfig.session`. */
export type SessionConfig = {
  /** When true (default), host auto-names sessions after first exchange. */
  autoName?: boolean;
  /**
   * Session runtime residency retention policy (ADR 0040). Omitted fields
   * select the adaptive defaults; settings may only tighten the budgets.
   * There is no persisted "unbounded" mode.
   */
  runtimeRetention?: SessionRuntimeRetentionConfig;
  /** Explicit, plan-before-apply durable session archive policy. */
  lifecycle?: SessionLifecycleConfig;
  /** Manual cold-storage backup / offload / restore. Default disabled. */
  coldStorage?: SessionColdStorageConfig;
};

export function createDefaultSessionConfig(): SessionConfig {
  return { autoName: true };
}

/**
 * Normalized session runtime retention policy (ADR 0040 §3).
 *
 * Durable session records and live Agent runtimes are separate authorities.
 * This shape bounds how many runtimes stay resident, how long they may stay
 * idle, and the memory budget before the Host evicts idle runtimes.
 */
export type SessionRuntimeRetentionConfig = {
  /** Default 600. Zero means do not retain an idle runtime. */
  idleTtlSeconds: number;
  /** Default 2. Idle runtimes above this count are LRU candidates immediately. */
  maxIdleRuntimes: number;
  /** Omitted means derived from `execution.maxConcurrentRuns`. Never from Worker or Sub Agent quotas. */
  maxResidentRuntimes?: number;
  /** Omitted means an adaptive Host + worker RSS budget. */
  memoryHighWaterMiB?: number;
};

/** Default idle retention window (10 minutes, ADR 0040 §3). */
export const DEFAULT_IDLE_TTL_SECONDS = 600;

/** Default maximum idle runtimes kept resident (ADR 0040 §3). */
export const DEFAULT_MAX_IDLE_RUNTIMES = 2;

/** Absolute ceiling on resident runtimes (ADR 0040 §3). */
export const ABSOLUTE_MAX_RESIDENT_RUNTIMES = 8;

/** Foreground/main-session slots reserved inside the worker process pool. */
export const WORKER_POOL_FOREGROUND_RESERVE = 1;

/**
 * Extra supervisor process slots beyond the pool for generational replacement /
 * compaction-candidate overlap. Not shown as the user-facing pool size.
 */
export const WORKER_REPLACEMENT_HEADROOM = 1;

/**
 * Normalize a caller-supplied maxConcurrency: non-finite or below 1 falls back
 * to {@link DEFAULT_SUBAGENT_MAX_CONCURRENCY}; otherwise floor to an integer ≥ 1.
 */
function normalizeMaxConcurrency(maxConcurrency: number): number {
  if (!Number.isFinite(maxConcurrency) || maxConcurrency < 1) {
    return DEFAULT_SUBAGENT_MAX_CONCURRENCY;
  }
  return Math.max(1, Math.floor(maxConcurrency));
}

/**
 * Worker process pool ceiling from subagent maxConcurrency N:
 * `clamp(N + WORKER_POOL_FOREGROUND_RESERVE, 2, ABSOLUTE_MAX_RESIDENT_RUNTIMES)`.
 */
export function deriveWorkerPoolSize(maxConcurrency: number): number {
  const n = normalizeMaxConcurrency(maxConcurrency);
  return Math.max(2, Math.min(ABSOLUTE_MAX_RESIDENT_RUNTIMES, n + WORKER_POOL_FOREGROUND_RESERVE));
}

/**
 * Supervisor process cap = pool + {@link WORKER_REPLACEMENT_HEADROOM}
 * (replacement headroom; normal path should not reach it).
 */
export function deriveSupervisorMaxWorkers(maxConcurrency: number): number {
  return deriveWorkerPoolSize(maxConcurrency) + WORKER_REPLACEMENT_HEADROOM;
}

/**
 * Effective subagent quota:
 * `Math.min(N, deriveWorkerPoolSize(N) - WORKER_POOL_FOREGROUND_RESERVE)`.
 */
export function deriveSubagentQuota(maxConcurrency: number): number {
  const n = normalizeMaxConcurrency(maxConcurrency);
  return Math.min(n, deriveWorkerPoolSize(n) - WORKER_POOL_FOREGROUND_RESERVE);
}

/** Adaptive RSS high water: 25% of system memory. */
export const MEMORY_HIGH_WATER_RATIO = 0.25;

/** Adaptive RSS high water clamp lower bound (MiB). */
export const MIN_MEMORY_HIGH_WATER_MIB = 512;

/** Adaptive RSS high water clamp upper bound (MiB). */
export const MAX_MEMORY_HIGH_WATER_MIB = 2048;

/** Internal low-water target is 80% of the high water (MiB). */
export const MEMORY_LOW_WATER_RATIO = 0.8;

/** Idle sweep interval while at least one runtime is resident (30s). */
export const RESIDENCY_SWEEP_INTERVAL_MS = 30_000;

/** Strict normalization/clamping for a user-provided retention config. */
export function normalizeSessionRuntimeRetentionConfig(
  input: Partial<SessionRuntimeRetentionConfig> | undefined,
): SessionRuntimeRetentionConfig {
  const idleTtlSeconds = clampNonNegativeInt(input?.idleTtlSeconds, DEFAULT_IDLE_TTL_SECONDS);
  const maxIdleRuntimes = clampNonNegativeInt(input?.maxIdleRuntimes, DEFAULT_MAX_IDLE_RUNTIMES);
  const result: SessionRuntimeRetentionConfig = {
    idleTtlSeconds,
    maxIdleRuntimes,
  };
  if (input?.maxResidentRuntimes !== undefined) {
    result.maxResidentRuntimes = clampPositiveInt(
      input.maxResidentRuntimes,
      ABSOLUTE_MAX_RESIDENT_RUNTIMES,
    );
  }
  if (input?.memoryHighWaterMiB !== undefined) {
    result.memoryHighWaterMiB = clampMemoryMiB(input.memoryHighWaterMiB);
  }
  return result;
}

/**
 * Derive the adaptive memory high water from system memory.
 * 25% of system memory clamped to 512–2048 MiB.
 */
export function deriveMemoryHighWaterMiB(systemMemoryMiB: number): number {
  return clampMemoryMiB(Math.round(systemMemoryMiB * MEMORY_HIGH_WATER_RATIO));
}

/** Derive the internal low-water target from the high water (80%). */
export function deriveMemoryLowWaterMiB(highWaterMiB: number): number {
  return Math.round(highWaterMiB * MEMORY_LOW_WATER_RATIO);
}

function clampNonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function clampPositiveInt(value: number, ceiling: number): number {
  if (!Number.isFinite(value)) {
    return ceiling;
  }
  return Math.max(1, Math.min(ceiling, Math.floor(value)));
}

function clampMemoryMiB(value: number): number {
  if (!Number.isFinite(value)) {
    return MAX_MEMORY_HIGH_WATER_MIB;
  }
  return Math.max(
    MIN_MEMORY_HIGH_WATER_MIB,
    Math.min(MAX_MEMORY_HIGH_WATER_MIB, Math.floor(value)),
  );
}

export type ImageGenerationConfig = {
  /** Default model for image generation (independent from chat default). */
  defaultModel?: ModelRef;
};

export type VideoGenerationConfig = {
  /** Default model for video generation (independent from chat/image defaults). */
  defaultModel?: ModelRef;
};

/** Product-level speech model defaults. Audio is transient and never persisted here. */
export type SpeechConfig = {
  /** Desktop voice-input model selection. */
  asr?: {
    defaultModel?: ModelRef;
    language?: string;
  };
  /** Reserved for a future text-to-speech playback surface. */
  tts?: {
    defaultModel?: ModelRef;
    voice?: string;
  };
  /**
   * piwin Live (ADR 0065). `enabled` is ignored leftover; start/stop lives on
   * the composer. `voice` is a legacy Codex fallback — read only until the
   * next successful save writes `byProvider.openai-codex.voice`.
   */
  live?: {
    enabled?: boolean;
    providerId?: string;
    byProvider?: Record<string, Record<string, string>>;
    voice?: string;
  };
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
  artifact: ArtifactConfig;
  web?: WebConfig;
  skills?: SkillsConfig;
  extensions?: ExtensionsConfig;
  prompts?: PromptsConfig;
  compaction?: CompactionConfig;
  /** Windows Git Bash offer state. Absent means never answered. */
  shell?: ShellConfig;
  /** Managed process registry (CE-PROC). */
  process?: ProcessConfig;
  /** Product session behavior. */
  session?: SessionConfig;
  /** Notes library + local-first RAG (ADR 0018). */
  notes?: NotesConfig;
  /** Flashcards + FSRS review (ADR 0018). */
  flashcards?: FlashcardsConfig;
  /** Doc Cards / shared knowledge providers (unwired until runtime maps notes.embedding). */
  knowledge?: KnowledgeConfig;
  /** CE-CRON / CE-HOOK (default disabled). */
  automation?: AutomationConfig;
  /** CE-HUB registry source toggles. */
  marketplace?: MarketplaceConfig;
  /** Image generation config (default model, future options). */
  imageGeneration?: ImageGenerationConfig;
  /** Video generation config (default model, future options). */
  videoGeneration?: VideoGenerationConfig;
  /** Speech model defaults; ASR is used by Desktop voice input. */
  speech?: SpeechConfig;
  /** Text-only vision delegation (composer images). */
  visionDelegation?: VisionDelegationConfig;
  /**
   * Built-in `code_search` tool (Devin Fast Context-aligned). Registered per
   * session only when `enabled`; see `docs/plans/2026-09-19-builtin-code-search.md`.
   */
  codeSearch?: CodeSearchConfig;
  /** Post-turn rewrite of the visible assistant reply (spec: reply-writer). */
  replyWriter?: ReplyWriterConfig;
  /** Permission policy mode and rule sets (ADR 0019). */
  permissions?: PermissionConfig;
  /** Walkthrough generation settings (spec §6.1). */
  walkthrough?: WalkthroughConfig;
  /** Stored Apple Health summaries and the scheduled digest (ADR 0062 M2). */
  health?: HealthConfig;
  /** Settings-backed subagent profiles and parallel execution limits. */
  subagents?: SubagentConfig;
  /** Leaf-run execution admission. Omitted config normalizes to 8. */
  execution?: ExecutionConfig;
  /** Personal remote gateway (ADR 0027). Default off; W4 future. */
  remote?: RemoteConfig;
  /** Host outbound proxy (ADR 0091). Omitted inherits the launch environment. */
  network?: NetworkConfig;
  /**
   * Host-owned browser workbench (ADR 0020). Omitted means headless Chromium
   * with the default profile. `cdpEndpoint` is an explicit loopback Playwright
   * `connectOverCDP` target; Chrome daily-session autoConnect is not this field.
   */
  browser?: BrowserWorkbenchConfig;
  /** Opt-in read-only Codemode scripts. Omitted normalizes to disabled. */
  codemode?: CodemodeConfig;
};

export type { BrowserFastDeciderConfig, BrowserWorkbenchConfig } from './browser-workbench-config.js';

export function createDefaultCompactionConfig(): CompactionConfig {
  return {
    autoEnabledDefault: true,
    writeTranscriptNote: false,
  };
}

export function createDefaultWebConfig(): WebConfig {
  return {
    searchProvider: 'none',
    searchApiKeyEnv: '',
    searchMaxResults: 10,
    searchTimeoutMs: 15000,
    searchNativeTimeoutMs: DEFAULT_SEARCH_NATIVE_TIMEOUT_MS,
    searchSources: [],
    searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 8000 },
    searchRoutePolicy: DEFAULT_SEARCH_ROUTE_POLICY,
    fetchProvider: 'supermarkdown',
    fetchApiKeyEnv: 'FIRECRAWL_API_KEY',
    fetchMaxBytes: 65536,
    fetchReturnMaxChars: DEFAULT_FETCH_RETURN_MAX_CHARS,
    fetchStoreMaxChars: DEFAULT_FETCH_STORE_MAX_CHARS,
    fetchCacheTtlMs: DEFAULT_FETCH_CACHE_TTL_MS,
    fetchFallback: DEFAULT_FETCH_FALLBACK,
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
