import type {
  OrchestrationSchemeSettings,
  SubagentCapability,
  SubagentConfig,
  SubagentIsolationMode,
  SubagentProfileSettings,
} from '@piwin/contracts';
import {
  SUBAGENT_CAPABILITIES,
  canonicalizeUltraCodeSchemeSettings,
  createDefaultSubagentConfig,
  isValidOrchestrationSchemeId,
} from '@piwin/contracts';
import {
  asPositiveInteger,
  asRecord,
  asStringArray,
  isModelProtocol,
  isThinkingLevel,
} from './config-store-primitives.js';

/**
 * Normalize `PiwinConfig.subagents` incl. orchestration schemes and subagent profiles.
 */

export function normalizeSubagentConfig(value: unknown): SubagentConfig {
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
  const freehandReadonlyModel = normalizeSubagentModelRef(record.freehandReadonlyModel);
  if (freehandReadonlyModel) config.freehandReadonlyModel = freehandReadonlyModel;
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

export function normalizeOrchestrationSchemeMember(
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

export function normalizeOrchestrationScheme(
  value: unknown,
): OrchestrationSchemeSettings | undefined {
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

export function normalizeSubagentProfile(value: unknown): SubagentProfileSettings | undefined {
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

export function normalizeSubagentIsolation(value: unknown): SubagentIsolationMode | undefined {
  if (value === 'readonly' || value === 'worktree') return value;
  return undefined;
}

export function normalizeSubagentModelRef(
  value: unknown,
): SubagentProfileSettings['model'] | undefined {
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

export function normalizeSubagentCapabilities(value: unknown): SubagentCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<SubagentCapability>(SUBAGENT_CAPABILITIES);
  const caps = value.filter((cap): cap is SubagentCapability => allowed.has(cap));
  return caps.length > 0 ? caps : undefined;
}
