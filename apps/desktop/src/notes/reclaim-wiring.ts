/**
 * S06 production wiring for the reclaim coordinator. Kept in its own leaf
 * module so reclaim-coordinator.ts stays dep-injected and unit-testable, and
 * so the memory-pressure ↔ coordinator import pair lands here rather than
 * inside the executor (memory-pressure imports this file for the singleton;
 * this file imports memory-pressure for the purge — resolved safely because
 * both uses are inside function bodies after module init).
 */
import { globalMemoryGovernor } from './memory-governor.js';
import { requestNativeWebviewMemoryPurge } from './memory-pressure.js';
import { collectReclaimCandidates, releaseReclaimCandidate } from './reclaim-candidates.js';
import { createReclaimCoordinator } from './reclaim-coordinator.js';
import { recordReclaimEpisode } from './reclaim-ledger.js';
import {
  SLICE_BUDGET_MS,
  SLICE_MAX_COUNT,
  SLICE_TARGET_BYTES,
  compareReclaimCandidates,
  type ReclaimCandidate,
} from './reclaim-policy.js';

/**
 * Wraps `requestNativeWebviewMemoryPurge` into the tri-state result the
 * coordinator expects (its own PURGE_TIMEOUT_MS timer covers 'timeout').
 */
async function purgeNativeWebview(): Promise<'ok' | 'timeout' | 'error'> {
  try {
    await requestNativeWebviewMemoryPurge();
    return 'ok';
  } catch {
    return 'error';
  }
}

export const globalReclaimCoordinator = createReclaimCoordinator({
  now: () => Date.now(),
  schedule: (cb, delayMs) => {
    const timer = setTimeout(cb, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
  getLevel: () => globalMemoryGovernor.getLevel(),
  // getFreshSampleAgeMs intentionally omitted: the coordinator tracks
  // onPressureSample timestamps itself — it IS the sample sink.
  enumerateCandidates: collectReclaimCandidates,
  release: (key, deadlineMs) => releaseReclaimCandidate(key, deadlineMs),
  purgeNative: purgeNativeWebview,
  record: (episode) => {
    recordReclaimEpisode(episode);
  },
});

// Governor edges feed the coordinator: a →normal transition must end an open
// episode 'recovered' even if no further sample ever arrives.
globalMemoryGovernor.subscribe(() => {
  globalReclaimCoordinator.tick(Date.now());
});

export type ManualReclaimResult = {
  releasedBytes: number;
  releasedKeys: string[];
  /** Machine-readable reason when nothing (or only part) could be released. */
  reason?: 'no-candidates' | 'release-error';
};

type ManualReclaimDeps = {
  enumerateCandidates?: () => ReclaimCandidate[];
  release?: (key: string, deadlineMs: number) => Promise<{ released: number; error?: string }>;
};

let manualReclaimInFlight: Promise<ManualReclaimResult> | null = null;

/** Diagnostics: is a manual release pass currently running. */
export function isManualReclaimInFlight(): boolean {
  return manualReclaimInFlight !== null;
}

async function runManualReclaim(deps: ManualReclaimDeps): Promise<ManualReclaimResult> {
  const enumerate = deps.enumerateCandidates ?? collectReclaimCandidates;
  const release = deps.release ?? releaseReclaimCandidate;
  const eligible = enumerate()
    .filter((candidate) => Number.isFinite(candidate.protectionScore))
    .sort(compareReclaimCandidates);
  if (eligible.length === 0) {
    return { releasedBytes: 0, releasedKeys: [], reason: 'no-candidates' };
  }
  // Same bounded shape as a policy release-slice: a small batch with one
  // shared deadline, never a whole-episode drain.
  const deadlineMs = Date.now() + SLICE_BUDGET_MS;
  const releasedKeys: string[] = [];
  let releasedBytes = 0;
  let estimatedBytes = 0;
  let reason: ManualReclaimResult['reason'];
  for (const candidate of eligible) {
    if (releasedKeys.length >= SLICE_MAX_COUNT || estimatedBytes >= SLICE_TARGET_BYTES) {
      break;
    }
    const result = await release(candidate.key, deadlineMs);
    if (result.error !== undefined) {
      reason = 'release-error';
      break;
    }
    releasedKeys.push(candidate.key);
    releasedBytes += result.released;
    estimatedBytes += candidate.estimatedBytes;
  }
  return {
    releasedBytes,
    releasedKeys,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * S07 explicit manual release: one bounded pass over the current candidates
 * using the same sort/eligibility and the same `releaseReclaimCandidate`
 * lease/visibility re-checks as an episode release-slice. It deliberately
 * does NOT open a coordinator episode — a user click is a one-shot action,
 * not sustained-pressure evidence.
 *
 * A second call while a pass is in flight returns the same promise (the
 * diagnostics panel debounces the button on this).
 */
export function requestManualReclaim(deps: ManualReclaimDeps = {}): Promise<ManualReclaimResult> {
  manualReclaimInFlight ??= runManualReclaim(deps).finally(() => {
    manualReclaimInFlight = null;
  });
  return manualReclaimInFlight;
}
