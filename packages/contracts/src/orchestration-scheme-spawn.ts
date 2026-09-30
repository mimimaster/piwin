import type { ModelRef, ThinkingLevel } from './host.js';
import type { SubagentIsolationMode } from './subagent.js';
import { canonicalizeOrchestrationRole } from './orchestration-scheme-builtin.js';
import { clampThinkingLevelToMax } from './orchestration-scheme-resolved.js';
import { migrateSchemeMembers } from './orchestration-scheme-members.js';
import type {
  ResolvedOrchestrationMember,
  ResolvedOrchestrationScheme,
} from './orchestration-scheme-resolved.js';
import type {
  OrchestrationMemberBehavior,
  OrchestrationMemberFallback,
  OrchestrationSchemeSettings,
} from './orchestration-scheme-types.js';

export type SchemeSpawnApplication = {
  role?: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  reportContract?: string;
  /** Builtin member delivery behavior the Host enforces for this spawn. */
  behavior?: OrchestrationMemberBehavior;
  clearedModel: boolean;
  forcedProfile: boolean;
  /** When set, Host should not spawn — return fallback tool result instead. */
  fallback?: {
    kind: OrchestrationMemberFallback;
    role: string;
    reason: string;
  };
};

/**
 * Soft-generic + role roster application for subagent spawn.
 * When scheme is active, prefer `role` → member resolution over free model picks.
 */
export function applySchemeToSubagentSpawnInput(
  resolved: ResolvedOrchestrationScheme | undefined,
  input: {
    role?: string;
    profileId?: string;
    model?: ModelRef | unknown;
    thinkingLevel?: ThinkingLevel;
  },
): SchemeSpawnApplication {
  if (!resolved) {
    const result: SchemeSpawnApplication = {
      clearedModel: false,
      forcedProfile: false,
    };
    if (input.role?.trim()) result.role = input.role.trim();
    if (input.profileId) result.profileId = input.profileId;
    if (input.thinkingLevel) result.thinkingLevel = input.thinkingLevel;
    return result;
  }

  const requestedRole = input.role?.trim();
  const role = canonicalizeOrchestrationRole(
    resolved.schemeId,
    requestedRole || resolved.defaultRole,
  );
  const member = resolved.members.find((item) => item.role === role);

  if (!member) {
    return {
      role,
      clearedModel: true,
      forcedProfile: true,
      fallback: {
        kind: 'main',
        role,
        reason: `unknown role "${role}" in scheme "${resolved.schemeId}"`,
      },
    };
  }

  if (!member.available) {
    const kind = member.fallback;
    return {
      role: member.role,
      ...(member.profileId ? { profileId: member.profileId } : {}),
      clearedModel: true,
      forcedProfile: true,
      fallback: {
        kind,
        role: member.role,
        reason: member.unavailableReason ?? 'member unavailable',
      },
    };
  }

  const thinkingCeiling =
    member.thinkingLevel !== undefined
      ? clampThinkingLevelToMax(member.thinkingLevel, resolved.maxSubagentThinkingLevel)
      : resolved.maxSubagentThinkingLevel;

  const thinkingLevel = resolved.exposeSpawnMetadata
    ? clampThinkingLevelToMax(input.thinkingLevel ?? member.thinkingLevel, thinkingCeiling)
    : clampThinkingLevelToMax(member.thinkingLevel ?? input.thinkingLevel, thinkingCeiling);

  const profileId =
    member.profileId ||
    (resolved.exposeSpawnMetadata ? input.profileId : undefined) ||
    resolved.defaultProfileId;

  const allowInputModel =
    resolved.exposeSpawnMetadata &&
    input.model &&
    typeof input.model === 'object' &&
    input.model !== null &&
    'providerId' in input.model &&
    'modelId' in input.model;

  const model: ModelRef | undefined = member.model
    ? member.model
    : allowInputModel
      ? (input.model as ModelRef)
      : undefined;

  return {
    role: member.role,
    ...(profileId ? { profileId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(member.isolation ? { isolation: member.isolation } : {}),
    ...(member.reportContract ? { reportContract: member.reportContract } : {}),
    ...(member.behavior ? { behavior: member.behavior } : {}),
    clearedModel: !resolved.exposeSpawnMetadata || Boolean(member.model),
    forcedProfile: !input.profileId || input.profileId !== profileId,
  };
}

/**
 * Default roster role when the member has no pinned model (inherits composer).
 * Undefined when Off-equivalent, empty, or the default member already pins one.
 */
export function resolveUnpinnedOrchestrationDefaultRole(
  scheme: Pick<OrchestrationSchemeSettings, 'members' | 'defaultProfileId' | 'defaultRole' | 'id'>,
): string | undefined {
  const members = migrateSchemeMembers(scheme);
  const defaultRoleRaw = scheme.defaultRole?.trim();
  const defaultRole =
    defaultRoleRaw && members.some((member) => member.role === defaultRoleRaw)
      ? defaultRoleRaw
      : members[0]?.role;
  if (!defaultRole) return undefined;
  const member = members.find((item) => item.role === defaultRole);
  if (!member || member.model) return undefined;
  return defaultRole;
}

/** Look up a resolved member by role (Host helper). */
export function findResolvedSchemeMember(
  resolved: ResolvedOrchestrationScheme,
  role: string | undefined,
): ResolvedOrchestrationMember | undefined {
  const key = role?.trim() || resolved.defaultRole;
  return resolved.members.find((member) => member.role === key);
}
