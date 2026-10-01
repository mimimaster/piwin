import type { ModelRef } from './host.js';
import { isThinkingLevel } from './host.js';
import { BUILTIN_SCHEMES } from './orchestration-scheme-builtin.js';
import {
  isValidOrchestrationRoleId,
  LEGACY_ULTRA_CODE_SCOUT_ROLE,
  normalizeLeadReviewLimit,
  OrchestrationSchemeError,
  ULTRA_CODE_SCHEME_ID,
  ULTRA_CODE_SCOUT_ROLE,
} from './orchestration-scheme-ids.js';
import type { ResolvedOrchestrationMember } from './orchestration-scheme-resolved.js';
import type {
  OrchestrationLeadReviewLimit,
  OrchestrationScheme,
  OrchestrationSchemeMember,
  OrchestrationSchemeSettings,
  ResolveOrchestrationSchemeOptions,
} from './orchestration-scheme-types.js';

/** Map legacy defaultProfileId → product role name when synthesizing members. */
const PROFILE_TO_DEFAULT_ROLE: Readonly<Record<string, string>> = {
  explorer: ULTRA_CODE_SCOUT_ROLE,
  implementer: 'coder',
  reviewer: 'reviewer',
  tester: 'tester',
};

const PROFILE_DEFAULT_DESCRIPTION: Readonly<Record<string, string>> = {
  explorer: 'Read-only codebase exploration, symbol discovery, and evidence gathering.',
  implementer: 'Isolated code implementation with write and run permissions in a git worktree.',
  reviewer: 'Read-only diff analysis, bug finding, and code review.',
  tester: 'Isolated test suite execution and test fixture generation in a git worktree.',
};

export function knownIdSet(
  known: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (!known) return undefined;
  return known instanceof Set ? known : new Set(known);
}

function modelKey(model: ModelRef): string {
  return `${model.providerId}::${model.modelId}`;
}

/**
 * Synthesize members from v1 defaultProfileId when members are missing/empty.
 */
export function migrateSchemeMembers(
  scheme: Pick<OrchestrationSchemeSettings, 'members' | 'defaultProfileId' | 'defaultRole' | 'id'>,
): OrchestrationSchemeMember[] {
  const existing = scheme.members?.filter(
    (member) =>
      typeof member.role === 'string' &&
      member.role.trim() &&
      typeof member.description === 'string' &&
      member.description.trim(),
  );
  if (existing && existing.length > 0) {
    const hasScout = existing.some((member) => member.role.trim() === ULTRA_CODE_SCOUT_ROLE);
    return existing.map((member) => ({
      role:
        scheme.id === ULTRA_CODE_SCHEME_ID &&
        member.role.trim() === LEGACY_ULTRA_CODE_SCOUT_ROLE &&
        !hasScout
          ? ULTRA_CODE_SCOUT_ROLE
          : member.role.trim(),
      description: member.description.trim(),
      ...(member.profileId?.trim() ? { profileId: member.profileId.trim() } : {}),
      ...(member.model ? { model: member.model } : {}),
      ...(member.thinkingLevel && isThinkingLevel(member.thinkingLevel)
        ? { thinkingLevel: member.thinkingLevel }
        : {}),
      ...(member.isolation === 'readonly' || member.isolation === 'worktree'
        ? { isolation: member.isolation }
        : {}),
      ...(member.fallback === 'none' || member.fallback === 'main'
        ? { fallback: member.fallback }
        : { fallback: 'main' as const }),
      ...(member.reportContract?.trim() ? { reportContract: member.reportContract.trim() } : {}),
      ...(member.inheritFrom?.schemeId?.trim() && member.inheritFrom.role?.trim()
        ? {
            inheritFrom: {
              schemeId: member.inheritFrom.schemeId.trim(),
              role: member.inheritFrom.role.trim(),
            },
          }
        : {}),
    }));
  }

  const profileId = scheme.defaultProfileId?.trim() || 'explorer';
  const role =
    scheme.defaultRole?.trim() ||
    PROFILE_TO_DEFAULT_ROLE[profileId] ||
    (isValidOrchestrationRoleId(profileId) ? profileId : ULTRA_CODE_SCOUT_ROLE);
  const description =
    PROFILE_DEFAULT_DESCRIPTION[profileId] ?? `Delegated work using profile "${profileId}".`;

  return [
    {
      role,
      description,
      profileId,
      fallback: 'main',
      ...(profileId === 'explorer' || profileId === 'reviewer'
        ? { isolation: 'readonly' as const }
        : profileId === 'implementer' || profileId === 'tester'
          ? { isolation: 'worktree' as const }
          : {}),
    },
  ];
}

export function resolveMembers(
  schemeId: string,
  rawMembers: OrchestrationSchemeMember[],
  options: ResolveOrchestrationSchemeOptions,
): ResolvedOrchestrationMember[] {
  const knownProfiles = knownIdSet(options.knownProfileIds);
  const knownModels = knownIdSet(options.knownModelKeys);
  const seenRoles = new Set<string>();
  const resolved: ResolvedOrchestrationMember[] = [];

  for (const member of rawMembers) {
    const role = member.role.trim();
    if (!isValidOrchestrationRoleId(role)) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" has invalid role "${role}"`,
      );
    }
    if (seenRoles.has(role)) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" has duplicate role "${role}"`,
      );
    }
    seenRoles.add(role);

    const description = member.description.trim();
    if (!description) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" role "${role}" has empty description`,
      );
    }

    const profileId = member.profileId?.trim();
    let available = true;
    let unavailableReason: string | undefined;

    if (profileId && knownProfiles && !knownProfiles.has(profileId)) {
      available = false;
      unavailableReason = `unknown profile "${profileId}"`;
    }

    if (member.model && knownModels) {
      const key = modelKey(member.model);
      if (!knownModels.has(key)) {
        available = false;
        unavailableReason = `unconfigured model ${member.model.providerId}/${member.model.modelId}`;
      }
    }

    const row: ResolvedOrchestrationMember = {
      role,
      description,
      fallback: member.fallback === 'none' ? 'none' : 'main',
      available,
    };
    if (profileId) row.profileId = profileId;
    if (member.model) row.model = member.model;
    if (member.thinkingLevel && isThinkingLevel(member.thinkingLevel)) {
      row.thinkingLevel = member.thinkingLevel;
    }
    if (member.isolation === 'readonly' || member.isolation === 'worktree') {
      row.isolation = member.isolation;
    }
    if (member.reportContract?.trim()) {
      row.reportContract = member.reportContract.trim();
    }
    if (member.inheritFrom) row.inheritedFrom = { ...member.inheritFrom };
    if (unavailableReason) row.unavailableReason = unavailableReason;
    resolved.push(row);
  }

  if (resolved.length === 0) {
    throw new OrchestrationSchemeError(
      'invalid-scheme',
      `orchestration scheme "${schemeId}" has no members after migration`,
    );
  }

  return resolved;
}

function findBuiltinMemberRecipe(
  schemeId: string,
  role: string,
): OrchestrationSchemeMember | undefined {
  const builtin = BUILTIN_SCHEMES.find((scheme) => scheme.id === schemeId);
  return builtin?.members?.find((member) => member.role === role);
}

/**
 * Overlay of a builtin replaces the whole scheme object. Recipe fields
 * (reportContract) still apply when the overlay member omitted them.
 * Behavior always comes from the builtin recipe, never from Settings.
 */
export function applyBuiltinMemberRecipe(
  schemeId: string,
  members: ResolvedOrchestrationMember[],
  leadReviewLimitOverride?: Partial<OrchestrationLeadReviewLimit>,
): ResolvedOrchestrationMember[] {
  return members.map((member) => {
    const recipe = findBuiltinMemberRecipe(schemeId, member.role);
    const { behavior: _settingsBehavior, ...rest } = member;
    void _settingsBehavior;
    const next: ResolvedOrchestrationMember = { ...rest };
    if (recipe?.behavior) {
      next.behavior = { ...recipe.behavior };
      if (recipe.behavior.leadReviewLimit) {
        next.behavior.leadReviewLimit = normalizeLeadReviewLimit(
          recipe.behavior.leadReviewLimit,
          leadReviewLimitOverride,
        );
      }
    }
    const contract = recipe?.reportContract?.trim();
    if (!next.reportContract?.trim() && contract) next.reportContract = contract;
    return next;
  });
}

/**
 * Expand `inheritFrom` members against the referenced scheme (after its
 * Settings overlay). A builtin overlay that dropped `inheritFrom` gets it back
 * from the builtin recipe unless the overlay pinned its own model.
 */
export function expandInheritedMembers(
  schemeId: string,
  members: OrchestrationSchemeMember[],
  schemes: readonly OrchestrationScheme[],
): OrchestrationSchemeMember[] {
  return members.map((member) => {
    const recipeRef = member.model
      ? undefined
      : findBuiltinMemberRecipe(schemeId, member.role)?.inheritFrom;
    const ref = member.inheritFrom ?? recipeRef;
    if (!ref) return member;
    if (ref.schemeId === schemeId) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" role "${member.role}" cannot inherit from its own scheme`,
      );
    }
    const target = schemes.find((scheme) => scheme.id === ref.schemeId);
    if (!target) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" role "${member.role}" inherits from unknown scheme "${ref.schemeId}"`,
      );
    }
    const base = migrateSchemeMembers(target).find((candidate) => candidate.role === ref.role);
    if (!base) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" role "${member.role}" inherits from unknown role "${ref.schemeId}/${ref.role}"`,
      );
    }
    if (base.inheritFrom) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${schemeId}" role "${member.role}" inherits from "${ref.schemeId}/${ref.role}", which itself inherits; only one level is allowed`,
      );
    }
    const baseContract =
      base.reportContract?.trim() ||
      findBuiltinMemberRecipe(ref.schemeId, ref.role)?.reportContract?.trim();
    const profileId = member.profileId ?? base.profileId;
    const model = member.model ?? base.model;
    const thinkingLevel = member.thinkingLevel ?? base.thinkingLevel;
    const isolation = member.isolation ?? base.isolation;
    const reportContract = member.reportContract?.trim() || baseContract;
    return {
      role: member.role,
      description: member.description,
      ...(profileId ? { profileId } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(isolation ? { isolation } : {}),
      fallback: member.fallback ?? base.fallback ?? 'main',
      ...(reportContract ? { reportContract } : {}),
      inheritFrom: { schemeId: ref.schemeId, role: ref.role },
    };
  });
}
