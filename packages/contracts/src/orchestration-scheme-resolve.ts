import { isThinkingLevel } from './host.js';
import { listOrchestrationSchemes } from './orchestration-scheme-builtin.js';
import {
  isValidOrchestrationSchemeId,
  ORCHESTRATION_SCHEME_OFF_ID,
  OrchestrationSchemeError,
} from './orchestration-scheme-ids.js';
import {
  applyBuiltinMemberRecipe,
  expandInheritedMembers,
  knownIdSet,
  migrateSchemeMembers,
  resolveMembers,
} from './orchestration-scheme-members.js';
import type { ResolvedOrchestrationScheme } from './orchestration-scheme-resolved.js';
import type {
  OrchestrationScheme,
  OrchestrationSchemeConfigSlice,
  ResolveOrchestrationSchemeOptions,
} from './orchestration-scheme-types.js';

/**
 * Scheme id for a new conversation's composer.
 * Unknown, deleted, and Off ids resolve to {@link ORCHESTRATION_SCHEME_OFF_ID}.
 * Builtins count even when Settings has no overlay for them.
 */
export function resolveNewSessionOrchestrationSchemeId(
  config: (OrchestrationSchemeConfigSlice & { defaultSchemeId?: string | undefined }) | undefined,
): string {
  const raw = config?.defaultSchemeId?.trim() ?? '';
  if (!raw || !isValidOrchestrationSchemeId(raw)) return ORCHESTRATION_SCHEME_OFF_ID;
  const known = listOrchestrationSchemes(config ?? {}).some((scheme) => scheme.id === raw);
  return known ? raw : ORCHESTRATION_SCHEME_OFF_ID;
}

/**
 * Resolve a per-send scheme id.
 *
 * - omit / empty / `off` → `undefined` (caller skips all scheme work)
 * - unknown id → throws OrchestrationSchemeError (never silent Off)
 * - migrates v1 schemes without members
 */
export function resolveOrchestrationScheme(
  config: OrchestrationSchemeConfigSlice,
  schemeId: string | undefined,
  options: ResolveOrchestrationSchemeOptions = {},
): ResolvedOrchestrationScheme | undefined {
  if (schemeId === undefined) return undefined;
  const trimmed = schemeId.trim();
  if (!trimmed || trimmed === ORCHESTRATION_SCHEME_OFF_ID) return undefined;

  if (!isValidOrchestrationSchemeId(trimmed)) {
    throw new OrchestrationSchemeError(
      'invalid-scheme',
      `invalid orchestration scheme id "${trimmed}" (expected [a-z0-9-]+)`,
    );
  }

  const schemes = listOrchestrationSchemes(config);
  const scheme = schemes.find((item) => item.id === trimmed);
  if (!scheme) {
    throw new OrchestrationSchemeError(
      'unknown-scheme',
      `unknown orchestration scheme "${trimmed}"`,
    );
  }

  const migratedMembers = expandInheritedMembers(trimmed, migrateSchemeMembers(scheme), schemes);
  const members = applyBuiltinMemberRecipe(
    trimmed,
    resolveMembers(trimmed, migratedMembers, options),
    config.leadReviewLimit,
  );

  const defaultRoleRaw = scheme.defaultRole?.trim();
  const defaultRole =
    defaultRoleRaw && members.some((member) => member.role === defaultRoleRaw)
      ? defaultRoleRaw
      : members[0]!.role;

  const defaultMember = members.find((member) => member.role === defaultRole) ?? members[0]!;
  const defaultProfileId =
    defaultMember.profileId?.trim() || scheme.defaultProfileId?.trim() || 'explorer';

  const known = knownIdSet(options.knownProfileIds);
  if (known && defaultMember.profileId && !known.has(defaultMember.profileId)) {
    // Member already marked unavailable; scheme can still resolve for injection.
  } else if (known && scheme.defaultProfileId?.trim() && !scheme.members?.length) {
    const legacyProfile = scheme.defaultProfileId.trim();
    if (!known.has(legacyProfile)) {
      throw new OrchestrationSchemeError(
        'missing-profile',
        `orchestration scheme "${trimmed}" references unknown profile "${legacyProfile}"`,
      );
    }
  }

  if (scheme.allowedProfileIds) {
    for (const allowedId of scheme.allowedProfileIds) {
      if (known && !known.has(allowedId)) {
        throw new OrchestrationSchemeError(
          'missing-profile',
          `orchestration scheme "${trimmed}" allowlist references unknown profile "${allowedId}"`,
        );
      }
    }
  }

  const globalMaxConcurrency = options.globalMaxConcurrency ?? config.maxConcurrency ?? 4;
  const globalMaxTasksPerRun = options.globalMaxTasksPerRun ?? config.maxTasksPerRun ?? 8;
  const schemeConcurrency = scheme.maxConcurrency ?? globalMaxConcurrency;
  const schemeTasks = scheme.maxTasksPerRun ?? globalMaxTasksPerRun;

  const preamble = scheme.systemPreamble.trim();
  if (!preamble) {
    throw new OrchestrationSchemeError(
      'invalid-scheme',
      `orchestration scheme "${trimmed}" has empty systemPreamble`,
    );
  }

  // Attach migrated members onto scheme view for consumers that read scheme.members.
  const schemeWithMembers: OrchestrationScheme = {
    ...scheme,
    members: migratedMembers,
    defaultRole,
    defaultProfileId,
  };

  const resolved: ResolvedOrchestrationScheme = {
    schemeId: scheme.id,
    scheme: schemeWithMembers,
    defaultProfileId,
    defaultRole,
    members,
    exposeSpawnMetadata: scheme.exposeSpawnMetadata,
    maxConcurrency: Math.max(1, Math.min(schemeConcurrency, globalMaxConcurrency)),
    maxTasksPerRun: Math.max(1, Math.min(schemeTasks, globalMaxTasksPerRun)),
    // waitPolicy stays `await-all` for structured in-turn concurrency (start + wait), not fire-and-forget.
    waitPolicy: 'await-all',
    systemPreamble: preamble,
  };
  if (scheme.maxSubagentThinkingLevel && isThinkingLevel(scheme.maxSubagentThinkingLevel)) {
    resolved.maxSubagentThinkingLevel = scheme.maxSubagentThinkingLevel;
  }
  return resolved;
}
