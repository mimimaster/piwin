/**
 * S06 episode runners: the async/mechanical half of the reclaim executor.
 * Kept separate from reclaim-coordinator.ts so the coordinator file holds
 * the tick/state-machine core while this module holds the three effect
 * runners (release slice, native purge, observation evaluation).
 *
 * Everything here is driven through `RunnerContext` — the coordinator's
 * closure state — so the module stays testable via the same fake deps.
 */
import {
  RECLAIM_ADMISSION_KEY,
  RECLAIM_PURGE_KEY,
  SLICE_BUDGET_MS,
  type EpisodeOutcome,
  type ReclaimAction,
  type ReclaimCandidate,
} from './reclaim-policy.js';
import type { ReclaimCoordinatorDeps, ReclaimEpisode } from './reclaim-coordinator.js';

const MIB = 1024 * 1024;

/** Scheduled footprint checks after episode start. */
export const OBSERVATION_POINTS_MS: readonly number[] = [2_000, 10_000, 30_000];
/** Footprint drop at an observation that ends the episode 'recovered'. */
export const RECOVERY_DELTA_BYTES = 64 * MIB;
/** A sample younger than this counts as fresh for an observation. */
export const SAMPLE_FRESH_MS = 4_000;
/** A release promise outliving slice start + 4×SLICE_BUDGET_MS stalls the renderer. */
export const RELEASE_STALL_FACTOR = 4;
/** Breathing room between release slices when a deadline defers items. */
export const SLICE_YIELD_MS = 16;
/** Timeout for the async native purge so the episode never waits on it. */
export const PURGE_TIMEOUT_MS = 5_000;
/** Dedup identity for the native purge in the ledger/attempted-keys. */
export const RECLAIM_NATIVE_PURGE_KEY = 'datastore:WKWebsiteDataStore.default';

export type EpisodeState = {
  episode: ReclaimEpisode;
  attemptedKeys: Set<string>;
  lastSampleAtMs: number;
  lastSampleBytes: number | undefined;
  /** Footprint at episode open — the recovery baseline. */
  startBytes: number | undefined;
  observationIndex: number;
  observationCancel: (() => void) | undefined;
  awaitingSample: boolean;
  consecutiveNoProgress: number;
  /** Distinct non-sentinel attempted keys at the last observation. */
  lastProgressMarker: number;
  purgeInFlight: boolean;
  releaseInFlight: boolean;
  /** Keys skipped this slice because the slice deadline hit; retried later. */
  deferredKeys: Set<string>;
  samplerCancel: (() => void) | undefined;
  lastCandidates: readonly ReclaimCandidate[];
};

/** Narrow window into the coordinator's closure — runners never touch raw state. */
export type RunnerContext = {
  deps: ReclaimCoordinatorDeps;
  isDisposed(): boolean;
  isCurrent(s: EpisodeState): boolean;
  tick(nowMs: number): void;
  endEpisode(s: EpisodeState, outcome: EpisodeOutcome, reason: string): void;
  pushRound(s: EpisodeState, kind: ReclaimAction['type'], detail: string): void;
  sampleAgeMs(s: EpisodeState, nowMs: number): number | undefined;
};

const releaseEstimateOf = (s: EpisodeState, key: string): number =>
  s.lastCandidates.find((candidate) => candidate.key === key)?.estimatedBytes ?? 0;

/**
 * Release the slice's keys sequentially within `deadlineMs`. Each
 * `deps.release` re-checks visibility/leases itself. Keys left over when the
 * deadline hits stay UNATTEMPTED and retry after a SLICE_YIELD_MS breath.
 * A single release promise outliving sliceStart + STALL_FACTOR×budget ends
 * the episode 'renderer-unresponsive'.
 */
export async function runReleaseSlice(
  ctx: RunnerContext,
  s: EpisodeState,
  keys: readonly string[],
  deadlineMs: number,
): Promise<void> {
  const { deps } = ctx;
  const sliceStart = deps.now();
  for (const key of keys) {
    if (ctx.isDisposed() || !ctx.isCurrent(s)) return;
    if (deps.now() >= deadlineMs) {
      // Past the slice budget: defer, never drop — the candidate stays
      // un-attempted so the next tick re-slices it.
      s.deferredKeys.add(key);
      continue;
    }
    s.attemptedKeys.add(key);
    let cancelledStall = false;
    const cancelStall = deps.schedule(() => {
      if (ctx.isDisposed() || !ctx.isCurrent(s) || cancelledStall) return;
      ctx.endEpisode(
        s,
        'renderer-unresponsive',
        `release for ${key} exceeded deadline ×${RELEASE_STALL_FACTOR}`,
      );
    }, Math.max(0, deadlineMs + SLICE_BUDGET_MS * (RELEASE_STALL_FACTOR - 1) - sliceStart));
    try {
      const result = await deps.release(key, deadlineMs);
      cancelledStall = true;
      cancelStall();
      if (ctx.isDisposed() || !ctx.isCurrent(s)) return;
      s.episode.releasedBytesEstimate += Math.max(result.released, releaseEstimateOf(s, key));
      if (result.error !== undefined) {
        // One release error is recorded but independent items keep going.
        ctx.pushRound(s, 'release-slice', `error on ${key}: ${result.error}`);
      }
    } catch (error) {
      cancelledStall = true;
      cancelStall();
      if (ctx.isDisposed() || !ctx.isCurrent(s)) return;
      ctx.pushRound(s, 'release-slice', `error on ${key}: ${String(error)}`);
    }
  }
  if (ctx.isDisposed() || !ctx.isCurrent(s)) return;
  s.releaseInFlight = false;
  if (s.deferredKeys.size > 0) {
    s.deferredKeys.clear();
    deps.schedule(() => {
      if (ctx.isCurrent(s) && !ctx.isDisposed()) ctx.tick(deps.now());
    }, SLICE_YIELD_MS);
    return;
  }
  ctx.tick(deps.now());
}

/**
 * Fire the one-per-episode native purge. `RECLAIM_PURGE_KEY` in
 * attemptedKeys is both the dedupe and the policy-visible marker; the
 * PURGE_TIMEOUT_MS timer degrades a hung invoke to a ledger 'timeout'
 * round without stalling the episode.
 */
export function runNativePurge(ctx: RunnerContext, s: EpisodeState): void {
  const { deps } = ctx;
  s.attemptedKeys.add(RECLAIM_PURGE_KEY);
  s.purgeInFlight = true;
  let timedOut = false;
  const cancelTimeout = deps.schedule(() => {
    if (ctx.isDisposed() || !ctx.isCurrent(s) || !s.purgeInFlight || timedOut) return;
    timedOut = true;
    s.purgeInFlight = false;
    ctx.pushRound(
      s,
      'native-purge',
      `timeout after ${PURGE_TIMEOUT_MS} ms (${RECLAIM_NATIVE_PURGE_KEY})`,
    );
    // Drive the policy on so the episode doesn't wait for a hung invoke to
    // settle before trying the next action (or ending).
    ctx.tick(deps.now());
  }, PURGE_TIMEOUT_MS);
  const settle = (status: 'ok' | 'timeout' | 'error'): void => {
    cancelTimeout();
    if (ctx.isDisposed() || !ctx.isCurrent(s)) return;
    s.purgeInFlight = false;
    ctx.pushRound(s, 'native-purge', `${status} (${RECLAIM_NATIVE_PURGE_KEY})`);
    ctx.tick(deps.now());
  };
  deps
    .purgeNative()
    .then(settle)
    .catch(() => {
      settle('error');
    });
}

/**
 * Evaluate the due observation point. Returns true when the episode ended
 * inside the observation. A stale/missing sample HOLDS the observation open
 * (samples are never fabricated) — `onPressureSample` resumes it, and the
 * episode-level sampler timeout bounds the wait.
 */
export function evaluateObservation(
  ctx: RunnerContext,
  s: EpisodeState,
  nowMs: number,
): boolean {
  const age = ctx.sampleAgeMs(s, nowMs);
  if (age === undefined || age > SAMPLE_FRESH_MS) {
    s.awaitingSample = true;
    const quality = age === undefined ? 'missing' : 'stale';
    s.episode.lastSampleQuality = quality;
    ctx.pushRound(
      s,
      'observe',
      `observation #${s.observationIndex + 1} held: sample ${quality}`,
    );
    return false;
  }
  s.awaitingSample = false;
  s.episode.lastSampleQuality = 'fresh';
  s.observationIndex += 1;
  s.lastCandidates = ctx.deps.enumerateCandidates();
  const delta =
    s.startBytes !== undefined && s.lastSampleBytes !== undefined
      ? s.startBytes - s.lastSampleBytes
      : 0;
  if (delta >= RECOVERY_DELTA_BYTES) {
    ctx.endEpisode(
      s,
      'recovered',
      `observation #${s.observationIndex}: footprint dropped ${delta} B ≥ ${RECOVERY_DELTA_BYTES} B`,
    );
    return true;
  }
  const marker = [...s.attemptedKeys].filter(
    (key) => key !== RECLAIM_ADMISSION_KEY && key !== RECLAIM_PURGE_KEY,
  ).length;
  // Only-protected episodes cannot make progress by definition; counting
  // them as 'no-progress' would misdiagnose what is really
  // 'protected-over-budget', so the counter stays parked while protected
  // weight remains and the observation schedule runs out.
  const protectedRemain = s.lastCandidates.some(
    (candidate) => !Number.isFinite(candidate.protectionScore),
  );
  if (marker !== s.lastProgressMarker) {
    s.consecutiveNoProgress = 0;
    s.lastProgressMarker = marker;
  } else if (!protectedRemain) {
    s.consecutiveNoProgress += 1;
    if (s.consecutiveNoProgress >= 2) {
      ctx.endEpisode(
        s,
        'no-progress',
        `observation #${s.observationIndex}: two idle observations`,
      );
      return true;
    }
  }
  ctx.pushRound(s, 'observe', `observation #${s.observationIndex}: delta ${delta} B, in-flight`);
  return false;
}
