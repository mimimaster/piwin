/**
 * S06 sustained-pressure coordinator: runs reclaim episodes while pressure
 * persists, observing the footprint at OBSERVATION_POINTS_MS (2/10/30 s) and
 * recording a diagnostic ledger entry per episode.
 *
 * Where S05's governor answers the pressure *edge* (one budget push + one
 * purge on escalation), this module answers the *plateau*: when moderate or
 * critical samples keep arriving, repeated slices drain whatever disposable
 * weight remains, and the episode ledger records why the episode ended —
 * recovered, only-protected-left, no-progress, sampler gone, or the
 * renderer itself stopped answering.
 *
 * All effects flow through injected deps (now/schedule/getLevel/
 * enumerateCandidates/release/purgeNative/record), so tests drive the whole
 * executor with fake monotonic time. reclaim-wiring.ts binds the real
 * registries into `globalReclaimCoordinator`; the three effect runners live
 * in reclaim-episode-runner.ts and share this file's closure via a narrow
 * RunnerContext.
 *
 * Ordering invariants (see reclaim-policy.ts):
 * - admission-first is a NO-OP marker: the governor already pushed the
 *   restricted budgets on the level edge; the action only records that
 *   ordering in the episode round log before any release.
 * - Recovery never rebuilds: on 'recovered' the governor's →normal budget
 *   push restores admission; the coordinator neither prefetches nor
 *   repopulates any cache.
 * - Samples are never fabricated: an observation with no fresh sample waits
 *   for the next real `onPressureSample` call (bounded by
 *   SAMPLER_TIMEOUT_MS, which terminates the episode 'sampler-unavailable').
 */
import type { MemoryPressureLevel } from './cache-budget.js';
import {
  OBSERVATION_POINTS_MS,
  evaluateObservation,
  runNativePurge,
  runReleaseSlice,
  type EpisodeState,
  type RunnerContext,
} from './reclaim-episode-runner.js';
import {
  RECLAIM_ADMISSION_KEY,
  countCandidates,
  selectReclaimAction,
  type EpisodeOutcome,
  type ReclaimAction,
  type ReclaimCandidate,
} from './reclaim-policy.js';

export {
  OBSERVATION_POINTS_MS,
  PURGE_TIMEOUT_MS,
  RECOVERY_DELTA_BYTES,
  RELEASE_STALL_FACTOR,
  RECLAIM_NATIVE_PURGE_KEY,
  SAMPLE_FRESH_MS,
  SLICE_YIELD_MS,
} from './reclaim-episode-runner.js';
export { SLICE_BUDGET_MS } from './reclaim-policy.js';

/** Episode is abandoned when no sample arrives for this long. */
export const SAMPLER_TIMEOUT_MS = 60_000;
/** Minimum gap before a new episode may start after a terminal outcome. */
export const EPISODE_COOLDOWN_MS = 60_000;

export type ReclaimEpisode = {
  episodeId: number;
  startedAtMs: number;
  level: 'moderate' | 'critical';
  admitted: boolean;
  rounds: Array<{ kind: ReclaimAction['type']; atMs: number; detail: string }>;
  releasedBytesEstimate: number;
  outcome?: EpisodeOutcome;
  endedAtMs?: number;
  // Ledger diagnostics (reclaim-ledger.ts records these verbatim):
  /** Main-process footprint when the episode opened, if sampled. */
  beforeBytes?: number;
  /** Latest fresh-sample footprint, so before−after is the actual delta. */
  afterBytes?: number;
  eligibleCount?: number;
  protectedCount?: number;
  blockedCount?: number;
  lastSampleQuality?: 'fresh' | 'stale' | 'missing';
};

export type ReclaimCoordinatorDeps = {
  now: () => number;
  /** Cancellable delay scheduler; tests fake it to drive the episode clock. */
  schedule: (cb: () => void, delayMs: number) => () => void;
  getLevel: () => MemoryPressureLevel;
  /**
   * Age of the latest real sample, or undefined when none exists. When
   * omitted the coordinator tracks `onPressureSample` timestamps itself —
   * the production path needs no second sample source because this
   * coordinator IS the sample sink.
   */
  getFreshSampleAgeMs?: () => number | undefined;
  enumerateCandidates: () => ReclaimCandidate[];
  /**
   * Release ONE candidate. Implementations re-check visibility/leases before
   * freeing (a hidden pane may have become visible since enumeration);
   * `{released: 0}` without error means "still protected", which is progress-
   * neutral, not a failure.
   */
  release: (key: string, deadlineMs: number) => Promise<{ released: number; error?: string }>;
  purgeNative: () => Promise<'ok' | 'timeout' | 'error'>;
  record: (episode: ReclaimEpisode) => void;
};

export type ReclaimCoordinator = {
  onPressureSample(sample: { bytes: number; level: 'moderate' | 'critical' }): void;
  tick(nowMs: number): void;
  getCurrentEpisode(): ReclaimEpisode | undefined;
  dispose(): void;
};

export function createReclaimCoordinator(deps: ReclaimCoordinatorDeps): ReclaimCoordinator {
  let state: EpisodeState | undefined;
  let disposed = false;
  let lastTerminalAtMs = Number.NEGATIVE_INFINITY;
  let nextEpisodeId = 1;

  const ctx: RunnerContext = {
    deps,
    isDisposed: () => disposed,
    isCurrent: (s) => state === s,
    tick: (nowMs) => tick(nowMs),
    // Rebound to terminalEpisode below — the runners only invoke it inside
    // callbacks, after the coordinator has fully initialized.
    endEpisode: () => {},
    pushRound: (s, kind, detail) => {
      s.episode.rounds.push({ kind, atMs: deps.now(), detail });
    },
    sampleAgeMs: (s, nowMs) => {
      if (deps.getFreshSampleAgeMs !== undefined) {
        return deps.getFreshSampleAgeMs();
      }
      if (s.lastSampleAtMs < 0) return undefined;
      return Math.max(0, nowMs - s.lastSampleAtMs);
    },
  };

  const pushRound = ctx.pushRound;

  const nextObservationDelay = (s: EpisodeState, nowMs: number): number | undefined => {
    const point = OBSERVATION_POINTS_MS[s.observationIndex];
    if (point === undefined) return undefined;
    return Math.max(0, s.episode.startedAtMs + point - nowMs);
  };

  const ensureObservationTimer = (s: EpisodeState, nowMs: number): void => {
    s.observationCancel?.();
    s.observationCancel = undefined;
    // While awaiting a sample, observations stay paused: only a real sample
    // (onPressureSample) can unblock them, so no timer is owed.
    if (s.awaitingSample) return;
    const delay = nextObservationDelay(s, nowMs);
    if (delay === undefined) return;
    s.observationCancel = deps.schedule(() => {
      if (state === s && !disposed) {
        s.observationCancel = undefined;
        tick(deps.now());
      }
    }, delay);
  };

  const terminalEpisode = (s: EpisodeState, outcome: EpisodeOutcome, reason: string): void => {
    const nowMs = deps.now();
    s.observationCancel?.();
    s.samplerCancel?.();
    s.observationCancel = undefined;
    s.samplerCancel = undefined;
    s.episode.outcome = outcome;
    s.episode.endedAtMs = nowMs;
    const counts = countCandidates(s.lastCandidates, s.attemptedKeys);
    s.episode.eligibleCount = counts.eligible;
    s.episode.protectedCount = counts.protected;
    s.episode.blockedCount = counts.blocked;
    if (s.startBytes !== undefined) s.episode.beforeBytes = s.startBytes;
    if (s.lastSampleBytes !== undefined) s.episode.afterBytes = s.lastSampleBytes;
    pushRound(s, 'episode-terminal', `${outcome}: ${reason}`);
    deps.record({ ...s.episode, rounds: s.episode.rounds.slice() });
    lastTerminalAtMs = nowMs;
    state = undefined;
  };
  ctx.endEpisode = terminalEpisode;

  /** Silence-since-last-sample watchdog; re-armed on every live sample. */
  const armSamplerTimer = (s: EpisodeState): void => {
    s.samplerCancel?.();
    s.samplerCancel = deps.schedule(() => {
      if (state === s && !disposed) {
        terminalEpisode(s, 'sampler-unavailable', `no sample for ${SAMPLER_TIMEOUT_MS} ms`);
      }
    }, SAMPLER_TIMEOUT_MS);
  };

  const tick = (nowMs: number): void => {
    if (disposed) return;
    const s = state;
    if (s === undefined) return;

    // A governor level edge is itself evidence of recovery — no fresh sample
    // required, because classification already consumed the sample.
    if (deps.getLevel() === 'normal') {
      terminalEpisode(s, 'recovered', 'governor level returned to normal');
      return;
    }

    const level = deps.getLevel();
    if (level === 'moderate' || level === 'critical') {
      s.episode.level = level;
    }

    if (!s.awaitingSample) {
      const point = OBSERVATION_POINTS_MS[s.observationIndex];
      if (point !== undefined && nowMs - s.episode.startedAtMs >= point) {
        if (evaluateObservation(ctx, s, nowMs)) return;
      }
      // Arm after evaluation so the timer targets the NEXT point, not the
      // just-consumed one (which would schedule a stray 0-delay fire).
      ensureObservationTimer(s, nowMs);
    }

    // Fresh census each tick: the policy ranks these candidates and the
    // terminal diagnostics count them, so one enumeration serves both.
    s.lastCandidates = deps.enumerateCandidates();

    // The policy still needs the observation point while awaiting a sample
    // (it holds 'observe' until a real sample arrives), so pass it through
    // even though no timer is armed.
    const nextDelay = nextObservationDelay(s, nowMs);
    const action = selectReclaimAction({
      level: s.episode.level,
      nowMs,
      candidates: s.lastCandidates,
      attemptedKeys: s.attemptedKeys,
      ...(s.awaitingSample ? { awaitingSample: true } : {}),
      ...(nextDelay === undefined ? {} : { nextObservationAtMs: nowMs + nextDelay }),
    });

    switch (action.type) {
      case 'admission-first':
        s.attemptedKeys.add(RECLAIM_ADMISSION_KEY);
        s.episode.admitted = true;
        pushRound(s, 'admission-first', action.reason);
        // Re-enter so the first release slice lands in the same turn.
        tick(nowMs);
        return;
      case 'release-slice':
        if (s.releaseInFlight) return;
        s.releaseInFlight = true;
        pushRound(s, 'release-slice', action.reason);
        void runReleaseSlice(ctx, s, action.keys, action.deadlineMs);
        return;
      case 'native-purge':
        if (s.releaseInFlight || s.purgeInFlight) return;
        runNativePurge(ctx, s);
        return;
      case 'observe':
        ensureObservationTimer(s, nowMs);
        return;
      case 'episode-terminal':
        terminalEpisode(s, action.outcome, action.reason);
        return;
    }
  };
  ctx.tick = tick;

  const onPressureSample = (sample: { bytes: number; level: 'moderate' | 'critical' }): void => {
    if (disposed) return;
    const nowMs = deps.now();
    if (state === undefined) {
      if (nowMs - lastTerminalAtMs < EPISODE_COOLDOWN_MS) {
        return;
      }
      const episode: ReclaimEpisode = {
        episodeId: nextEpisodeId,
        startedAtMs: nowMs,
        level: sample.level,
        admitted: false,
        rounds: [],
        releasedBytesEstimate: 0,
      };
      nextEpisodeId += 1;
      const s: EpisodeState = {
        episode,
        attemptedKeys: new Set(),
        lastSampleAtMs: nowMs,
        lastSampleBytes: sample.bytes,
        startBytes: sample.bytes,
        observationIndex: 0,
        observationCancel: undefined,
        awaitingSample: false,
        consecutiveNoProgress: 0,
        lastProgressMarker: 0,
        purgeInFlight: false,
        releaseInFlight: false,
        deferredKeys: new Set(),
        samplerCancel: undefined,
        lastCandidates: deps.enumerateCandidates(),
      };
      state = s;
      armSamplerTimer(s);
      tick(nowMs);
      return;
    }
    const s = state;
    s.lastSampleAtMs = nowMs;
    s.lastSampleBytes = sample.bytes;
    s.episode.level = sample.level;
    // A live sample resets the silence clock — the sampler-unavailable
    // outcome is for a Host that went quiet, not a fixed episode TTL.
    armSamplerTimer(s);
    // A real sample unblocks a held observation: run the (now due) point.
    if (s.awaitingSample) {
      s.awaitingSample = false;
      if (evaluateObservation(ctx, s, nowMs)) return;
      ensureObservationTimer(s, nowMs);
    }
    tick(nowMs);
  };

  const getCurrentEpisode = (): ReclaimEpisode | undefined => state?.episode;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const s = state;
    state = undefined;
    s?.observationCancel?.();
    s?.samplerCancel?.();
  };

  return { onPressureSample, tick, getCurrentEpisode, dispose };
}
