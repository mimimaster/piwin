/**
 * ORCH: Orchestration Scheme contracts (per-send opt-in subagent orchestration).
 *
 * Spec: docs/specs/orchestration-scheme.md (v1 shell)
 * Enhancement: docs/specs/orchestration-scheme-v2-enhancement.md (members / role)
 *
 * Schemes package main-agent spawn discipline + role roster + concurrency
 * ceilings. They never define providers. Off / omit means zero scheme work.
 */

import type { ModelRef, ThinkingLevel } from './host.js';
import { isThinkingLevel } from './host.js';
import type { SubagentIsolationMode } from './subagent.js';

/** Wait policy for orchestration schemes. */
export type OrchestrationWaitPolicy = 'await-all' | 'fire-and-continue';

/** Spawn-before unavailability handling for a scheme member. */
export type OrchestrationMemberFallback = 'main' | 'none';

/**
 * One callable role inside a scheme (main agent points at `role`).
 * description is required so the main agent knows when to delegate (Claude-style).
 */
export type OrchestrationSchemeMember = {
  /** Main-agent call name, unique within the scheme (e.g. scout). */
  role: string;
  /** When to use this role — injected into the scheme roster. */
  description: string;
  /** Optional global SubagentProfile template id. */
  profileId?: string;
  /** Pinned model; omit inherits profile then parent session model. */
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  /** Default `main`: tell parent to do the work itself when spawn is impossible. */
  fallback?: OrchestrationMemberFallback;
  /**
   * Scout return format injected into the child's first user message.
   * Empty/omit = no contract block. Ultra Code scout has a builtin default.
   */
  reportContract?: string;
};

/**
 * Settings-backed orchestration scheme recipe.
 * v2: members[] is the roster; defaultProfileId remains for v1 migration.
 */
export type OrchestrationSchemeSettings = {
  id: string;
  name: string;
  description: string;
  /**
   * Main-agent discipline (AGENTS.md analogue). Injected only when selected.
   */
  systemPreamble: string;
  /**
   * Scheme roster. Empty/missing is migrated from defaultProfileId at resolve.
   */
  members?: OrchestrationSchemeMember[];
  /**
   * Default role when spawn omits role (or soft-generic). Must exist in members
   * after migration.
   */
  defaultRole?: string;
  /**
   * v1 compatibility: default profile when members are absent.
   * Prefer defaultRole + members in new UI.
   */
  defaultProfileId?: string;
  /**
   * Optional allowlist of profile ids (v1). Prefer members for allow-set.
   */
  allowedProfileIds?: string[];
  /**
   * When false, hide model/thinking from free-form spawn; Host uses role/member.
   * Role remains the product call name.
   */
  exposeSpawnMetadata: boolean;
  maxConcurrency?: number;
  maxTasksPerRun?: number;
  waitPolicy: OrchestrationWaitPolicy;
  maxSubagentThinkingLevel?: ThinkingLevel;
};

export type OrchestrationScheme = OrchestrationSchemeSettings & {
  source: 'builtin' | 'settings';
};

/**
 * Minimal config slice for scheme resolve (avoids contracts circular import
 * with full PiwinConfig).
 */
export type OrchestrationSchemeConfigSlice = {
  schemes?: OrchestrationSchemeSettings[] | undefined;
  maxConcurrency?: number | undefined;
  maxTasksPerRun?: number | undefined;
};

export const ORCHESTRATION_SCHEME_OFF_ID = 'off' as const;

export const ULTRA_CODE_SCHEME_ID = 'ultra-code' as const;

/** Builtin Ultra Code scout role. Not researcher — that name is reserved for user research packs. */
export const ULTRA_CODE_SCOUT_ROLE = 'scout' as const;

/** Pre-rename Ultra Code role; aliased to scout only on scheme id ultra-code. */
const LEGACY_ULTRA_CODE_SCOUT_ROLE = 'searcher';

/** Scheme ids are lowercase kebab tokens (builtins: ultra-code). */
export const ORCHESTRATION_SCHEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Role ids: start with a letter; lowercase alnum, hyphen, underscore. */
export const ORCHESTRATION_ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** True when id matches the scheme id character set (excludes `off`). */
export function isValidOrchestrationSchemeId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === ORCHESTRATION_SCHEME_OFF_ID) return false;
  return ORCHESTRATION_SCHEME_ID_PATTERN.test(trimmed);
}

/** True when role is a valid member role token. */
export function isValidOrchestrationRoleId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return ORCHESTRATION_ROLE_ID_PATTERN.test(trimmed);
}

/** Stable error name for unknown / invalid scheme ids on prompt. */
export const ORCHESTRATION_SCHEME_ERROR_NAME = 'OrchestrationSchemeError';

export class OrchestrationSchemeError extends Error {
  readonly code: 'unknown-scheme' | 'invalid-scheme' | 'missing-profile' | 'unknown-role';

  constructor(
    code: OrchestrationSchemeError['code'],
    message: string,
  ) {
    super(message);
    this.name = ORCHESTRATION_SCHEME_ERROR_NAME;
    this.code = code;
  }
}

/** Resolved roster row after migrate + validation. */
export type ResolvedOrchestrationMember = {
  role: string;
  description: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  fallback: OrchestrationMemberFallback;
  available: boolean;
  unavailableReason?: string;
  reportContract?: string;
};

export type ResolvedOrchestrationScheme = {
  schemeId: string;
  scheme: OrchestrationScheme;
  /** Effective default profile (from default member profileId or v1 field). */
  defaultProfileId: string;
  /** Effective default role for soft-generic / omitted role. */
  defaultRole: string;
  members: ResolvedOrchestrationMember[];
  exposeSpawnMetadata: boolean;
  maxConcurrency: number;
  maxTasksPerRun: number;
  waitPolicy: OrchestrationWaitPolicy;
  maxSubagentThinkingLevel?: ThinkingLevel;
  systemPreamble: string;
};

const THINKING_RANK: Readonly<Record<ThinkingLevel, number>> = {
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
  ultra: 7,
};

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

/** Compare thinking levels for clamp (lower rank = less effort). */
export function compareThinkingLevel(left: ThinkingLevel, right: ThinkingLevel): number {
  return THINKING_RANK[left] - THINKING_RANK[right];
}

/** Clamp a thinking level so it does not exceed a scheme ceiling. */
export function clampThinkingLevelToMax(
  value: ThinkingLevel | undefined,
  maximum: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  if (value === undefined) {
    return maximum;
  }
  if (maximum === undefined) {
    return value;
  }
  return compareThinkingLevel(value, maximum) <= 0 ? value : maximum;
}

const ULTRA_CODE_SCOUT_DESCRIPTION =
  'Read-only scout for wide/heavy reads to prevent main context rot: locating symbols, tracing call/type/import relationships, cross-file search, huge files, and parallel investigations. Returns a dense evidence report with file:line citations; never edits files or makes architectural decisions.';

/**
 * Main-agent discipline (Codex AGENTS.md analogue). Injected only when Ultra
 * Code is selected for the turn. Covers when to spawn, when not to, wait, and
 * how to verify compressed scout reports.
 */
const ULTRA_CODE_PREAMBLE = `<orchestration_discipline scheme="ultra-code">
You are the composer agent: orchestrate, synthesize, and decide. Prevent context rot in this thread by delegating wide reads.

## Delegation Policy
- **Delegate (via \`piwin_subagent_run\` role="scout")**: Broad symbol discovery, cross-file call/import tracing, large files/logs, or independent parallel investigations. Prefer multiple small, parallel scouts fired in one turn.
- **Do NOT Delegate**: Known small files, foundational docs, or the exact file you are about to edit. Read these directly.

## Execution & Verification
1. **Self-Contained Tasks**: Provide precise scope, target question, and required evidence format in the delegated task text.
2. **Verify via Citations**: Treat scout findings as compressed clues. Spot-check by sampling cited \`file:line\` locations—do NOT re-read the raw search dumps.
3. **Scout Boundary**: Scouts are strictly read-only and cannot edit, decide architecture, or spawn child agents.
</orchestration_discipline>`;

/** Child seed contract (Codex agents/default.toml analogue). */
export const ULTRA_CODE_SCOUT_REPORT_CONTRACT = `<scout_contract>
You are a one-shot read-only scout. Explore and gather verifiable evidence for the parent agent.

## Constraints
- Read-only: Never edit files, execute mutating commands, or spawn child agents.
- Zero chatter: No conversational preamble, reasoning recap, or whole-file dumping.

## Output Format
Line 1: exactly one of complete | partial | blocked
Body:
- Key findings with exact \`file:line\` citations, symbol signatures, and verbatim quotes.
- Distinguish verified facts from inferences. For negative results, state queried paths/terms.
- If partial/blocked, state explicitly what was covered and the blocker encountered.
</scout_contract>`;

export const PIWIN_REPORT_CONTRACT_MARKER = '[piwin-report-contract]';

/** Wrap a member report contract for the child's first user message. */
export function formatSubagentReportContractBlock(contract: string | undefined): string | undefined {
  const trimmed = contract?.trim();
  if (!trimmed) return undefined;
  return `${PIWIN_REPORT_CONTRACT_MARKER}\n${trimmed}\nYour last assistant message must follow this contract. The parent only reads that message.`;
}

/** True when an assistant message follows the scout report-contract first line. */
export function isSubagentReportContractMessage(text: string): boolean {
  return /^(complete|partial|blocked)\b/i.test(text.trim());
}

/**
 * Builtin Ultra Code: article-aligned scout pack (single scout template +
 * wait discipline + soft generic). Users may overlay-edit via settings.
 */
export const BUILTIN_ULTRA_CODE_SCHEME: OrchestrationScheme = {
  id: ULTRA_CODE_SCHEME_ID,
  name: 'Ultra Code',
  description:
    'Built-in scout pack for high-effort main agents: cheap readonly scout, low thinking, wait-for-scouts discipline',
  source: 'builtin',
  defaultRole: ULTRA_CODE_SCOUT_ROLE,
  defaultProfileId: 'explorer',
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  maxSubagentThinkingLevel: 'low',
  members: [
    {
      role: ULTRA_CODE_SCOUT_ROLE,
      description: ULTRA_CODE_SCOUT_DESCRIPTION,
      profileId: 'explorer',
      thinkingLevel: 'low',
      isolation: 'readonly',
      fallback: 'main',
      reportContract: ULTRA_CODE_SCOUT_REPORT_CONTRACT,
    },
  ],
  systemPreamble: ULTRA_CODE_PREAMBLE,
};

const BUILTIN_SCHEMES: readonly OrchestrationScheme[] = [BUILTIN_ULTRA_CODE_SCHEME];

/**
 * Default role seeds for new user schemes (Settings "add role" templates).
 * Not auto-inserted into every scheme — UI may offer these as starters.
 */
export const DEFAULT_ORCHESTRATION_ROLE_TEMPLATES: readonly OrchestrationSchemeMember[] = [
  {
    role: ULTRA_CODE_SCOUT_ROLE,
    description: ULTRA_CODE_SCOUT_DESCRIPTION,
    profileId: 'explorer',
    isolation: 'readonly',
    thinkingLevel: 'low',
    fallback: 'main',
    reportContract: ULTRA_CODE_SCOUT_REPORT_CONTRACT,
  },
  {
    role: 'coder',
    description:
      'Implement changes in an isolated worktree. Return what changed and how to verify; do not own final product decisions.',
    profileId: 'implementer',
    isolation: 'worktree',
    fallback: 'main',
  },
  {
    role: 'reviewer',
    description:
      'Read-only review for correctness, security, and missing tests. Lead with concrete findings.',
    profileId: 'reviewer',
    isolation: 'readonly',
    fallback: 'main',
  },
  {
    role: 'tester',
    description:
      'Run tests and reproduce failures in isolation. Report failing commands and likely causes.',
    profileId: 'tester',
    isolation: 'worktree',
    fallback: 'main',
  },
] as const;

/**
 * Map the retired Ultra Code role `searcher` onto `scout`. Custom schemes may
 * still use `searcher` as their own role id.
 */
export function canonicalizeOrchestrationRole(schemeId: string, role: string): string {
  if (schemeId === ULTRA_CODE_SCHEME_ID && role === LEGACY_ULTRA_CODE_SCOUT_ROLE) {
    return ULTRA_CODE_SCOUT_ROLE;
  }
  return role;
}

/**
 * Rewrite an ultra-code overlay that still stores `searcher` so Settings and
 * resolve see `scout`. Leaves `searcher` in place only if the overlay already
 * has a `scout` member (user added both).
 */
export function canonicalizeUltraCodeSchemeSettings<T extends OrchestrationSchemeSettings>(
  scheme: T,
): T {
  if (scheme.id !== ULTRA_CODE_SCHEME_ID) return scheme;
  const members = scheme.members;
  if (members && members.length > 0) {
    const hasScout = members.some((member) => member.role.trim() === ULTRA_CODE_SCOUT_ROLE);
    const nextMembers = members.map((member) => {
      const role = member.role.trim();
      if (role === LEGACY_ULTRA_CODE_SCOUT_ROLE && !hasScout) {
        return { ...member, role: ULTRA_CODE_SCOUT_ROLE };
      }
      return member;
    });
    const defaultRoleRaw = scheme.defaultRole?.trim();
    const defaultRole =
      defaultRoleRaw === LEGACY_ULTRA_CODE_SCOUT_ROLE &&
      nextMembers.some((member) => member.role === ULTRA_CODE_SCOUT_ROLE)
        ? ULTRA_CODE_SCOUT_ROLE
        : defaultRoleRaw;
    return {
      ...scheme,
      members: nextMembers,
      ...(defaultRole ? { defaultRole } : {}),
    };
  }
  if (scheme.defaultRole?.trim() === LEGACY_ULTRA_CODE_SCOUT_ROLE) {
    return { ...scheme, defaultRole: ULTRA_CODE_SCOUT_ROLE };
  }
  return scheme;
}

/**
 * Merge builtin schemes with Settings schemes. Settings with the same id
 * override builtin fields (source becomes settings). Settings-only schemes
 * append after builtins.
 */
export function listOrchestrationSchemes(
  config: OrchestrationSchemeConfigSlice,
): OrchestrationScheme[] {
  const settingsSchemes = (config.schemes ?? []).map((scheme) =>
    canonicalizeUltraCodeSchemeSettings(scheme),
  );
  const byId = new Map<string, OrchestrationScheme>();
  for (const builtin of BUILTIN_SCHEMES) {
    byId.set(builtin.id, { ...builtin, source: 'builtin' });
  }
  for (const settingsScheme of settingsSchemes) {
    byId.set(settingsScheme.id, { ...settingsScheme, source: 'settings' });
  }
  const ordered: OrchestrationScheme[] = [];
  const builtinIds = new Set(BUILTIN_SCHEMES.map((scheme) => scheme.id));
  for (const builtin of BUILTIN_SCHEMES) {
    const resolved = byId.get(builtin.id);
    if (resolved) ordered.push(resolved);
  }
  for (const settingsScheme of settingsSchemes) {
    if (!builtinIds.has(settingsScheme.id)) {
      const resolved = byId.get(settingsScheme.id);
      if (resolved) ordered.push(resolved);
    }
  }
  return ordered;
}

export type ResolveOrchestrationSchemeOptions = {
  knownProfileIds?: ReadonlySet<string> | readonly string[] | undefined;
  globalMaxConcurrency?: number | undefined;
  globalMaxTasksPerRun?: number | undefined;
  /**
   * Optional set of "providerId::modelId" keys known to be configured.
   * When set, member.model not in the set marks the member unavailable.
   */
  knownModelKeys?: ReadonlySet<string> | readonly string[] | undefined;
};

function knownIdSet(
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
  scheme: Pick<
    OrchestrationSchemeSettings,
    'members' | 'defaultProfileId' | 'defaultRole' | 'id'
  >,
): OrchestrationSchemeMember[] {
  const existing = scheme.members?.filter(
    (member) =>
      typeof member.role === 'string' &&
      member.role.trim() &&
      typeof member.description === 'string' &&
      member.description.trim(),
  );
  if (existing && existing.length > 0) {
    const hasScout = existing.some(
      (member) => member.role.trim() === ULTRA_CODE_SCOUT_ROLE,
    );
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
      ...(member.reportContract?.trim()
        ? { reportContract: member.reportContract.trim() }
        : {}),
    }));
  }

  const profileId = scheme.defaultProfileId?.trim() || 'explorer';
  const role =
    scheme.defaultRole?.trim() ||
    PROFILE_TO_DEFAULT_ROLE[profileId] ||
    (isValidOrchestrationRoleId(profileId) ? profileId : ULTRA_CODE_SCOUT_ROLE);
  const description =
    PROFILE_DEFAULT_DESCRIPTION[profileId] ??
    `Delegated work using profile "${profileId}".`;

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

function resolveMembers(
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

/**
 * Overlay of ultra-code replaces the whole scheme object. New recipe fields
 * (reportContract) still apply when the overlay member omitted them.
 */
function applyUltraCodeMemberRecipe(
  schemeId: string,
  members: ResolvedOrchestrationMember[],
): ResolvedOrchestrationMember[] {
  if (schemeId !== ULTRA_CODE_SCHEME_ID) return members;
  const recipes = new Map(
    (BUILTIN_ULTRA_CODE_SCHEME.members ?? []).map((member) => [member.role, member]),
  );
  return members.map((member) => {
    if (member.reportContract?.trim()) return member;
    const recipe = recipes.get(member.role);
    const contract = recipe?.reportContract?.trim();
    if (!contract) return member;
    return { ...member, reportContract: contract };
  });
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

  const migratedMembers = migrateSchemeMembers(scheme);
  const members = applyUltraCodeMemberRecipe(
    trimmed,
    resolveMembers(trimmed, migratedMembers, options),
  );

  const defaultRoleRaw = scheme.defaultRole?.trim();
  const defaultRole =
    defaultRoleRaw && members.some((member) => member.role === defaultRoleRaw)
      ? defaultRoleRaw
      : members[0]!.role;

  const defaultMember = members.find((member) => member.role === defaultRole) ?? members[0]!;
  const defaultProfileId =
    defaultMember.profileId?.trim() ||
    scheme.defaultProfileId?.trim() ||
    'explorer';

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
    // MVP: piwin_subagent_run is synchronous (spawn+merge).
    waitPolicy: 'await-all',
    systemPreamble: preamble,
  };
  if (scheme.maxSubagentThinkingLevel && isThinkingLevel(scheme.maxSubagentThinkingLevel)) {
    resolved.maxSubagentThinkingLevel = scheme.maxSubagentThinkingLevel;
  }
  return resolved;
}

/** Format roster block for model-facing injection. */
export function formatOrchestrationSchemeRoster(resolved: ResolvedOrchestrationScheme): string {
  const lines = resolved.members.map((member) => {
    const bits: string[] = [];
    if (member.model) {
      bits.push(`model: ${member.model.providerId}/${member.model.modelId}`);
    } else {
      bits.push('model: inherit');
    }
    if (member.isolation) bits.push(member.isolation);
    if (member.thinkingLevel) bits.push(`thinking≤${member.thinkingLevel}`);
    else if (resolved.maxSubagentThinkingLevel) {
      bits.push(`thinking≤${resolved.maxSubagentThinkingLevel}`);
    }
    if (!member.available) {
      bits.push(`UNAVAILABLE: ${member.unavailableReason ?? 'unknown'}`);
    }
    return `- ${member.role}: ${member.description} (${bits.join('; ')})`;
  });
  return [
    '[piwin-scheme-roster]',
    ...lines,
    'When delegating, call piwin_subagent_run with role set to one of the roster roles.',
  ].join('\n');
}

/** Format model-facing scheme preamble block (preparePrompt injects this). */
export function formatOrchestrationSchemePreamble(resolved: ResolvedOrchestrationScheme): string {
  return `[piwin-scheme:${resolved.schemeId}]\n${resolved.systemPreamble}\n\n${formatOrchestrationSchemeRoster(resolved)}`;
}

/** Inject scheme preamble + roster ahead of model-facing user text. */
export function mergeOrchestrationSchemeIntoPrompt(
  resolved: ResolvedOrchestrationScheme,
  userFacingText: string,
): string {
  const block = formatOrchestrationSchemePreamble(resolved);
  const body = userFacingText.trim();
  if (!body) return `${block}\n\n---\n`;
  return `${block}\n\n---\n${body}`;
}

export type SchemeSpawnApplication = {
  role?: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  reportContract?: string;
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
