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
