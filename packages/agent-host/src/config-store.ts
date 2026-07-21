import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CompactionConfig,
  ExtensionsConfig,
  PiwinConfig,
  PromptsConfig,
  SkillsConfig,
  WebConfig,
} from '@piwin/contracts';
import {
  createDefaultCompactionConfig,
  createDefaultExtensionsConfig,
  createDefaultPromptsConfig,
  createDefaultSkillsConfig,
  createDefaultWebConfig,
} from '@piwin/contracts';
import { getPiwinConfigPath, getPiwinRoot } from './paths.js';
import {
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
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    artifact: {
      maxBytes: 100 * 1024,
      htmlUiModeDefault: true,
    },
    web: createDefaultWebConfig(),
    skills: createDefaultSkillsConfig(),
    extensions: createDefaultExtensionsConfig(),
    prompts: createDefaultPromptsConfig(),
    compaction: createDefaultCompactionConfig(),
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

export async function savePiwinConfig(
  config: PiwinConfig,
  piwinRoot?: string,
): Promise<string> {
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
      maxBytes:
        asPositiveNumber(asRecord(record.artifact)?.maxBytes) ?? defaults.artifact.maxBytes,
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
  return normalized;
}

function normalizeWebConfig(value: unknown, defaults: WebConfig): WebConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const provider = record.searchProvider;
  const searchProvider =
    provider === 'brave' || provider === 'tavily' || provider === 'none'
      ? provider
      : defaults.searchProvider;
  return {
    searchProvider,
    searchApiKeyEnv:
      typeof record.searchApiKeyEnv === 'string' && record.searchApiKeyEnv.length > 0
        ? record.searchApiKeyEnv
        : defaults.searchApiKeyEnv,
    searchMaxResults:
      asPositiveNumber(record.searchMaxResults) ?? defaults.searchMaxResults,
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

function normalizeExtensionsConfig(
  value: unknown,
  defaults: ExtensionsConfig,
): ExtensionsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
  };
}


function normalizePromptsConfig(
  value: unknown,
  defaults: PromptsConfig,
): PromptsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
  };
}

function normalizeCompactionConfig(
  value: unknown,
  defaults: CompactionConfig,
): CompactionConfig {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  // Preserve empty arrays (e.g. disabledIds: []) so defaults are not re-applied.
  return value.filter((item): item is string => typeof item === 'string');
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}
