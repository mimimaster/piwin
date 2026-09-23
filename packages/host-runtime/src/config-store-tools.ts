import type {
  AutomationConfig,
  ExtensionsConfig,
  MarketplaceConfig,
  ProcessConfig,
  PromptsConfig,
  ShellConfig,
  SkillsConfig,
} from '@piwin/contracts';
import { asPositiveInteger, asRecord, asStringArray } from './config-store-primitives.js';

/**
 * Normalize the product tool surfaces: skills, extensions, prompts, shell, process, automation, marketplace.
 */

export function normalizeSkillsConfig(value: unknown, defaults: SkillsConfig): SkillsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
  };
}

export function normalizeExtensionsConfig(
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
    ...(typeof record.agentInstall === 'boolean'
      ? { agentInstall: record.agentInstall }
      : defaults.agentInstall !== undefined
        ? { agentInstall: defaults.agentInstall }
        : {}),
  };
}

export function normalizePromptsConfig(value: unknown, defaults: PromptsConfig): PromptsConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  return {
    extraPaths: asStringArray(record.extraPaths) ?? defaults.extraPaths,
    disabledIds: asStringArray(record.disabledIds) ?? defaults.disabledIds,
  };
}

export function normalizeShellConfig(value: unknown): ShellConfig | undefined {
  const record = asRecord(value);
  if (record?.windowsBashOfferDeclined === true) {
    return { windowsBashOfferDeclined: true };
  }
  return undefined;
}

export function normalizeProcessConfig(value: unknown, defaults: ProcessConfig): ProcessConfig {
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

export function normalizeAutomationConfig(
  value: unknown,
  defaults: AutomationConfig,
): AutomationConfig {
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

export function normalizeMarketplaceConfig(
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

export function normalizeSkillSources(value: unknown): Array<'static' | 'git-index'> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(
    (source): source is 'static' | 'git-index' => source === 'static' || source === 'git-index',
  );
}

export function normalizeRegistrySources(
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
