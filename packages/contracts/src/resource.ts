/** Canonical resource identity + catalog contracts (spec §8.3–8.5). */

import type { SkillSource } from './skills.js';

/**
 * Resource families that can be injected into a Pi session. Each family maps
 * to one or more Pi loader roots; the catalog unifies them under one ID.
 */
export type ResourceKind = 'skill' | 'extension' | 'prompt' | 'instruction' | 'context-file';

export type ResourceSource = SkillSource | 'pi-native';

export type ResourceId = string;

/**
 * Canonical, collision-safe resource ID normalization. Shared by Settings,
 * inventory scanners, subagent profiles, SDK/RPC blueprints, and UI so a
 * logical ID always maps to the same string everywhere (spec §8.3).
 *
 * Rules:
 * - trim; lowercase
 * - any run of characters outside `[a-z0-9-]` collapses to a single `-`
 * - leading/trailing `-` stripped
 * - empty result throws so callers never persist an unusable ID
 */
export function normalizeResourceId(value: string): ResourceId {
  const collapsed = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (collapsed.length === 0) {
    throw new Error(`Cannot normalize empty resource id from: ${JSON.stringify(value)}`);
  }
  return collapsed;
}

/** Stable diagnostics for shadowing/precedence collisions (spec §8.4). */
export type ResourceShadowDiagnostic = {
  kind: 'shadowed' | 'duplicate-id';
  resourceKind: ResourceKind;
  resourceId: ResourceId;
  winnerPath: string;
  winnerSource: ResourceSource;
  loserPath: string;
  loserSource: ResourceSource;
};

/** One discovered resource candidate, before activation policy is applied. */
export type ResourceCatalogEntry = {
  resourceId: ResourceId;
  kind: ResourceKind;
  name: string;
  description?: string;
  path: string;
  source: ResourceSource;
  /** Immutable content identity when the Host can determine one. */
  contentRevision?: string;
  /** User intent captured by scanners that own a separate registry. */
  configuredEnabled?: boolean;
  /** Pi-native root marker (e.g. `~/.pi/agent`); undefined for product roots. */
  piNativeRoot?: string;
};

export type ResourceCatalog = {
  version: 1;
  entries: ResourceCatalogEntry[];
  diagnostics: ResourceShadowDiagnostic[];
};

/**
 * Compiled per-session activation decision for a single resource. Separates
 * `configured` (user intent) from `effective` (what the Host will actually
 * pass to Pi after trust/disable/allowlist policy).
 */
export type ResourceActivation = {
  resourceId: ResourceId;
  kind: ResourceKind;
  name: string;
  description?: string;
  path: string;
  source: ResourceSource;
  /** User-visible state from Settings. */
  configuredEnabled: boolean;
  /** Host-resolved state after policy (trust, disabledIds, allowlist). */
  effectiveEnabled: boolean;
  blockedReason?: 'project-untrusted' | 'disabled' | 'not-allowed';
};

/**
 * Compiled per-session selection policy for one resource family (spec §8.5).
 * The manifest contains only active instances; blocked/shadowed entries stay
 * in the catalog/status API but are never passed to Pi.
 */
export type ResourceSelectionPolicy = {
  /** Logical IDs disabled regardless of source copy. */
  disabledIds: ResourceId[];
  /** Sources allowed to contribute instances (e.g. excludes 'project' when untrusted). */
  allowedSources: ResourceSource[];
  /** When non-null, only these IDs may be active (empty array = none allowed). */
  allowlistedIds: ResourceId[] | null;
};

/**
 * Compiled per-session resource policy (spec §8.5). Resolved purely from
 * settings + trust inputs; adapters translate this to Pi loader options.
 */
export type ResourcePolicy = {
  skills: ResourceSelectionPolicy;
  extensions: ResourceSelectionPolicy;
  prompts: ResourceSelectionPolicy;
};
