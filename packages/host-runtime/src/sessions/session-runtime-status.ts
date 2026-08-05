/** Pure runtime staleness computation (spec §12.3–12.4). */

import type { SessionRuntimeState, SessionRuntimeStatus, SettingsDomain } from '@piwin/contracts';
import { isImmediateTighteningDomain, isRuntimeStaleDomain } from '@piwin/contracts';

export type ComputeRuntimeStatusInput = {
  sessionId: string;
  /** Currently active runtime generation, if any. */
  activeGeneration: boolean;
  /** Settings revision the active runtime was created from. */
  activeSettingsRevision?: string;
  /** Current settings revision after the latest apply. */
  currentSettingsRevision: string;
  /** Domains that changed since the runtime was created. */
  changedDomains: SettingsDomain[];
};

export type RuntimeStatusResult = {
  status: SessionRuntimeStatus;
  /** True when at least one changed domain requires a new runtime generation. */
  stale: boolean;
  /** True when a changed domain tightens safety for the current turn. */
  immediateTightening: boolean;
};

/**
 * Compute whether an active runtime is stale and whether the current run must
 * be gated immediately. A running turn is never silently aborted; instead
 * new calls from stale tool schemas fail with a capability-disabled error.
 */
export function computeRuntimeStatus(input: ComputeRuntimeStatusInput): RuntimeStatusResult {
  const staleDomains = input.changedDomains.filter(isRuntimeStaleDomain);
  const tighteningDomains = input.changedDomains.filter(isImmediateTighteningDomain);
  const stale = staleDomains.length > 0;

  let state: SessionRuntimeState = 'none';
  if (input.activeGeneration) {
    state = stale ? 'stale' : 'live';
  } else {
    state = 'lazy-shell';
  }

  const status: SessionRuntimeStatus = {
    sessionId: input.sessionId,
    state,
    ...(input.activeGeneration ? { generationId: `${input.sessionId}-gen` } : {}),
    ...(input.activeSettingsRevision !== undefined
      ? { settingsRevision: input.activeSettingsRevision }
      : {}),
    staleDomains,
  };
  if (stale) {
    status.capabilitySnapshotId = 'stale';
  }

  return {
    status,
    stale,
    immediateTightening: tighteningDomains.length > 0,
  };
}
