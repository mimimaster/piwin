/** Session runtime status + reload contracts (spec §12). */

import type { SettingsDomain } from './settings.js';

/** Live vs product-shell runtime state for one product session (spec §12.2). */
export type SessionRuntimeState =
  'none' | 'lazy-shell' | 'live' | 'stale' | 'rebuilding' | 'failed';

/**
 * Host-owned residency state for one product session (ADR 0040 §2).
 *
 * Residency is orthogonal to Settings staleness: `state` continues to
 * describe the lazy-shell/live/stale/rebuilding compatibility projection,
 * while `residency` describes whether a runtime is materialized and how it
 * is being used. Clients must not infer residency from Settings staleness.
 */
export type SessionRuntimeResidency =
  | 'cold'
  | 'activating'
  | 'resident-idle'
  | 'resident-busy'
  | 'suspending';

/** Stable reasons a runtime was suspended (ADR 0040 §2/§4). */
export type SessionRuntimeEvictionReason =
  | 'idle-ttl'
  | 'max-idle'
  | 'max-resident'
  | 'memory-pressure'
  | 'manual'
  | 'host-dispose';

export type SessionRuntimeStatus = {
  sessionId: string;
  state: SessionRuntimeState;
  /** ADR 0040: optional residency projection. Absent for legacy hosts. */
  residency?: SessionRuntimeResidency;
  /** ADR 0040: last eviction reason when the runtime became cold. */
  lastEvictionReason?: SessionRuntimeEvictionReason;
  generationId?: string;
  settingsRevision?: string;
  capabilitySnapshotId?: string;
  staleDomains: SettingsDomain[];
  reconstructionMode?: 'native-live' | 'product-history';
  candidateState?: 'compiling' | 'creating-backend' | 'rebuilding' | 'active' | 'failed';
  candidateError?: string;
};

/**
 * Domains whose changes require a new Agent Runtime generation (spec §12.3).
 * Everything else (appearance, artifact preview, vision delegation params,
 * media-save caps, automation execution, dynamic service health) only needs a
 * gate update or no action at all.
 */
export const RUNTIME_STALE_DOMAINS: ReadonlySet<SettingsDomain> = new Set<SettingsDomain>([
  'hostMode',
  'agentMock',
  'providers',
  'defaultProviderId',
  'defaultModelId',
  'web',
  'skills',
  'extensions',
  'prompts',
  'process',
  'notes',
  'flashcards',
  'permissions',
  'subagents',
]);

/** Domains that tighten safety immediately even before runtime replacement. */
export const IMMEDIATE_TIGHTENING_DOMAINS: ReadonlySet<SettingsDomain> = new Set<SettingsDomain>([
  'permissions',
  'web',
  'process',
  'notes',
  'flashcards',
  'subagents',
]);

export function isRuntimeStaleDomain(domain: SettingsDomain): boolean {
  return RUNTIME_STALE_DOMAINS.has(domain);
}

export function isImmediateTighteningDomain(domain: SettingsDomain): boolean {
  return IMMEDIATE_TIGHTENING_DOMAINS.has(domain);
}

/** Contracts-first reload command (spec §12.6). */
export type SessionReloadRuntimeCommand = {
  type: 'session/reload-runtime';
  sessionId: string;
  expectedSettingsRevision: string;
  when: 'now' | 'after-current-run';
};
