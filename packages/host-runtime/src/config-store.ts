import { mkdir, readFile } from 'node:fs/promises';
import { writeTextFileAtomic } from '@piwin/session';
import { dirname, join } from 'node:path';
import type {
  AutomationConfig,
  ArtifactConfig,
  ArtifactScopesConfig,
  ArtifactSurfaceSwitches,
  ArtifactTriggerMode,
  ArtifactPromptMode,
  CompactionConfig,
  DesktopRestoreConfig,
  ExtensionsConfig,
  ImageGenerationConfig,
  MarketplaceConfig,
  PermissionConfig,
  PermissionMode,
  PiwinConfig,
  ProcessConfig,
  PromptsConfig,
  SessionConfig,
  ShellConfig,
  SpeechConfig,
  SkillsConfig,
  SubagentConfig,
  ExecutionConfig,
  SubagentProfileSettings,
  SubagentCapability,
  SubagentIsolationMode,
  OrchestrationSchemeSettings,
  ThinkingConfig,
  ThinkingLevel,
  VisionDelegationConfig,
  ReplyWriterConfig,
  VideoGenerationConfig,
  WebConfig,
  CodeSearchConfig,
  PermissionPreset,
} from '@piwin/contracts';
import {
  createDefaultAutomationConfig,
  createDefaultArtifactConfig,
  createDefaultArtifactScopes,
  createDefaultCompactionConfig,
  createDefaultExtensionsConfig,
  createDefaultMarketplaceConfig,
  createDefaultPermissionConfig,
  createSafeFallbackPermissionConfig,
  createDefaultProcessConfig,
  createDefaultPromptsConfig,
  createDefaultSessionColdStorageConfig,
  createDefaultSessionConfig,
  DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
  createDefaultSkillsConfig,
  createDefaultSubagentConfig,
  createDefaultExecutionConfig,
  normalizeExecutionConfig,
  createDefaultWalkthroughConfig,
  DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES,
  createDefaultWebConfig,
  createDefaultCodeSearchConfig,
  inferSearchRoutePolicy,
  isWebSearchSourceKind,
  modeToPreset,
  normalizeWalkthroughConfig,
  normalizeSessionRuntimeRetentionConfig,
  resolvePreset,
  SUBAGENT_CAPABILITIES,
  isValidOrchestrationSchemeId,
  canonicalizeUltraCodeSchemeSettings,
} from '@piwin/contracts';
import { getPiwinConfigPath, getPiwinRoot } from './paths.js';
import {
  normalizeKnowledgeConfig,
  normalizeNotesKnowledgeExtras,
} from './config-store-knowledge.js';
import { normalizeBrowserWorkbenchConfig } from './config-store-browser.js';
import {
  isBlockingValidationIssue,
  sanitizeProvidersForSave,
  validatePiwinConfig,
} from './provider-validation.js';

export function createDefaultPiwinConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: [...DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES],
    },
    artifact: {
      ...createDefaultArtifactConfig(),
    },
    web: createDefaultWebConfig(),
    skills: createDefaultSkillsConfig(),
    extensions: createDefaultExtensionsConfig(),
    prompts: createDefaultPromptsConfig(),
    compaction: createDefaultCompactionConfig(),
    process: createDefaultProcessConfig(),
    automation: createDefaultAutomationConfig(),
    marketplace: createDefaultMarketplaceConfig(),
    walkthrough: createDefaultWalkthroughConfig(),
    subagents: createDefaultSubagentConfig(),
    execution: createDefaultExecutionConfig(),
    permissions: createDefaultPermissionConfig(),
  };
}

export async function loadPiwinConfig(piwinRoot?: string): Promise<PiwinConfig> {
  const rootDir = getPiwinRoot(piwinRoot);
  const configPath = getPiwinConfigPath(rootDir);
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return normalizePiwinConfig(parsed);
  } catch (error) {
    if (isNotFound(error)) {
      return (await loadBundledDefaultConfig()) ?? createDefaultPiwinConfig();
    }
    throw error;
  }
}

/**
 * Packaged Host fallback used on a fresh machine. The user-owned config always
 * wins; the bundle only supplies a seed when ~/.piwin/config.json is absent.
 */
async function loadBundledDefaultConfig(): Promise<PiwinConfig | undefined> {
  const bundledAssetsRoot = process.env.PIWIN_BUNDLED_ASSETS_ROOT?.trim();
  if (!bundledAssetsRoot) {
    return undefined;
  }
  try {
    const raw = await readFile(join(bundledAssetsRoot, 'default-config.json'), 'utf8');
    return normalizePiwinConfig(JSON.parse(raw));
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function savePiwinConfig(config: PiwinConfig, piwinRoot?: string): Promise<string> {
  const issues = validatePiwinConfig(config).filter(isBlockingValidationIssue);
  if (issues.length > 0) {
    throw new Error(
      `Invalid providers: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
  }
  const { providers, redactedFields } = sanitizeProvidersForSave(config.providers);
  if (redactedFields.length > 0) {
    throw new Error(
      `Refusing to save raw API keys in config (${redactedFields.join(', ')}). Use apiKeyEnv or apiKeyRef only.`,
    );
  }
  const rootDir = getPiwinRoot(piwinRoot);
  const configPath = getPiwinConfigPath(rootDir);
  await mkdir(dirname(configPath), { recursive: true });
  const toWrite: PiwinConfig = { ...config, providers };
  await writeTextFileAtomic(configPath, `${JSON.stringify(toWrite, null, 2)}\n`);
  return configPath;
}

export async function initPiwinConfig(piwinRoot?: string): Promise<{
  path: string;
  created: boolean;
  config: PiwinConfig;
}> {
  const rootDir = getPiwinRoot(piwinRoot);
  const configPath = getPiwinConfigPath(rootDir);
  try {
    const existing = await readFile(configPath, 'utf8');
    return {
      path: configPath,
      created: false,
      config: normalizePiwinConfig(JSON.parse(existing)),
    };
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  const config = createDefaultPiwinConfig();
  await savePiwinConfig(config, rootDir);
  return { path: configPath, created: true, config };
}

export function normalizePiwinConfig(value: unknown): PiwinConfig {
  const defaults = createDefaultPiwinConfig();
  if (!value || typeof value !== 'object') {
    return defaults;
  }
  const record = value as Record<string, unknown>;
  const hostMode = record.hostMode === 'rpc' ? 'rpc' : 'sdk';
  const agentMock = record.agentMock === true;
  const providers = Array.isArray(record.providers) ? record.providers : [];
  const normalized: PiwinConfig = {
    hostMode,
    agentMock,
    providers: providers as PiwinConfig['providers'],
    media: {
      maxPasteBytes:
        asPositiveNumber(asRecord(record.media)?.maxPasteBytes) ?? defaults.media.maxPasteBytes,
      allowedMimeTypes: normalizeMediaAllowedMimeTypes(
        asStringArray(asRecord(record.media)?.allowedMimeTypes),
        defaults.media.allowedMimeTypes,
      ),
    },
    artifact: {
      ...normalizeArtifactConfig(record.artifact, defaults.artifact),
    },
  };
  if (typeof record.defaultProviderId === 'string') {
    normalized.defaultProviderId = record.defaultProviderId;
  }
  if (typeof record.defaultModelId === 'string') {
    normalized.defaultModelId = record.defaultModelId;
  }
  const thinking = normalizeThinkingConfig(record.thinking);
  if (thinking) {
    normalized.thinking = thinking;
  }
  const desktop = normalizeDesktopRestoreConfig(record.desktop);
  if (desktop) {
    normalized.desktop = desktop;
  }
  normalized.web = normalizeWebConfig(record.web, defaults.web ?? createDefaultWebConfig());
  const codeSearch = normalizeCodeSearchConfig(record.codeSearch);
  if (codeSearch) {
    normalized.codeSearch = codeSearch;
  }
  normalized.skills = normalizeSkillsConfig(
    record.skills,
    defaults.skills ?? createDefaultSkillsConfig(),
  );
  normalized.extensions = normalizeExtensionsConfig(
    record.extensions,
    defaults.extensions ?? createDefaultExtensionsConfig(),
  );
  normalized.prompts = normalizePromptsConfig(
    record.prompts,
    defaults.prompts ?? createDefaultPromptsConfig(),
  );
  normalized.compaction = normalizeCompactionConfig(
    record.compaction,
    defaults.compaction ?? createDefaultCompactionConfig(),
  );
  const shell = normalizeShellConfig(record.shell);
  if (shell) normalized.shell = shell;
  normalized.process = normalizeProcessConfig(
    record.process,
    defaults.process ?? createDefaultProcessConfig(),
  );
  normalized.automation = normalizeAutomationConfig(
    record.automation,
    defaults.automation ?? createDefaultAutomationConfig(),
  );
  normalized.marketplace = normalizeMarketplaceConfig(
    record.marketplace,
    defaults.marketplace ?? createDefaultMarketplaceConfig(),
  );
  const notes = normalizeNotesConfig(record.notes);
  if (notes) {
    normalized.notes = notes;
  }
  const flashcards = normalizeFlashcardsConfig(record.flashcards);
  if (flashcards) {
    normalized.flashcards = flashcards;
  }
  const knowledge = normalizeKnowledgeConfig(record.knowledge, notes);
  if (knowledge) {
    normalized.knowledge = knowledge;
  }
  normalized.session = normalizeSessionConfig(
    record.session,
    defaults.session ?? createDefaultSessionConfig(),
  );
  normalized.permissions = normalizePermissionConfig(record.permissions);
  normalized.walkthrough = normalizeWalkthroughConfig(record.walkthrough);
  normalized.subagents = normalizeSubagentConfig(record.subagents);
  normalized.execution = normalizeExecutionConfig(
    asRecord(record.execution) as Partial<ExecutionConfig> | undefined,
  );
  const imageGeneration = normalizeImageGenerationConfig(record.imageGeneration);
  if (imageGeneration) {
    normalized.imageGeneration = imageGeneration;
  }
  const videoGeneration = normalizeVideoGenerationConfig(record.videoGeneration);
  if (videoGeneration) {
    normalized.videoGeneration = videoGeneration;
  }
  const speech = normalizeSpeechConfig(record.speech);
  if (speech) {
    normalized.speech = speech;
  }
  const visionDelegation = normalizeVisionDelegationConfig(record.visionDelegation);
  if (visionDelegation) {
    normalized.visionDelegation = visionDelegation;
  }
  const replyWriter = normalizeReplyWriterConfig(record.replyWriter);
  if (replyWriter) {
    normalized.replyWriter = replyWriter;
  }
  const browser = normalizeBrowserWorkbenchConfig(record.browser);
  if (browser) {
    normalized.browser = browser;
  }
  return normalized;
}

/** Upgrade the pre-file-attachment default without overriding deliberate custom allowlists. */
function normalizeMediaAllowedMimeTypes(
  configured: string[] | undefined,
  defaults: string[],
): string[] {
  if (!configured) {
    return defaults;
  }
  const legacyDefault = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const normalized = configured.map((mimeType) => mimeType.trim().toLowerCase()).filter(Boolean);
  if (
    normalized.length === legacyDefault.size &&
    normalized.every((mimeType) => legacyDefault.has(mimeType))
  ) {
    return defaults;
  }
  return configured;
}

/**
 * Normalize the `artifact` block. Handles migration from the legacy shape
 * (`htmlUiModeDefault`) to the new `ArtifactConfig` (`enabled`, `triggerMode`,
 * `decisionPrompt`, `maxBytes`).
 */

function normalizeCodeSearchConfig(value: unknown): CodeSearchConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const defaults = createDefaultCodeSearchConfig();
  const backend = record.backend === 'windsurf' ? 'windsurf' : record.backend === 'model' ? 'model' : undefined;
  const modelRecord = asRecord(record.model);
  const model =
    modelRecord &&
    typeof modelRecord.providerId === 'string' &&
    modelRecord.providerId.trim() &&
    typeof modelRecord.modelId === 'string' &&
    modelRecord.modelId.trim()
      ? { providerId: modelRecord.providerId.trim(), modelId: modelRecord.modelId.trim() }
      : undefined;
  const next: CodeSearchConfig = {
    enabled: record.enabled === true,
  };
  if (backend) next.backend = backend;
  if (model) next.model = model;
  if (typeof record.apiKeyRef === 'string' && record.apiKeyRef.trim()) {
    next.apiKeyRef = record.apiKeyRef.trim();
  }
  if (typeof record.apiKeyEnv === 'string' && record.apiKeyEnv.trim()) {
    next.apiKeyEnv = record.apiKeyEnv.trim();
  }
  const maxTurns = asPositiveNumber(record.maxTurns);
  if (maxTurns !== undefined) next.maxTurns = Math.floor(maxTurns);
  const maxCommands = asPositiveNumber(record.maxCommands);
  if (maxCommands !== undefined) next.maxCommands = Math.floor(maxCommands);
  const maxResults = asPositiveNumber(record.maxResults);
  if (maxResults !== undefined) next.maxResults = Math.floor(maxResults);
  if (typeof record.treeDepth === 'number' && Number.isFinite(record.treeDepth) && record.treeDepth >= 0) {
    next.treeDepth = Math.floor(record.treeDepth);
  }
  if (typeof record.includeSnippets === 'boolean') next.includeSnippets = record.includeSnippets;
  if (Array.isArray(record.excludePaths)) {
    next.excludePaths = record.excludePaths
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  const resultMaxLines = asPositiveNumber(record.resultMaxLines);
  if (resultMaxLines !== undefined) next.resultMaxLines = Math.floor(resultMaxLines);
  const lineMaxChars = asPositiveNumber(record.lineMaxChars);
  if (lineMaxChars !== undefined) next.lineMaxChars = Math.floor(lineMaxChars);
  const timeoutMs = asPositiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) next.timeoutMs = Math.floor(timeoutMs);
  // Keep a minimal explicit disabled entry out of the file when it is pure default.
  if (
    next.enabled === false &&
    next.backend === undefined &&
    next.model === undefined &&
    next.apiKeyRef === undefined &&
    next.apiKeyEnv === undefined &&
    next.maxTurns === undefined &&
    next.maxCommands === undefined &&
    next.maxResults === undefined &&
    next.treeDepth === undefined &&
    next.includeSnippets === undefined &&
    next.excludePaths === undefined &&
    next.resultMaxLines === undefined &&
    next.lineMaxChars === undefined &&
    next.timeoutMs === undefined
  ) {
    return { enabled: false };
  }
  void defaults;
  return next;
}

/**
 * Normalize the per-scope surface switches. A missing scope/surface keeps the
 * shipped default (on), so an older `config.json` never silently disables a
 * surface it never knew about.
 */
function normalizeArtifactScopes(value: unknown): ArtifactScopesConfig {
  const record = asRecord(value);
  const fallback = createDefaultArtifactScopes();
  const switches = (
    raw: unknown,
    scopeDefault: ArtifactSurfaceSwitches,
  ): ArtifactSurfaceSwitches => {
    const entry = asRecord(raw);
    if (!entry) {
      return { ...scopeDefault };
    }
    return {
      inline: entry.inline !== false,
      canvas: entry.canvas !== false,
    };
  };
  return {
    general: switches(record?.general, fallback.general),
    project: switches(record?.project, fallback.project),
  };
}

function normalizeArtifactConfig(value: unknown, defaults: ArtifactConfig): ArtifactConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  // Migration: old shape had `htmlUiModeDefault: boolean` instead of `enabled`.
  const hasEnabled = typeof record.enabled === 'boolean';
  const hasLegacy = typeof record.htmlUiModeDefault === 'boolean';
  const enabled = hasEnabled
    ? Boolean(record.enabled)
    : hasLegacy
      ? Boolean(record.htmlUiModeDefault)
      : defaults.enabled;
  const triggerMode: ArtifactTriggerMode =
    record.triggerMode === 'explicit-only' ? 'explicit-only' : defaults.triggerMode;
  const decisionPromptRecord = asRecord(record.decisionPrompt);
  const promptMode: ArtifactPromptMode =
    decisionPromptRecord?.mode === 'custom' ? 'custom' : 'default';
  const customPrompt =
    typeof decisionPromptRecord?.customPrompt === 'string' ? decisionPromptRecord.customPrompt : '';
  const maxBytes = asPositiveNumber(record.maxBytes) ?? defaults.maxBytes;
  return {
    enabled,
    scopes: normalizeArtifactScopes(record.scopes),
    triggerMode,
    decisionPrompt: { mode: promptMode, customPrompt },
    maxBytes,
    blockExternalScripts: record.blockExternalScripts === false ? false : true,
    blockExternalResources: record.blockExternalResources === false ? false : true,
  };
}

function normalizeSessionConfig(value: unknown, defaults: SessionConfig): SessionConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const config: SessionConfig = {};
  if (typeof record.autoName === 'boolean') {
    config.autoName = record.autoName;
  } else if (typeof defaults.autoName === 'boolean') {
    config.autoName = defaults.autoName;
  }
  const retention = asRecord(record.runtimeRetention);
  if (retention) {
    config.runtimeRetention = normalizeSessionRuntimeRetentionConfig({
      ...(typeof retention.idleTtlSeconds === 'number'
        ? { idleTtlSeconds: retention.idleTtlSeconds }
        : {}),
      ...(typeof retention.maxIdleRuntimes === 'number'
        ? { maxIdleRuntimes: retention.maxIdleRuntimes }
        : {}),
      ...(typeof retention.maxResidentRuntimes === 'number'
        ? { maxResidentRuntimes: retention.maxResidentRuntimes }
        : {}),
      ...(typeof retention.memoryHighWaterMiB === 'number'
        ? { memoryHighWaterMiB: retention.memoryHighWaterMiB }
        : {}),
    });
  }
  const lifecycle = asRecord(record.lifecycle);
  const archive = asRecord(lifecycle?.archive);
  if (archive) {
    const normalizedArchive: NonNullable<NonNullable<SessionConfig['lifecycle']>['archive']> = {};
    if (isPositiveInteger(archive.maxInactiveDays)) {
      normalizedArchive.maxInactiveDays = archive.maxInactiveDays;
    }
    if (isNonNegativeInteger(archive.maxActiveMainSessions)) {
      normalizedArchive.maxActiveMainSessions = archive.maxActiveMainSessions;
    }
    if (Object.keys(normalizedArchive).length > 0) {
      config.lifecycle = { archive: normalizedArchive };
    }
  }
  if (record.coldStorage !== undefined) {
    config.coldStorage = normalizeSessionColdStorageConfig(record.coldStorage);
  }
  return config;
}

function normalizeSessionColdStorageConfig(
  value: unknown,
): NonNullable<SessionConfig['coldStorage']> {
  const defaults = createDefaultSessionColdStorageConfig();
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const config: NonNullable<SessionConfig['coldStorage']> = {
    enabled: record.enabled === true,
    minArchivedAgeDays: isPositiveInteger(record.minArchivedAgeDays)
      ? record.minArchivedAgeDays
      : DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
  };
  if (typeof record.packOutputDir === 'string' && record.packOutputDir.trim().length > 0) {
    config.packOutputDir = record.packOutputDir.trim();
  }
  if (isPositiveInteger(record.localBudgetBytes)) {
    config.localBudgetBytes = record.localBudgetBytes;
  }
  return config;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Image generation default model (optional). Missing/invalid → omitted.
 */
function normalizeImageGenerationConfig(value: unknown): ImageGenerationConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const defaultModel = normalizeModelRef(record.defaultModel);
  if (!defaultModel) {
    return undefined;
  }
  return { defaultModel };
}

/**
 * Video generation default model (optional). Missing/invalid → omitted.
 * Provider route details live with the model entry so multiple video vendors
 * can coexist under one config root.
 */
function normalizeVideoGenerationConfig(value: unknown): VideoGenerationConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const defaultModel = normalizeModelRef(record.defaultModel);
  if (!defaultModel) {
    return undefined;
  }
  return { defaultModel };
}

function normalizeLiveByProvider(
  value: unknown,
): Record<string, Record<string, string>> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const byProvider: Record<string, Record<string, string>> = {};
  for (const [providerId, raw] of Object.entries(record)) {
    const fields = asRecord(raw);
    if (!fields) continue;
    const normalized: Record<string, string> = {};
    for (const [key, fieldValue] of Object.entries(fields)) {
      if (typeof fieldValue === 'string' && fieldValue.trim()) {
        normalized[key] = fieldValue.trim();
      }
    }
    if (Object.keys(normalized).length > 0) byProvider[providerId] = normalized;
  }
  return Object.keys(byProvider).length > 0 ? byProvider : undefined;
}

function normalizeSpeechConfig(value: unknown): SpeechConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: SpeechConfig = {};
  const asrRecord = asRecord(record.asr);
  if (asrRecord) {
    const asr: NonNullable<SpeechConfig['asr']> = {};
    const defaultModel = normalizeModelRef(asrRecord.defaultModel);
    if (defaultModel) {
      asr.defaultModel = defaultModel;
    }
    if (typeof asrRecord.language === 'string' && asrRecord.language.trim()) {
      asr.language = asrRecord.language.trim();
    }
    if (Object.keys(asr).length > 0) {
      normalized.asr = asr;
    }
  }
  const ttsRecord = asRecord(record.tts);
  if (ttsRecord) {
    const tts: NonNullable<SpeechConfig['tts']> = {};
    const defaultModel = normalizeModelRef(ttsRecord.defaultModel);
    if (defaultModel) {
      tts.defaultModel = defaultModel;
    }
    if (typeof ttsRecord.voice === 'string' && ttsRecord.voice.trim()) {
      tts.voice = ttsRecord.voice.trim();
    }
    if (Object.keys(tts).length > 0) {
      normalized.tts = tts;
    }
  }
  const liveRecord = asRecord(record.live);
  if (liveRecord) {
    const live: NonNullable<SpeechConfig['live']> = {
      enabled: liveRecord.enabled === true,
    };
    if (typeof liveRecord.voice === 'string' && liveRecord.voice.trim()) {
      live.voice = liveRecord.voice.trim();
    }
    if (typeof liveRecord.providerId === 'string' && liveRecord.providerId.trim()) {
      live.providerId = liveRecord.providerId.trim();
    }
    const byProvider = normalizeLiveByProvider(liveRecord.byProvider);
    if (byProvider) live.byProvider = byProvider;
    normalized.live = live;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Vision delegation (text-only primary → describe images). Default off when
 * missing; when present, always surface `enabled` so UI/host agree with disk.
 */
function normalizeReplyWriterConfig(value: unknown): ReplyWriterConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: ReplyWriterConfig = {
    enabled: record.enabled === true,
  };
  const model = normalizeModelRef(record.model);
  if (model) {
    normalized.model = model;
  }
  if (
    record.language === 'zh-CN' ||
    record.language === 'en' ||
    record.language === 'follow-user'
  ) {
    normalized.language = record.language;
  }
  if (typeof record.systemPrompt === 'string' && record.systemPrompt.trim()) {
    normalized.systemPrompt = record.systemPrompt;
  }
  const timeoutMs = asPositiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) {
    normalized.timeoutMs = timeoutMs;
  }
  return normalized;
}

function normalizeVisionDelegationConfig(value: unknown): VisionDelegationConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: VisionDelegationConfig = {
    enabled: record.enabled === true,
  };
  const model = normalizeModelRef(record.model);
  if (model) {
    normalized.model = model;
  }
  if (typeof record.systemPrompt === 'string' && record.systemPrompt.trim()) {
    normalized.systemPrompt = record.systemPrompt;
  }
  const timeoutMs = asPositiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) {
    normalized.timeoutMs = timeoutMs;
  }
  if (typeof record.cacheEnabled === 'boolean') {
    normalized.cacheEnabled = record.cacheEnabled;
  }
  return normalized;
}

/**
 * Normalize the `permissions` block (ADR 0019 §3). A missing block uses the
 * Pi-compatible YOLO default. A present but malformed block uses the safe
 * Auto fallback so invalid data never silently enables `bypass`.
 */
function normalizePermissionConfig(value: unknown): PermissionConfig {
  const record = asRecord(value);
  if (!record) {
    return value === undefined
      ? createDefaultPermissionConfig()
      : createSafeFallbackPermissionConfig();
  }
  // ADR 0024: accept `preset` (ask/auto/yolo) as the preferred field.
  const preset = record.preset;
  if (preset === 'ask' || preset === 'auto' || preset === 'yolo') {
    const resolved = resolvePreset(preset as PermissionPreset);
    return { mode: resolved.mode, preset: preset as PermissionPreset };
  }
  // Backward compat: accept legacy `mode` (auto/ask-all/bypass).
  const mode = record.mode;
  if (mode === 'auto' || mode === 'ask-all' || mode === 'bypass') {
    const presetFromMode = modeToPreset(mode as PermissionMode);
    return { mode: mode as PermissionMode, preset: presetFromMode };
  }
  return createSafeFallbackPermissionConfig();
}

function normalizeNotesConfig(value: unknown): PiwinConfig['notes'] {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const notes: NonNullable<PiwinConfig['notes']> = {};
  if (typeof record.enabled === 'boolean') {
    notes.enabled = record.enabled;
  }
  const embedding = asRecord(record.embedding);
  if (
    embedding &&
    (embedding.provider === 'openai-compatible' || embedding.provider === 'ollama') &&
    typeof embedding.baseUrl === 'string' &&
    typeof embedding.model === 'string'
  ) {
    notes.embedding = {
      provider: embedding.provider,
      baseUrl: embedding.baseUrl,
      model: embedding.model,
      ...(typeof embedding.apiKeyEnv === 'string' ? { apiKeyEnv: embedding.apiKeyEnv } : {}),
      ...(typeof embedding.apiKeyRef === 'string' ? { apiKeyRef: embedding.apiKeyRef } : {}),
      ...(asPositiveNumber(embedding.dimensions) !== undefined
        ? { dimensions: asPositiveNumber(embedding.dimensions) as number }
        : {}),
    };
  }
  const rerank = asRecord(record.rerank);
  if (rerank && rerank.provider === 'llm') {
    notes.rerank = {
      provider: 'llm',
      ...(typeof rerank.enabled === 'boolean' ? { enabled: rerank.enabled } : {}),
    };
  }
  const search = asRecord(record.search);
  if (search) {
    const searchConfig: NonNullable<NonNullable<PiwinConfig['notes']>['search']> = {};
    if (
      search.defaultMode === 'auto' ||
      search.defaultMode === 'fts' ||
      search.defaultMode === 'vector' ||
      search.defaultMode === 'hybrid'
    ) {
      searchConfig.defaultMode = search.defaultMode;
    }
    const rrfK = asPositiveNumber(search.rrfK);
    if (rrfK !== undefined) {
      searchConfig.rrfK = rrfK;
    }
    if (Object.keys(searchConfig).length > 0) {
      notes.search = searchConfig;
    }
  }
  const knowledgeExtras = normalizeNotesKnowledgeExtras(record.knowledgeExtras);
  if (knowledgeExtras) {
    notes.knowledgeExtras = knowledgeExtras;
  }
  return Object.keys(notes).length > 0 ? notes : undefined;
}

function normalizeFlashcardsConfig(value: unknown): PiwinConfig['flashcards'] {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const flashcards: NonNullable<PiwinConfig['flashcards']> = {};
  if (typeof record.enabled === 'boolean') {
    flashcards.enabled = record.enabled;
  }
  const newPerDay = asPositiveNumber(record.newPerDay);
  if (newPerDay !== undefined) {
    flashcards.newPerDay = newPerDay;
  }
  const maxReviewsPerDay = asPositiveNumber(record.maxReviewsPerDay);
  if (maxReviewsPerDay !== undefined) {
    flashcards.maxReviewsPerDay = maxReviewsPerDay;
  }
  return Object.keys(flashcards).length > 0 ? flashcards : undefined;
}

function normalizeThinkingConfig(value: unknown): ThinkingConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: ThinkingConfig = {
    ultraEnabled: record.ultraEnabled === true,
  };
  if (isThinkingLevel(record.defaultLevel)) {
    normalized.defaultLevel = record.defaultLevel;
  }
  return normalized;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max' ||
    value === 'ultra'
  );
}

function normalizeDesktopRestoreConfig(value: unknown): DesktopRestoreConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: DesktopRestoreConfig = {};
  const composerProfile = normalizeDesktopComposerProfile(record.composerProfile);
  if (composerProfile) {
    normalized.composerProfile = composerProfile;
  }
  const lastSession = asRecord(record.lastSession);
  const scopeRecord = asRecord(lastSession?.scope);
  if (lastSession && typeof lastSession.sessionId === 'string' && lastSession.sessionId.trim()) {
    if (scopeRecord?.kind === 'general') {
      normalized.lastSession = {
        sessionId: lastSession.sessionId,
        scope: { kind: 'general' },
      };
    } else if (
      scopeRecord?.kind === 'project' &&
      typeof scopeRecord.projectPath === 'string' &&
      scopeRecord.projectPath.trim()
    ) {
      normalized.lastSession = {
        sessionId: lastSession.sessionId,
        scope: { kind: 'project', projectPath: scopeRecord.projectPath },
      };
    }
  }
  return normalized.composerProfile || normalized.lastSession ? normalized : undefined;
}

function normalizeDesktopComposerProfile(
  value: unknown,
): NonNullable<DesktopRestoreConfig['composerProfile']> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: NonNullable<DesktopRestoreConfig['composerProfile']> = {};
  const model = asRecord(record.model);
  if (
    model &&
    isModelProtocol(model.protocol) &&
    typeof model.providerId === 'string' &&
    model.providerId.trim() &&
    typeof model.modelId === 'string' &&
    model.modelId.trim()
  ) {
    normalized.model = {
      protocol: model.protocol,
      providerId: model.providerId,
      modelId: model.modelId,
    };
  }
  if (isThinkingLevel(record.thinkingLevel)) {
    normalized.thinkingLevel = record.thinkingLevel;
  }
  return normalized.model || normalized.thinkingLevel ? normalized : undefined;
}

function isModelProtocol(
  value: unknown,
): value is 'openai-compatible' | 'anthropic-compatible' | 'google-gemini' {
  return (
    value === 'openai-compatible' || value === 'anthropic-compatible' || value === 'google-gemini'
  );
}

function normalizeWebConfig(value: unknown, defaults: WebConfig): WebConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const provider = record.searchProvider;
  const searchProvider =
    provider === 'duckduckgo' ||
    provider === 'brave' ||
    provider === 'tavily' ||
    provider === 'searxng' ||
    provider === 'cli' ||
    provider === 'http' ||
    provider === 'aggregate' ||
    provider === 'none'
      ? provider
      : defaults.searchProvider;
  const fetchProviderRaw = record.fetchProvider;
  const fetchProvider =
    fetchProviderRaw === 'supermarkdown' ||
    fetchProviderRaw === 'jina' ||
    fetchProviderRaw === 'firecrawl'
      ? fetchProviderRaw
      : defaults.fetchProvider;
  const searchApiKeyEnv =
    typeof record.searchApiKeyEnv === 'string' && record.searchApiKeyEnv.length > 0
      ? record.searchApiKeyEnv
      : defaults.searchApiKeyEnv;
  const searchSources = normalizeSearchSources(
    record.searchSources,
    searchProvider,
    searchApiKeyEnv,
    defaults.searchSources,
  );
  const searchStrategy = normalizeSearchStrategy(record.searchStrategy, defaults.searchStrategy);
  const searchRoutePolicy = inferSearchRoutePolicy(record.searchRoutePolicy, searchSources);
  const mirroredProvider = mirrorSearchProviderFromSources(searchSources, searchProvider);
  const normalized: WebConfig = {
    searchProvider: mirroredProvider,
    searchApiKeyEnv,
    searchMaxResults: asPositiveNumber(record.searchMaxResults) ?? defaults.searchMaxResults,
    searchTimeoutMs: asPositiveNumber(record.searchTimeoutMs) ?? defaults.searchTimeoutMs,
    searchSources,
    searchStrategy,
    searchRoutePolicy,
    fetchProvider,
    fetchApiKeyEnv:
      typeof record.fetchApiKeyEnv === 'string' && record.fetchApiKeyEnv.length > 0
        ? record.fetchApiKeyEnv
        : defaults.fetchApiKeyEnv,
    fetchMaxBytes: asPositiveNumber(record.fetchMaxBytes) ?? defaults.fetchMaxBytes,
    fetchTimeoutMs: asPositiveNumber(record.fetchTimeoutMs) ?? defaults.fetchTimeoutMs,
    fetchBlockedUrlPrefixes:
      asStringArray(record.fetchBlockedUrlPrefixes) ?? defaults.fetchBlockedUrlPrefixes,
  };
  const searchDelegateModel = normalizeModelRef(record.searchDelegateModel);
  if (searchDelegateModel) {
    normalized.searchDelegateModel = searchDelegateModel;
  }
  const fetchDelegateModel = normalizeModelRef(record.fetchDelegateModel);
  if (fetchDelegateModel) {
    normalized.fetchDelegateModel = fetchDelegateModel;
  }
  if (typeof record.fetchApiKeyRef === 'string' && record.fetchApiKeyRef.trim()) {
    normalized.fetchApiKeyRef = record.fetchApiKeyRef.trim();
  }
  const fetchReturnMaxChars =
    asPositiveInteger(record.fetchReturnMaxChars) ?? defaults.fetchReturnMaxChars;
  if (fetchReturnMaxChars !== undefined) {
    normalized.fetchReturnMaxChars = fetchReturnMaxChars;
  }
  const fetchStoreMaxChars =
    asPositiveInteger(record.fetchStoreMaxChars) ?? defaults.fetchStoreMaxChars;
  if (fetchStoreMaxChars !== undefined) {
    normalized.fetchStoreMaxChars = fetchStoreMaxChars;
  }
  const fetchCacheTtlMs = asPositiveInteger(record.fetchCacheTtlMs) ?? defaults.fetchCacheTtlMs;
  if (fetchCacheTtlMs !== undefined) {
    normalized.fetchCacheTtlMs = fetchCacheTtlMs;
  }
  const fetchFallback = normalizeFetchFallback(record.fetchFallback, defaults.fetchFallback);
  if (fetchFallback !== undefined) {
    normalized.fetchFallback = fetchFallback;
  }
  return normalized;
}

function normalizeFetchFallback(
  value: unknown,
  defaults: WebConfig['fetchFallback'],
): WebConfig['fetchFallback'] {
  if (value === 'none' || value === 'jina' || value === 'browser') {
    return value;
  }
  return defaults;
}

function normalizeSearchStrategy(
  value: unknown,
  defaults: WebConfig['searchStrategy'],
): WebConfig['searchStrategy'] {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  // Multi-source search is always parallel; legacy ordered-fallback normalizes here.
  return {
    mode: 'parallel',
    perSourceTimeoutMs: asPositiveNumber(record.perSourceTimeoutMs) ?? defaults.perSourceTimeoutMs,
  };
}

function normalizeSearchSources(
  value: unknown,
  legacyProvider: WebConfig['searchProvider'],
  legacyApiKeyEnv: string,
  defaults: WebConfig['searchSources'],
): WebConfig['searchSources'] {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => normalizeOneSearchSource(item))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  // Migrate legacy single-provider configs that predate searchSources.
  return migrateLegacySearchSources(legacyProvider, legacyApiKeyEnv, defaults);
}

function migrateLegacySearchSources(
  provider: WebConfig['searchProvider'],
  apiKeyEnv: string,
  defaults: WebConfig['searchSources'],
): WebConfig['searchSources'] {
  if (provider === 'none') {
    return [];
  }
  if (provider === 'brave') {
    return [
      {
        id: 'brave',
        kind: 'brave',
        enabled: true,
        apiKeyEnv: apiKeyEnv || 'BRAVE_API_KEY',
      },
    ];
  }
  if (provider === 'tavily') {
    return [
      {
        id: 'tavily',
        kind: 'tavily',
        enabled: true,
        apiKeyEnv: apiKeyEnv || 'TAVILY_API_KEY',
      },
    ];
  }
  if (provider === 'searxng') {
    return [{ id: 'searxng', kind: 'searxng', enabled: true }];
  }
  if (provider === 'cli') {
    return [{ id: 'cli', kind: 'cli', enabled: true }];
  }
  if (provider === 'http') {
    return [{ id: 'http', kind: 'http', enabled: true }];
  }
  if (provider === 'aggregate') {
    return defaults.length > 0
      ? defaults
      : [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }];
  }
  if (provider === 'duckduckgo') {
    return [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }];
  }
  return defaults;
}

function normalizeOneSearchSource(value: unknown): WebConfig['searchSources'][number] | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const kind = record.kind;
  if (!isWebSearchSourceKind(kind)) {
    return null;
  }
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : kind;
  const source: WebConfig['searchSources'][number] = {
    id,
    kind,
    enabled: record.enabled !== false,
  };
  if (typeof record.label === 'string' && record.label.trim()) {
    source.label = record.label.trim();
  }
  if (typeof record.apiKeyEnv === 'string' && record.apiKeyEnv.trim()) {
    source.apiKeyEnv = record.apiKeyEnv.trim();
  }
  if (typeof record.apiKeyRef === 'string' && record.apiKeyRef.trim()) {
    source.apiKeyRef = record.apiKeyRef.trim();
  }
  if (typeof record.baseUrl === 'string' && record.baseUrl.trim()) {
    source.baseUrl = record.baseUrl.trim();
  }
  if (typeof record.command === 'string' && record.command.trim()) {
    source.command = record.command.trim();
  }
  if (Array.isArray(record.args)) {
    source.args = record.args.filter((item): item is string => typeof item === 'string');
  }
  if (record.env && typeof record.env === 'object' && !Array.isArray(record.env)) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(record.env as Record<string, unknown>)) {
      if (key.trim() && typeof value === 'string') {
        env[key] = value;
      }
    }
    if (Object.keys(env).length > 0) {
      source.env = env;
    }
  }
  return source;
}

function mirrorSearchProviderFromSources(
  sources: WebConfig['searchSources'],
  fallback: WebConfig['searchProvider'],
): WebConfig['searchProvider'] {
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return 'none';
  }
  if (enabled.length > 1) {
    return 'aggregate';
  }
  const only = enabled[0];
  return only?.kind ?? fallback;
}

function normalizeSkillsConfig(value: unknown, defaults: SkillsConfig): SkillsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
  };
}

function normalizeExtensionsConfig(value: unknown, defaults: ExtensionsConfig): ExtensionsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
    ...(typeof record.agentInstall === 'boolean'
      ? { agentInstall: record.agentInstall }
      : defaults.agentInstall !== undefined
        ? { agentInstall: defaults.agentInstall }
        : {}),
  };
}

function normalizePromptsConfig(value: unknown, defaults: PromptsConfig): PromptsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
  };
}

function normalizeCompactionConfig(value: unknown, defaults: CompactionConfig): CompactionConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const normalized: CompactionConfig = {
    autoEnabledDefault:
      typeof record.autoEnabledDefault === 'boolean'
        ? record.autoEnabledDefault
        : defaults.autoEnabledDefault,
  };
  if (typeof record.writeTranscriptNote === 'boolean') {
    normalized.writeTranscriptNote = record.writeTranscriptNote;
  } else if (typeof defaults.writeTranscriptNote === 'boolean') {
    normalized.writeTranscriptNote = defaults.writeTranscriptNote;
  }
  return normalized;
}

function normalizeShellConfig(value: unknown): ShellConfig | undefined {
  const record = asRecord(value);
  if (record?.windowsBashOfferDeclined === true) {
    return { windowsBashOfferDeclined: true };
  }
  return undefined;
}

function normalizeProcessConfig(value: unknown, defaults: ProcessConfig): ProcessConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const normalized: ProcessConfig = {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : (defaults.enabled ?? true),
    maxProcesses: asPositiveInteger(record.maxProcesses) ?? defaults.maxProcesses ?? 8,
    killOnSessionEnd:
      typeof record.killOnSessionEnd === 'boolean'
        ? record.killOnSessionEnd
        : (defaults.killOnSessionEnd ?? false),
    killOnHostDispose:
      typeof record.killOnHostDispose === 'boolean'
        ? record.killOnHostDispose
        : (defaults.killOnHostDispose ?? true),
  };
  return normalized;
}

function normalizeAutomationConfig(value: unknown, defaults: AutomationConfig): AutomationConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : (defaults.enabled ?? false),
    cronEnabled:
      typeof record.cronEnabled === 'boolean'
        ? record.cronEnabled
        : (defaults.cronEnabled ?? false),
    hooksEnabled:
      typeof record.hooksEnabled === 'boolean'
        ? record.hooksEnabled
        : (defaults.hooksEnabled ?? false),
  };
}

function normalizeMarketplaceConfig(
  value: unknown,
  defaults: MarketplaceConfig,
): MarketplaceConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    skillSources: normalizeSkillSources(record.skillSources) ?? defaults.skillSources ?? ['static'],
    mcpRegistrySources: normalizeRegistrySources(record.mcpRegistrySources) ??
      defaults.mcpRegistrySources ?? ['static'],
  };
}

/**
 * Normalize the `subagents` block (CE-SUB-PROF). Missing or partial values
 * fall back to safe defaults. Invalid profile entries are dropped (with a
 * diagnostic logged by the caller if needed); limits are clamped to >= 1.
 * Saving profile changes must not rewrite provider/model definitions.
 */
function normalizeSubagentConfig(value: unknown): SubagentConfig {
  const record = asRecord(value);
  if (!record) {
    return createDefaultSubagentConfig();
  }
  const defaults = createDefaultSubagentConfig();
  const rawProfiles = Array.isArray(record.profiles) ? record.profiles : [];
  const profiles: SubagentProfileSettings[] = [];
  const seenIds = new Set<string>();
  for (const raw of rawProfiles) {
    const profile = normalizeSubagentProfile(raw);
    if (!profile) continue;
    if (seenIds.has(profile.id)) continue;
    seenIds.add(profile.id);
    profiles.push(profile);
  }
  const config: SubagentConfig = {
    profiles,
    maxConcurrency: asPositiveInteger(record.maxConcurrency) ?? defaults.maxConcurrency,
    maxTasksPerRun: asPositiveInteger(record.maxTasksPerRun) ?? defaults.maxTasksPerRun,
    processIsolation:
      record.processIsolation === 'best-effort' ? 'best-effort' : defaults.processIsolation,
    parallelWritePolicy:
      record.parallelWritePolicy === 'disabled' ? 'disabled' : defaults.parallelWritePolicy,
    dirtyBasePolicy: record.dirtyBasePolicy === 'bypass' ? 'bypass' : 'ask',
  };
  if (typeof record.defaultProfileId === 'string' && record.defaultProfileId.trim()) {
    config.defaultProfileId = record.defaultProfileId;
  }
  const rawSchemes = Array.isArray(record.schemes) ? record.schemes : [];
  const schemes: OrchestrationSchemeSettings[] = [];
  const seenSchemeIds = new Set<string>();
  for (const raw of rawSchemes) {
    const scheme = normalizeOrchestrationScheme(raw);
    if (!scheme) continue;
    if (seenSchemeIds.has(scheme.id)) continue;
    seenSchemeIds.add(scheme.id);
    schemes.push(scheme);
  }
  if (schemes.length > 0) {
    config.schemes = schemes;
  }
  return config;
}

function normalizeOrchestrationSchemeMember(
  value: unknown,
): import('@piwin/contracts').OrchestrationSchemeMember | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const role = typeof record.role === 'string' ? record.role.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (!role || !description) return undefined;
  const member: import('@piwin/contracts').OrchestrationSchemeMember = {
    role,
    description,
  };
  if (typeof record.profileId === 'string' && record.profileId.trim()) {
    member.profileId = record.profileId.trim();
  }
  const model = normalizeSubagentModelRef(record.model);
  if (model) member.model = model;
  if (isThinkingLevel(record.thinkingLevel)) {
    member.thinkingLevel = record.thinkingLevel;
  }
  if (record.isolation === 'readonly' || record.isolation === 'worktree') {
    member.isolation = record.isolation;
  }
  if (record.fallback === 'none' || record.fallback === 'main') {
    member.fallback = record.fallback;
  }
  if (typeof record.reportContract === 'string' && record.reportContract.trim()) {
    member.reportContract = record.reportContract.trim();
  }
  return member;
}

function normalizeOrchestrationScheme(value: unknown): OrchestrationSchemeSettings | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const systemPreamble =
    typeof record.systemPreamble === 'string' ? record.systemPreamble.trim() : '';
  if (!id || !name || !description || !systemPreamble) {
    return undefined;
  }
  if (!isValidOrchestrationSchemeId(id)) return undefined;

  const members: import('@piwin/contracts').OrchestrationSchemeMember[] = [];
  const seenRoles = new Set<string>();
  if (Array.isArray(record.members)) {
    for (const raw of record.members) {
      const member = normalizeOrchestrationSchemeMember(raw);
      if (!member) continue;
      if (seenRoles.has(member.role)) continue;
      seenRoles.add(member.role);
      members.push(member);
    }
  }

  const defaultProfileId =
    typeof record.defaultProfileId === 'string' ? record.defaultProfileId.trim() : '';
  const defaultRole = typeof record.defaultRole === 'string' ? record.defaultRole.trim() : '';

  // v2: members alone are enough; v1 required defaultProfileId.
  if (members.length === 0 && !defaultProfileId) {
    return undefined;
  }

  // MVP: only await-all is supported (synchronous spawn+merge). Accept any input.
  const waitPolicy: 'await-all' = 'await-all';
  const scheme: OrchestrationSchemeSettings = {
    id,
    name,
    description,
    exposeSpawnMetadata: record.exposeSpawnMetadata === true,
    waitPolicy,
    systemPreamble,
  };
  if (defaultProfileId) scheme.defaultProfileId = defaultProfileId;
  if (defaultRole) scheme.defaultRole = defaultRole;
  if (members.length > 0) scheme.members = members;
  if (Array.isArray(record.allowedProfileIds)) {
    const allowed = record.allowedProfileIds
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (allowed.length > 0) scheme.allowedProfileIds = allowed;
  }
  const maxConcurrency = asPositiveInteger(record.maxConcurrency);
  if (maxConcurrency !== undefined) scheme.maxConcurrency = maxConcurrency;
  const maxTasksPerRun = asPositiveInteger(record.maxTasksPerRun);
  if (maxTasksPerRun !== undefined) scheme.maxTasksPerRun = maxTasksPerRun;
  if (isThinkingLevel(record.maxSubagentThinkingLevel)) {
    scheme.maxSubagentThinkingLevel = record.maxSubagentThinkingLevel;
  }
  return canonicalizeUltraCodeSchemeSettings(scheme);
}

function normalizeSubagentProfile(value: unknown): SubagentProfileSettings | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (!id || !description) return undefined;
  const isolation = normalizeSubagentIsolation(record.isolation);
  if (!isolation) return undefined;
  const profile: SubagentProfileSettings = {
    id,
    description,
    isolation,
  };
  const model = normalizeSubagentModelRef(record.model);
  if (model) profile.model = model;
  if (isThinkingLevel(record.thinkingLevel)) {
    profile.thinkingLevel = record.thinkingLevel;
  }
  const capabilities = normalizeSubagentCapabilities(record.capabilities);
  if (capabilities) profile.capabilities = capabilities;
  const skillIds = asStringArray(record.skillIds);
  if (skillIds) profile.skillIds = skillIds;
  return profile;
}

function normalizeSubagentIsolation(value: unknown): SubagentIsolationMode | undefined {
  if (value === 'readonly' || value === 'worktree') return value;
  return undefined;
}

function normalizeSubagentModelRef(value: unknown): SubagentProfileSettings['model'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
  if (!providerId || !modelId) return undefined;
  // Subscription pins omit protocol on purpose (models/configured). Require
  // only providerId+modelId so Fusion sidekick overlays survive save.
  const model: NonNullable<SubagentProfileSettings['model']> = { providerId, modelId };
  if (isModelProtocol(record.protocol)) {
    model.protocol = record.protocol;
  }
  if (record.source === 'subscription' || record.source === 'channel') {
    model.source = record.source;
  }
  return model;
}

function normalizeModelRef(value: unknown): SubagentProfileSettings['model'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const protocol = record.protocol;
  if (
    protocol !== 'openai-compatible' &&
    protocol !== 'anthropic-compatible' &&
    protocol !== 'google-gemini'
  ) {
    return undefined;
  }
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
  if (!providerId || !modelId) return undefined;
  return { protocol, providerId, modelId };
}

function normalizeSubagentCapabilities(value: unknown): SubagentCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<SubagentCapability>(SUBAGENT_CAPABILITIES);
  const caps = value.filter((cap): cap is SubagentCapability => allowed.has(cap));
  return caps.length > 0 ? caps : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const numericValue = asPositiveNumber(value);
  return numericValue === undefined ? undefined : Math.floor(numericValue);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  // Preserve empty arrays (e.g. disabledIds: []) so defaults are not re-applied.
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeSkillSources(value: unknown): Array<'static' | 'git-index'> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(
    (source): source is 'static' | 'git-index' => source === 'static' || source === 'git-index',
  );
}

function normalizeRegistrySources(
  value: unknown,
): Array<'official' | 'smithery' | 'glama' | 'static'> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(
    (source): source is 'official' | 'smithery' | 'glama' | 'static' =>
      source === 'official' || source === 'smithery' || source === 'glama' || source === 'static',
  );
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT',
  );
}
