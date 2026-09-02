/**
 * CE-SUB-PROF: resolve effective subagent profiles from Settings + built-ins.
 *
 * `SubagentProfileResolver` merges built-in profiles with Settings overrides
 * by id. It does not create child sessions or map capabilities to tools; that
 * is the job of `SubagentCapabilityResolver` and `SubagentLifecycleService`.
 */

import type {
  ModelProviderConfig,
  PiwinConfig,
  SubagentProfile,
  SubagentProfileSelector,
  SubagentProfileSettings,
  SubagentRuntimeSnapshot,
  SubagentCapability,
  ThinkingLevel,
  ModelRef,
  SubagentIsolationMode,
} from '@piwin/contracts';
import { SUBAGENT_CAPABILITIES } from '@piwin/contracts';
import { BUILTIN_SUBAGENT_PROFILES } from './subagent-profile-defaults.js';

export type ResolveProfileIssue = {
  profileId: string;
  message: string;
};

export type ResolveProfileResult = {
  profile: SubagentProfile | undefined;
  issues: ResolveProfileIssue[];
};

/**
 * Merge built-in profiles with Settings profiles. A Settings profile with the
 * same id as a built-in overrides the built-in's fields; otherwise it is
 * added. Returns the merged list in stable order: built-ins first (in their
 * declared order), then Settings-only profiles (in Settings order).
 */
export function resolveSubagentProfiles(config: PiwinConfig): SubagentProfile[] {
  const settingsProfiles = config.subagents?.profiles ?? [];
  const byId = new Map<string, SubagentProfile>();
  for (const builtin of BUILTIN_SUBAGENT_PROFILES) {
    byId.set(builtin.id, { ...builtin, source: 'builtin' });
  }
  for (const settingsProfile of settingsProfiles) {
    byId.set(settingsProfile.id, { ...settingsProfile, source: 'settings' });
  }
  // Stable order: built-in ids first (in declared order), then settings-only ids.
  const builtinIds = new Set(BUILTIN_SUBAGENT_PROFILES.map((p) => p.id));
  const ordered: SubagentProfile[] = [];
  for (const builtin of BUILTIN_SUBAGENT_PROFILES) {
    const resolved = byId.get(builtin.id);
    if (resolved) ordered.push(resolved);
  }
  for (const settingsProfile of settingsProfiles) {
    if (!builtinIds.has(settingsProfile.id)) {
      const resolved = byId.get(settingsProfile.id);
      if (resolved) ordered.push(resolved);
    }
  }
  return ordered;
}

/**
 * Validate that a profile's model ref points to a configured, enabled provider
 * and model. Returns issues (never throws); callers decide whether to reject.
 */
export function validateProfileModel(
  profile: SubagentProfileSettings,
  providers: readonly ModelProviderConfig[],
): ResolveProfileIssue[] {
  const issues: ResolveProfileIssue[] = [];
  if (!profile.model) return issues;
  const provider = providers.find((p) => p.id === profile.model?.providerId);
  if (!provider) {
    issues.push({
      profileId: profile.id,
      message: `model references unknown provider "${profile.model.providerId}"`,
    });
    return issues;
  }
  if (provider.protocol !== profile.model.protocol) {
    issues.push({
      profileId: profile.id,
      message: `model protocol "${profile.model.protocol}" does not match provider "${provider.id}" protocol "${provider.protocol}"`,
    });
  }
  const model = provider.models.find((m) => m.id === profile.model?.modelId);
  if (!model) {
    issues.push({
      profileId: profile.id,
      message: `model references unknown model "${profile.model.modelId}" on provider "${provider.id}"`,
    });
  }
  return issues;
}

/**
 * Validate a profile's capability ids and isolation mode.
 */
export function validateProfileCapabilities(
  profile: SubagentProfileSettings,
): ResolveProfileIssue[] {
  const issues: ResolveProfileIssue[] = [];
  if (profile.capabilities) {
    for (const cap of profile.capabilities) {
      if (!SUBAGENT_CAPABILITIES.includes(cap)) {
        issues.push({
          profileId: profile.id,
          message: `unknown capability "${cap}"`,
        });
      }
    }
  }
  if (profile.isolation !== 'readonly' && profile.isolation !== 'worktree') {
    issues.push({
      profileId: profile.id,
      message: `invalid isolation "${profile.isolation}"`,
    });
  }
  return issues;
}

/**
 * Resolve a single profile by selector. Returns the profile and any issues
 * (e.g. unknown profile id, invalid model ref). When `selector.profileId` is
 * omitted, falls back to `config.subagents.defaultProfileId`; when that is
 * also absent, returns `undefined` (caller uses legacy defaults).
 */
export function resolveSubagentProfile(
  config: PiwinConfig,
  selector: SubagentProfileSelector,
): ResolveProfileResult {
  const profiles = resolveSubagentProfiles(config);
  const profileId = selector.profileId ?? config.subagents?.defaultProfileId;
  if (!profileId) {
    return { profile: undefined, issues: [] };
  }
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    return {
      profile: undefined,
      issues: [{ profileId, message: `unknown profile "${profileId}"` }],
    };
  }
  const issues: ResolveProfileIssue[] = [
    ...validateProfileModel(profile, config.providers),
    ...validateProfileCapabilities(profile),
  ];
  return { profile, issues };
}

/**
 * Resolve the effective model for a child. Precedence:
 *   per-call model > profile model > undefined (inherit parent/default)
 */
export function resolveSubagentModel(
  profile: SubagentProfileSettings | undefined,
  selector: SubagentProfileSelector,
): ModelRef | undefined {
  return selector.model ?? profile?.model;
}

/**
 * Resolve the effective thinking level. Precedence:
 *   per-call thinking > profile thinking > undefined
 */
export function resolveSubagentThinking(
  profile: SubagentProfileSettings | undefined,
  selector: SubagentProfileSelector,
): ThinkingLevel | undefined {
  return selector.thinkingLevel ?? profile?.thinkingLevel;
}

/**
 * Resolve the effective isolation. With no selected profile, an explicit
 * caller mode is authoritative; otherwise the legacy default stays readonly.
 * A selected profile may make the request stricter (worktree → readonly) but
 * cannot be widened (readonly → worktree).
 */
export function resolveSubagentIsolation(
  profile: SubagentProfileSettings | undefined,
  callerMode: SubagentIsolationMode | undefined,
): SubagentIsolationMode {
  if (!profile) return callerMode ?? 'readonly';

  const profileIsolation = profile.isolation;
  if (callerMode === 'readonly' && profileIsolation === 'worktree') {
    return 'readonly';
  }
  if (callerMode === 'worktree' && profileIsolation === 'readonly') {
    return 'readonly';
  }
  return callerMode ?? profileIsolation;
}

/**
 * Intersect caller-requested capabilities with profile capabilities. The
 * profile's capability set is the maximum; a caller cannot widen it.
 */
export function resolveSubagentCapabilities(
  profile: SubagentProfileSettings | undefined,
  callerCapabilities: readonly SubagentCapability[] | undefined,
): SubagentCapability[] | undefined {
  if (!profile?.capabilities) {
    return callerCapabilities ? [...callerCapabilities] : undefined;
  }
  if (!callerCapabilities) {
    return [...profile.capabilities];
  }
  const allowed = new Set(profile.capabilities);
  return callerCapabilities.filter((cap) => allowed.has(cap));
}

/**
 * Intersect a profile skill allowlist with globally enabled skills. When the
 * profile has no `skillIds`, the caller's globally enabled skills are used
 * unchanged.
 */
export function resolveSubagentSkillIds(
  profile: SubagentProfileSettings | undefined,
  enabledSkillIds: readonly string[],
): string[] | undefined {
  if (!profile?.skillIds) return undefined;
  const enabled = new Set(enabledSkillIds);
  return profile.skillIds.filter((id) => enabled.has(id));
}

/**
 * Build an immutable `SubagentRuntimeSnapshot` from the resolved profile,
 * selector, and resolved working directory. This is the only place a
 * snapshot is assembled for new children; resume uses the persisted snapshot.
 */
export function buildSubagentRuntimeSnapshot(input: {
  profile: SubagentProfileSettings | undefined;
  selector: SubagentProfileSelector;
  workingDirectory: string;
  callerMode?: SubagentIsolationMode;
  callerCapabilities?: readonly SubagentCapability[];
  enabledSkillIds: readonly string[];
}): SubagentRuntimeSnapshot {
  const { profile, selector, workingDirectory } = input;
  const model = resolveSubagentModel(profile, selector);
  const thinkingLevel = resolveSubagentThinking(profile, selector);
  const isolation = resolveSubagentIsolation(profile, input.callerMode);
  const capabilities = resolveSubagentCapabilities(profile, input.callerCapabilities);
  const skillIds = resolveSubagentSkillIds(profile, input.enabledSkillIds);
  const snapshot: SubagentRuntimeSnapshot = {
    isolation,
    workingDirectory,
  };
  if (profile) snapshot.profileId = profile.id;
  if (model) snapshot.model = model;
  if (thinkingLevel) snapshot.thinkingLevel = thinkingLevel;
  if (capabilities) snapshot.capabilities = capabilities;
  if (skillIds) snapshot.skillIds = skillIds;
  return snapshot;
}
