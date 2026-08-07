/**
 * ORCH: Orchestration Scheme contracts (per-send opt-in subagent orchestration).
 *
 * Spec: docs/specs/orchestration-scheme.md
 *
 * Schemes package main-agent spawn discipline + profile references + concurrency
 * ceilings. They never define providers/models. Off / omit means zero scheme work.
 */

import type { ThinkingLevel } from './host.js';
import { isThinkingLevel } from './host.js';
import type { SubagentProfileSettings } from './subagent-profile.js';

/** Wait policy for orchestration schemes. */
export type OrchestrationWaitPolicy = 'await-all' | 'fire-and-continue';

/**
 * Settings-backed orchestration scheme recipe.
 * Schemes reference SubagentProfile ids; they never define providers/models.
 */
export type OrchestrationSchemeSettings = {
  id: string;
  name: string;
  description: string;
  /**
   * Default profile for generic spawn and for calls that omit profileId.
   * Must resolve against builtin + settings profiles.
   */
  defaultProfileId: string;
  /**
   * Optional allowlist. When present, spawn may only use these profile ids.
   * When exposeSpawnMetadata is false, only defaultProfileId is used.
   */
  allowedProfileIds?: string[];
  /**
   * When false (Ultra Code default), soft/hard generic spawn: model-visible
   * profileId/model/thinkingLevel are ignored (and may be stripped from schema
   * in hard-generic mode). Host forces defaultProfileId.
   */
  exposeSpawnMetadata: boolean;
  /** Optional override; clamped by SubagentConfig.maxConcurrency. */
  maxConcurrency?: number;
  /** Optional override; clamped by SubagentConfig.maxTasksPerRun. */
  maxTasksPerRun?: number;
  waitPolicy: OrchestrationWaitPolicy;
  /**
   * Ceiling for subagent thinking. Host clamps profile/call thinking to this.
   * Does not affect the parent turn's thinkingLevel.
   */
  maxSubagentThinkingLevel?: ThinkingLevel;
  /**
   * Main-agent orchestration discipline. Injected only when this scheme is
   * selected for a prompt. Empty string is invalid for user schemes.
   */
  systemPreamble: string;
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

/** UI summaries without importing host. Full builtin recipes live in host-runtime. */
export const BUILTIN_ORCHESTRATION_SCHEME_SUMMARIES: readonly {
  id: string;
  name: string;
  description: string;
}[] = [
  {
    id: 'ultra-code',
    name: 'Ultra Code',
    description:
      'Read-only scout pack: low subagent thinking, generic spawn, wait-all; pin a cheap model on explorer for cost',
  },
] as const;

export const ORCHESTRATION_SCHEME_OFF_ID = 'off' as const;

export const ULTRA_CODE_SCHEME_ID = 'ultra-code' as const;

/** Stable error name for unknown / invalid scheme ids on prompt. */
export const ORCHESTRATION_SCHEME_ERROR_NAME = 'OrchestrationSchemeError';

export class OrchestrationSchemeError extends Error {
  readonly code: 'unknown-scheme' | 'invalid-scheme' | 'missing-profile';

  constructor(
    code: OrchestrationSchemeError['code'],
    message: string,
  ) {
    super(message);
    this.name = ORCHESTRATION_SCHEME_ERROR_NAME;
    this.code = code;
  }
}

export type ResolvedOrchestrationScheme = {
  schemeId: string;
  scheme: OrchestrationScheme;
  defaultProfileId: string;
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

export function isOrchestrationWaitPolicy(value: unknown): value is OrchestrationWaitPolicy {
  return value === 'await-all' || value === 'fire-and-continue';
}

/** Valid scheme id: lowercase alnum + hyphen (builtin ultra-code). */
export function isValidOrchestrationSchemeId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value !== ORCHESTRATION_SCHEME_OFF_ID;
}

/**
 * Builtin Ultra Code full recipe (also re-exported from host-runtime for merge).
 * Kept in contracts so resolve + tests stay pure without host imports.
 */
export const BUILTIN_ULTRA_CODE_SCHEME: OrchestrationScheme = {
  id: ULTRA_CODE_SCHEME_ID,
  name: 'Ultra Code',
  description:
    'Read-only scout pack: low subagent thinking, generic spawn, wait-all; pin a cheap model on explorer for cost',
  source: 'builtin',
  defaultProfileId: 'explorer',
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  maxSubagentThinkingLevel: 'low',
  systemPreamble: [
    'Orchestration scheme Ultra Code is active for this turn.',
    'You may proactively spawn read-only subagents when work splits into independent investigation workflows and parallel scouts clearly improve speed or quality.',
    'Subagents are scouts only: gather facts, paths, and citations; return dense evidence reports.',
    'Do not ask subagents to make final product decisions or large design calls; you synthesize and verify.',
    'After a parallel wave of spawns, wait for all results before continuing analysis, search, commands, or edits.',
    'Do not re-do the same broad search the scouts were assigned; use their reports.',
    'Prefer the default scout profile; do not try to pick exotic models or high thinking for subagents.',
  ].join(' '),
};

const BUILTIN_SCHEMES: readonly OrchestrationScheme[] = [BUILTIN_ULTRA_CODE_SCHEME];

/**
 * Merge builtin schemes with Settings schemes. Settings with the same id
 * override builtin fields (except source becomes settings). Settings-only
 * schemes append after builtins.
 */
export function listOrchestrationSchemes(
  config: OrchestrationSchemeConfigSlice,
): OrchestrationScheme[] {
  const settingsSchemes = config.schemes ?? [];
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
  /**
   * Known profile ids (builtin + settings). When omitted, only checks that
   * defaultProfileId is a non-empty string (Host should pass full set).
   */
  knownProfileIds?: ReadonlySet<string> | readonly string[] | undefined;
  /** Global concurrency ceiling from SubagentConfig. */
  globalMaxConcurrency?: number | undefined;
  /** Global tasks-per-run ceiling from SubagentConfig. */
  globalMaxTasksPerRun?: number | undefined;
};

function knownProfileIdSet(
  known: ResolveOrchestrationSchemeOptions['knownProfileIds'],
): ReadonlySet<string> | undefined {
  if (!known) return undefined;
  return known instanceof Set ? known : new Set(known);
}

/**
 * Resolve a per-send scheme id.
 *
 * - omit / empty / `off` → `undefined` (caller skips all scheme work)
 * - unknown id → throws OrchestrationSchemeError (never silent Off)
 * - missing default profile → throws
 */
export function resolveOrchestrationScheme(
  config: OrchestrationSchemeConfigSlice,
  schemeId: string | undefined,
  options: ResolveOrchestrationSchemeOptions = {},
): ResolvedOrchestrationScheme | undefined {
  if (schemeId === undefined) return undefined;
  const trimmed = schemeId.trim();
  if (!trimmed || trimmed === ORCHESTRATION_SCHEME_OFF_ID) return undefined;

  const schemes = listOrchestrationSchemes(config);
  const scheme = schemes.find((item) => item.id === trimmed);
  if (!scheme) {
    throw new OrchestrationSchemeError(
      'unknown-scheme',
      `unknown orchestration scheme "${trimmed}"`,
    );
  }

  const defaultProfileId = scheme.defaultProfileId.trim();
  if (!defaultProfileId) {
    throw new OrchestrationSchemeError(
      'invalid-scheme',
      `orchestration scheme "${trimmed}" has empty defaultProfileId`,
    );
  }

  const known = knownProfileIdSet(options.knownProfileIds);
  if (known && !known.has(defaultProfileId)) {
    throw new OrchestrationSchemeError(
      'missing-profile',
      `orchestration scheme "${trimmed}" references unknown profile "${defaultProfileId}"`,
    );
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
    if (
      scheme.allowedProfileIds.length > 0 &&
      !scheme.allowedProfileIds.includes(defaultProfileId)
    ) {
      throw new OrchestrationSchemeError(
        'invalid-scheme',
        `orchestration scheme "${trimmed}" defaultProfileId is not in allowedProfileIds`,
      );
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

  const resolved: ResolvedOrchestrationScheme = {
    schemeId: scheme.id,
    scheme,
    defaultProfileId,
    exposeSpawnMetadata: scheme.exposeSpawnMetadata,
    maxConcurrency: Math.max(1, Math.min(schemeConcurrency, globalMaxConcurrency)),
    maxTasksPerRun: Math.max(1, Math.min(schemeTasks, globalMaxTasksPerRun)),
    waitPolicy: scheme.waitPolicy === 'fire-and-continue' ? 'await-all' : 'await-all',
    systemPreamble: preamble,
  };
  if (scheme.maxSubagentThinkingLevel && isThinkingLevel(scheme.maxSubagentThinkingLevel)) {
    resolved.maxSubagentThinkingLevel = scheme.maxSubagentThinkingLevel;
  }
  return resolved;
}

/** Format model-facing scheme preamble block (preparePrompt injects this). */
export function formatOrchestrationSchemePreamble(resolved: ResolvedOrchestrationScheme): string {
  return `[piwin-scheme:${resolved.schemeId}]\n${resolved.systemPreamble}`;
}

/** Inject scheme preamble ahead of model-facing user text. */
export function mergeOrchestrationSchemeIntoPrompt(
  resolved: ResolvedOrchestrationScheme,
  userFacingText: string,
): string {
  const block = formatOrchestrationSchemePreamble(resolved);
  const body = userFacingText.trim();
  if (!body) return `${block}\n\n---\n`;
  return `${block}\n\n---\n${body}`;
}

/** Soft-generic: force profile / strip model overrides when exposeSpawnMetadata is false. */
export function applySchemeToSubagentSpawnInput(
  resolved: ResolvedOrchestrationScheme | undefined,
  input: {
    profileId?: string;
    model?: unknown;
    thinkingLevel?: ThinkingLevel;
  },
): {
  profileId?: string;
  model?: undefined;
  thinkingLevel?: ThinkingLevel;
  clearedModel: boolean;
  forcedProfile: boolean;
} {
  if (!resolved) {
    return {
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      clearedModel: false,
      forcedProfile: false,
    };
  }

  if (!resolved.exposeSpawnMetadata) {
    const thinkingLevel = clampThinkingLevelToMax(
      input.thinkingLevel,
      resolved.maxSubagentThinkingLevel,
    );
    return {
      profileId: resolved.defaultProfileId,
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      clearedModel: input.model !== undefined,
      forcedProfile: true,
    };
  }

  let profileId = input.profileId?.trim() || resolved.defaultProfileId;
  const allowedProfileIds = resolved.scheme.allowedProfileIds;
  if (allowedProfileIds && allowedProfileIds.length > 0) {
    if (!allowedProfileIds.includes(profileId)) {
      profileId = resolved.defaultProfileId;
    }
  }
  const thinkingLevel = clampThinkingLevelToMax(
    input.thinkingLevel,
    resolved.maxSubagentThinkingLevel,
  );
  return {
    profileId,
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    clearedModel: false,
    forcedProfile: !input.profileId || input.profileId !== profileId,
  };
}

/** Helper for tests / UI: known builtin profile ids from summaries alone are incomplete; Host passes full set. */
export function collectSettingsProfileIds(
  profiles: readonly SubagentProfileSettings[],
): string[] {
  return profiles.map((profile) => profile.id);
}

