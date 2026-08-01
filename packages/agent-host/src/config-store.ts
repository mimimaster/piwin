import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AutomationConfig,
  CompactionConfig,
  DesktopRestoreConfig,
  ExecutionConfig,
  ExtensionsConfig,
  MarketplaceConfig,
  PermissionConfig,
  PermissionMode,
  PiwinConfig,
  ProcessConfig,
  PromptsConfig,
  SessionConfig,
  SkillsConfig,
  ThinkingConfig,
  ThinkingLevel,
  WebConfig,
} from '@piwin/contracts';
import {
  createDefaultAutomationConfig,
  createDefaultCompactionConfig,
  createDefaultExecutionConfig,
  createDefaultExtensionsConfig,
  createDefaultMarketplaceConfig,
  createDefaultPermissionConfig,
  createDefaultProcessConfig,
  createDefaultPromptsConfig,
  createDefaultSessionConfig,
  createDefaultSkillsConfig,
  createDefaultWalkthroughConfig,
  createDefaultWebConfig,
  normalizeWalkthroughConfig,
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
      maxBytes: 100 * 1024,
      htmlUiModeDefault: false,
    },
    web: createDefaultWebConfig(),
    skills: createDefaultSkillsConfig(),
    extensions: createDefaultExtensionsConfig(),
    prompts: createDefaultPromptsConfig(),
    compaction: createDefaultCompactionConfig(),
    process: createDefaultProcessConfig(),
    execution: createDefaultExecutionConfig(),
    automation: createDefaultAutomationConfig(),
    marketplace: createDefaultMarketplaceConfig(),
    walkthrough: createDefaultWalkthroughConfig(),
  };
}

export async function loadPiwinConfig(piwinRoot?: string): Promise<PiwinConfig> {
  const rootDir = getPiwinRoot(piwinRoot);
  const configPath = getPiwinConfigPath(rootDir);
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return normalizeConfig(parsed);
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
      config: normalizeConfig(JSON.parse(existing)),
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

function normalizeConfig(value: unknown): PiwinConfig {
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
      maxBytes: asPositiveNumber(asRecord(record.artifact)?.maxBytes) ?? defaults.artifact.maxBytes,
      htmlUiModeDefault:
        typeof asRecord(record.artifact)?.htmlUiModeDefault === 'boolean'
          ? Boolean(asRecord(record.artifact)?.htmlUiModeDefault)
          : defaults.artifact.htmlUiModeDefault,
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
  normalized.execution = normalizeExecutionConfig(
    record.execution,
    defaults.execution ?? createDefaultExecutionConfig(),
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
  return normalized;
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
 * Normalize the `permissions` block (ADR 0019 §3). Unknown / missing values
 * fall back to the default `'auto'` mode so a malformed config never silently
 * enables `bypass`.
 */
function normalizePermissionConfig(value: unknown): PermissionConfig {
  const record = asRecord(value);
  if (!record) {
    return createDefaultPermissionConfig();
  }
  const mode = record.mode;
  if (mode === 'auto' || mode === 'ask-all' || mode === 'bypass') {
    return { mode: mode as PermissionMode };
  }
  return createDefaultPermissionConfig();
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
  return {
    searchProvider,
    searchApiKeyEnv:
      typeof record.searchApiKeyEnv === 'string' && record.searchApiKeyEnv.length > 0
        ? record.searchApiKeyEnv
        : defaults.searchApiKeyEnv,
    searchMaxResults: asPositiveNumber(record.searchMaxResults) ?? defaults.searchMaxResults,
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

function normalizeExecutionConfig(value: unknown, defaults: ExecutionConfig): ExecutionConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const defaultMode = record.defaultMode;
  return {
    defaultMode:
      defaultMode === 'chat' || defaultMode === 'agent' || defaultMode === 'agent-debug'
        ? defaultMode
        : (defaults.defaultMode ?? 'agent'),
  };
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
