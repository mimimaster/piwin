/**
 * ORCH: Orchestration Scheme contracts (per-send opt-in subagent orchestration).
 *
 * Spec: docs/specs/orchestration-scheme.md (v1 shell)
 * Enhancement: docs/specs/orchestration-scheme-v2-enhancement.md (members / role)
 *
 * Barrel only. Implementation is split by responsibility beside this file.
 * ids/builtin/members are forwarded by name: they also export helpers shared
 * between sibling files (`LEGACY_ULTRA_CODE_SCOUT_ROLE`, `BUILTIN_SCHEMES`,
 * `resolveMembers`, ...) that were module-private and never public.
 */

export type * from './orchestration-scheme-types.js';
export {
  LEAD_REVIEW_LIMIT_BOUNDS,
  ORCHESTRATION_ROLE_ID_PATTERN,
  ORCHESTRATION_SCHEME_ERROR_NAME,
  ORCHESTRATION_SCHEME_ID_PATTERN,
  ORCHESTRATION_SCHEME_OFF_ID,
  OrchestrationSchemeError,
  ULTRA_CODE_SCHEME_ID,
  ULTRA_CODE_SCOUT_ROLE,
  isValidOrchestrationRoleId,
  isValidOrchestrationSchemeId,
  normalizeLeadReviewLimit,
} from './orchestration-scheme-ids.js';
export * from './orchestration-scheme-resolved.js';
export {
  BUILTIN_ULTRA_CODE_SCHEME,
  DEFAULT_ORCHESTRATION_ROLE_TEMPLATES,
  canonicalizeOrchestrationRole,
  canonicalizeUltraCodeSchemeSettings,
  listOrchestrationSchemes,
} from './orchestration-scheme-builtin.js';
export { migrateSchemeMembers } from './orchestration-scheme-members.js';
export * from './orchestration-scheme-resolve.js';
export * from './orchestration-scheme-prompt.js';
export * from './orchestration-scheme-spawn.js';
export * from './orchestration-scheme-reviewed-delivery.js';
export * from './orchestration-scheme-fusion.js';
export * from './orchestration-scheme-auto.js';
