import type {
  CodeSearchConfig,
  ExecutionConfig,
  PermissionConfig,
  PermissionMode,
  PermissionPreset,
  PiwinConfig,
} from '@piwin/contracts';
import { normalizeBrowserWorkbenchConfig } from './config-store-browser.js';
import { normalizeKnowledgeConfig } from './config-store-knowledge.js';
import { getPiwinConfigPath, getPiwinRoot } from './paths.js';
import {
  isBlockingValidationIssue,
  sanitizeProvidersForSave,
  validatePiwinConfig,
} from './provider-validation.js';
import {
  DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES,
  createDefaultArtifactConfig,
  createDefaultAutomationConfig,
  createDefaultCodeSearchConfig,
  createDefaultCompactionConfig,
  createDefaultExecutionConfig,
  createDefaultExtensionsConfig,
  createDefaultMarketplaceConfig,
  createDefaultPermissionConfig,
  createDefaultProcessConfig,
  createDefaultPromptsConfig,
  createDefaultSessionConfig,
  createDefaultSkillsConfig,
  createDefaultSubagentConfig,
  createDefaultWalkthroughConfig,
  createDefaultWebConfig,
  createSafeFallbackPermissionConfig,
  modeToPreset,
  normalizeExecutionConfig,
  normalizeWalkthroughConfig,
  resolvePreset,
} from '@piwin/contracts';
import { writeTextFileAtomic } from '@piwin/session';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeArtifactConfig } from './config-store-artifact.js';
import {
  normalizeImageGenerationConfig,
  normalizeReplyWriterConfig,
  normalizeSpeechConfig,
  normalizeThinkingConfig,
  normalizeVideoGenerationConfig,
  normalizeVisionDelegationConfig,
} from './config-store-capabilities.js';
import { normalizeDesktopRestoreConfig } from './config-store-desktop.js';
import { normalizeFlashcardsConfig, normalizeNotesConfig } from './config-store-notes.js';
import { normalizeCompactionConfig, normalizeSessionConfig } from './config-store-session.js';
import { normalizeSubagentConfig } from './config-store-subagent.js';
import {
  normalizeAutomationConfig,
  normalizeExtensionsConfig,
  normalizeMarketplaceConfig,
  normalizeProcessConfig,
  normalizePromptsConfig,
  normalizeShellConfig,
  normalizeSkillsConfig,
} from './config-store-tools.js';
import { normalizeWebConfig } from './config-store-web.js';
import { asPositiveNumber, asRecord, asStringArray } from './config-store-primitives.js';

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
  const backend =
    record.backend === 'windsurf' ? 'windsurf' : record.backend === 'model' ? 'model' : undefined;
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
  if (
    typeof record.treeDepth === 'number' &&
    Number.isFinite(record.treeDepth) &&
    record.treeDepth >= 0
  ) {
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

/**
 * Image generation default model (optional). Missing/invalid → omitted.
 */

/**
 * Video generation default model (optional). Missing/invalid → omitted.
 * Provider route details live with the model entry so multiple video vendors
 * can coexist under one config root.
 */

/**
 * Vision delegation (text-only primary → describe images). Default off when
 * missing; when present, always surface `enabled` so UI/host agree with disk.
 */

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

/**
 * Normalize the `subagents` block (CE-SUB-PROF). Missing or partial values
 * fall back to safe defaults. Invalid profile entries are dropped (with a
 * diagnostic logged by the caller if needed); limits are clamped to >= 1.
 * Saving profile changes must not rewrite provider/model definitions.
 */

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT',
  );
}
