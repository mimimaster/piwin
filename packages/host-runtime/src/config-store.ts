import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AutomationConfig,
  ArtifactConfig,
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
  SkillsConfig,
  SubagentConfig,
  SubagentProfileSettings,
  SubagentCapability,
  SubagentIsolationMode,
  OrchestrationSchemeSettings,
  ThinkingConfig,
  ThinkingLevel,
  VisionDelegationConfig,
  VideoGenerationConfig,
  WebConfig,
  PermissionPreset,
} from '@piwin/contracts';
import {
  createDefaultAutomationConfig,
  createDefaultArtifactConfig,
  createDefaultCompactionConfig,
  createDefaultExtensionsConfig,
  createDefaultMarketplaceConfig,
  createDefaultPermissionConfig,
  createSafeFallbackPermissionConfig,
  createDefaultProcessConfig,
  createDefaultPromptsConfig,
  createDefaultSessionConfig,
  createDefaultSkillsConfig,
  createDefaultSubagentConfig,
  createDefaultWalkthroughConfig,
  createDefaultWebConfig,
  modeToPreset,
  normalizeWalkthroughConfig,
  resolvePreset,
  SUBAGENT_CAPABILITIES,
} from '@piwin/contracts';
import { getPiwinConfigPath, getPiwinRoot } from './paths.js';
import { sanitizeProvidersForSave, validatePiwinConfig } from './provider-validation.js';

export function createDefaultPiwinConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
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
      return createDefaultPiwinConfig();
    }
    throw error;
  }
}

export async function savePiwinConfig(config: PiwinConfig, piwinRoot?: string): Promise<string> {
  const issues = validatePiwinConfig(config);
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
  await writeFile(configPath, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
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
      allowedMimeTypes:
        asStringArray(asRecord(record.media)?.allowedMimeTypes) ?? defaults.media.allowedMimeTypes,
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
  normalized.session = normalizeSessionConfig(
    record.session,
    defaults.session ?? createDefaultSessionConfig(),
  );
  normalized.permissions = normalizePermissionConfig(record.permissions);
  normalized.walkthrough = normalizeWalkthroughConfig(record.walkthrough);
  normalized.subagents = normalizeSubagentConfig(record.subagents);
  const imageGeneration = normalizeImageGenerationConfig(record.imageGeneration);
  if (imageGeneration) {
    normalized.imageGeneration = imageGeneration;
  }
  const videoGeneration = normalizeVideoGenerationConfig(record.videoGeneration);
  if (videoGeneration) {
    normalized.videoGeneration = videoGeneration;
  }
  const visionDelegation = normalizeVisionDelegationConfig(record.visionDelegation);
  if (visionDelegation) {
    normalized.visionDelegation = visionDelegation;
  }
  return normalized;
}

/**
 * Normalize the `artifact` block. Handles migration from the legacy shape
 * (`htmlUiModeDefault`) to the new `ArtifactConfig` (`enabled`, `triggerMode`,
 * `decisionPrompt`, `maxBytes`).
 */
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
    triggerMode,
    decisionPrompt: { mode: promptMode, customPrompt },
    maxBytes,
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
  return config;
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

/**
 * Vision delegation (text-only primary → describe images). Default off when
 * missing; when present, always surface `enabled` so UI/host agree with disk.
 */
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
  const mirroredProvider = mirrorSearchProviderFromSources(searchSources, searchProvider);
  const normalized: WebConfig = {
    searchProvider: mirroredProvider,
    searchApiKeyEnv,
    searchMaxResults: asPositiveNumber(record.searchMaxResults) ?? defaults.searchMaxResults,
    searchTimeoutMs: asPositiveNumber(record.searchTimeoutMs) ?? defaults.searchTimeoutMs,
    searchSources,
    searchStrategy,
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
  if (typeof record.fetchApiKeyRef === 'string' && record.fetchApiKeyRef.trim()) {
    normalized.fetchApiKeyRef = record.fetchApiKeyRef.trim();
  }
  return normalized;
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
  if (
    kind !== 'duckduckgo' &&
    kind !== 'brave' &&
    kind !== 'tavily' &&
    kind !== 'searxng' &&
    kind !== 'cli'
  ) {
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


function normalizeOrchestrationScheme(value: unknown): OrchestrationSchemeSettings | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const defaultProfileId =
    typeof record.defaultProfileId === 'string' ? record.defaultProfileId.trim() : '';
  const systemPreamble =
    typeof record.systemPreamble === 'string' ? record.systemPreamble.trim() : '';
  if (!id || !name || !description || !defaultProfileId || !systemPreamble) {
    return undefined;
  }
  if (id === 'off') return undefined;
  const waitPolicy = record.waitPolicy === 'fire-and-continue' ? 'await-all' : 'await-all';
  const scheme: OrchestrationSchemeSettings = {
    id,
    name,
    description,
    defaultProfileId,
    exposeSpawnMetadata: record.exposeSpawnMetadata === true,
    waitPolicy,
    systemPreamble,
  };
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
  return scheme;
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
  return normalizeModelRef(value);
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
