import type { OrchestrationLeadReviewLimit } from './orchestration-scheme-types.js';

/** Bounds Settings may set; the builtin default sits inside them. */
export const LEAD_REVIEW_LIMIT_BOUNDS = {
  maxFiles: { min: 1, max: 50 },
  maxChangedLines: { min: 10, max: 5000 },
} as const;

function clampWholeNumber(value: unknown, bounds: { min: number; max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/**
 * Merge a Settings override onto a base limit. A field that is missing or not
 * a finite number keeps the base value; the rest is rounded and clamped, so a
 * hand-edited config can neither disable the gate (0 / Infinity) nor make it
 * unreachable.
 */
export function normalizeLeadReviewLimit(
  base: OrchestrationLeadReviewLimit,
  override: Partial<OrchestrationLeadReviewLimit> | undefined,
): OrchestrationLeadReviewLimit {
  return {
    maxFiles: clampWholeNumber(override?.maxFiles, LEAD_REVIEW_LIMIT_BOUNDS.maxFiles) ?? base.maxFiles,
    maxChangedLines:
      clampWholeNumber(override?.maxChangedLines, LEAD_REVIEW_LIMIT_BOUNDS.maxChangedLines) ??
      base.maxChangedLines,
  };
}

export const ORCHESTRATION_SCHEME_OFF_ID = 'off' as const;

export const ULTRA_CODE_SCHEME_ID = 'ultra-code' as const;

/** Builtin Ultra Code scout role. Not researcher — that name is reserved for user research packs. */
export const ULTRA_CODE_SCOUT_ROLE = 'scout' as const;

/** Pre-rename Ultra Code role; aliased to scout only on scheme id ultra-code. */
export const LEGACY_ULTRA_CODE_SCOUT_ROLE = 'searcher';

/** Scheme ids are lowercase kebab tokens (builtins: ultra-code, reviewed-delivery, fusion, auto). */
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
