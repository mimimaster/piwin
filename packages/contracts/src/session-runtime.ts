/** Session runtime status + reload contracts (spec §12). */

import type { ImmediateCapabilityRestriction, SettingsDomain } from './settings.js';
import type { SessionPauseCheckpoint } from './session-pause.js';
import type { ExtensionSetRevision } from './extensions.js';

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
  'cold' | 'activating' | 'resident-idle' | 'resident-busy' | 'suspending';

/** Stable reasons a runtime was suspended (ADR 0040 §2/§4). */
export type SessionRuntimeEvictionReason =
  | 'idle-ttl'
  | 'max-idle'
  | 'max-resident'
  | 'memory-pressure'
  | 'manual'
  | 'host-dispose'
  /** ADR 0055: the active branch changed; the replayed context is stale. */
  | 'branch-switch';

export type SessionRuntimeStatus = {
  sessionId: string;
  state: SessionRuntimeState;
  /** ADR 0040: optional residency projection. Absent for legacy hosts. */
  residency?: SessionRuntimeResidency;
  /** ADR 0040: last eviction reason when the runtime became cold. */
  lastEvictionReason?: SessionRuntimeEvictionReason;
  generationId?: string;
  settingsRevision?: string;
  /** Exact extension revision set loaded by the active generation. */
  loadedExtensionSetRevision?: ExtensionSetRevision;
  /** Exact extension revision set targeted by a pending deployment. */
  targetExtensionSetRevision?: ExtensionSetRevision;
  /** Host deployment currently changing this session's extension set. */
  pendingExtensionDeploymentId?: string;
  /** Old generation cleanup could not be proven complete. */
  restartRequired?: boolean;
  /** Latest committed Settings revision awaiting this generation. */
  desiredSettingsRevision?: string;
  capabilitySnapshotId?: string;
  staleDomains: SettingsDomain[];
  /** Exact domains with an immediate capability restriction in effect. */
  immediateTighteningDomains?: SettingsDomain[];
  /** Exact capabilities blocked while the old generation drains. */
  immediateRestrictions?: ImmediateCapabilityRestriction[];
  reconstructionMode?: 'native-live' | 'product-history';
  candidateState?: 'compiling' | 'creating-backend' | 'rebuilding' | 'active' | 'failed';
  candidateError?: string;
  /** Active resumable checkpoint, when the session has no live foreground run. */
  pauseCheckpoint?: SessionPauseCheckpoint;
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
  'codeSearch',
  'skills',
  'extensions',
  'prompts',
  'process',
  'notes',
  'flashcards',
  'knowledge',
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
  'knowledge',
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
  /** @deprecated Use the Host-owned desired revision and generation CAS. */
  expectedSettingsRevision: string;
  when: 'now' | 'after-current-run';
};
