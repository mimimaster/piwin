/**
 * Sustained-pressure reclaim policy (S06): a PURE function deciding the next
 * reclaim action for one episode. All time enters via `input.nowMs`; there
 * are no timers, no cache lookups, and no side effects — the coordinator
 * (reclaim-coordinator.ts) executes whatever is returned.
 *
 * Ordering contract enforced here:
 *   1. `admission-first` — exactly once per episode, before any release. The
 *      governor already pushed the restricted budgets on the level edge, so
 *      the coordinator executes this as a NO-OP marker that only records the
 *      ordering invariant in the episode ledger.
 *   2. `release-slice` — small, deadline-bounded release of the least-
 *      protected, stalest, fattest candidates, until nothing eligible
 *      remains.
 *   3. `native-purge` — once per episode, only after at least one release
 *      round completed (the governor's escalation-edge purge already covers
 *      the never-released path; a repeat purge is only worth firing once the
 *      frontend caches have actually been drained).
 *   4. `observe` / `episode-terminal` — wait for the next scheduled
 *      observation point; past the last one, name why the episode stopped.
 */

export type ReclaimCandidateKind =
  | 'warm-snapshot'
  | 'cache-entries'
  | 'idle-media'
  | 'presentation';

export type ReclaimCandidate = {
  kind: ReclaimCandidateKind;
  /** Stable identity, e.g. 'warm:<sessionId>' or 'cache:<name>'. */
  key: string;
  estimatedBytes: number;
  /** Higher = reclaim later. Visible/leased/composer → Infinity (never eligible). */
  protectionScore: number;
  /** ms since last touch; higher = older. */
  lastTouchedMs: number;
  /** 0..1 — how expensive rehydrate would be. */
  restoreCost: number;
};

export type ReclaimPolicyInput = {
  level: 'moderate' | 'critical';
  nowMs: number;
  candidates: readonly ReclaimCandidate[];
  /**
   * Keys already attempted this episode. Two sentinel values let the policy
   * observe executor-side one-shot state through this existing channel:
   * `RECLAIM_ADMISSION_KEY` after admission ran, `RECLAIM_PURGE_KEY` after
   * the native purge fired.
   */
  attemptedKeys: ReadonlySet<string>;
  /**
   * Executor-set markers the pure policy cannot infer from keys alone.
   * `awaitingSample` — a fresh sample is owed before the next observation;
   *   suppress the release path while waiting (observations, not more
   *   releases, are what the coordinator is scheduled for).
   * `nextObservationAtMs` — the remaining observation point, if any.
   */
  awaitingSample?: boolean;
  nextObservationAtMs?: number;
};

export type EpisodeOutcome =
  | 'recovered'
  | 'protected-over-budget'
  | 'no-progress'
  | 'sampler-unavailable'
  | 'renderer-unresponsive';

export type ReclaimAction =
  | { type: 'admission-first'; reason: string }
  | { type: 'release-slice'; keys: string[]; deadlineMs: number; reason: string }
  | { type: 'native-purge'; reason: string }
  | { type: 'observe'; waitUntilMs: number; reason: string }
  | { type: 'episode-terminal'; outcome: EpisodeOutcome; reason: string };

export const MIB = 1024 * 1024;

/** Minimum bytes one release slice tries to free. */
export const SLICE_TARGET_BYTES = 16 * MIB;
/** Hard cap on items per slice — protects the deadline on slow releases. */
export const SLICE_MAX_COUNT = 8;
/** Wall-clock budget the executor must not overrun within one slice. */
export const SLICE_BUDGET_MS = 50;

/** Sentinel keys recorded into attemptedKeys by the executor. */
export const RECLAIM_ADMISSION_KEY = 'episode:admission';
export const RECLAIM_PURGE_KEY = 'episode:native-purge';

const EPISODE_SENTINELS: ReadonlySet<string> = new Set([
  RECLAIM_ADMISSION_KEY,
  RECLAIM_PURGE_KEY,
]);

function isEligible(candidate: ReclaimCandidate, attemptedKeys: ReadonlySet<string>): boolean {
  return !attemptedKeys.has(candidate.key) && Number.isFinite(candidate.protectionScore);
}

/** Candidate census for ledger diagnostics (pure). */
export function countCandidates(
  candidates: readonly ReclaimCandidate[],
  attemptedKeys: ReadonlySet<string>,
): { eligible: number; protected: number; blocked: number } {
  let eligible = 0;
  let protectedCount = 0;
  let blocked = 0;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.protectionScore)) {
      protectedCount += 1;
    } else if (attemptedKeys.has(candidate.key)) {
      blocked += 1;
    } else {
      eligible += 1;
    }
  }
  return { eligible, protected: protectedCount, blocked };
}

/** Least-protected first, then oldest, then fattest. */
function compareCandidates(a: ReclaimCandidate, b: ReclaimCandidate): number {
  if (a.protectionScore !== b.protectionScore) return a.protectionScore - b.protectionScore;
  if (a.lastTouchedMs !== b.lastTouchedMs) return b.lastTouchedMs - a.lastTouchedMs;
  return b.estimatedBytes - a.estimatedBytes;
}

export function selectReclaimAction(input: ReclaimPolicyInput): ReclaimAction {
  const { nowMs, attemptedKeys } = input;
  const level = input.level;

  // 1. Admission ordering invariant, once per episode.
  if (!attemptedKeys.has(RECLAIM_ADMISSION_KEY)) {
    return {
      type: 'admission-first',
      reason: `episode ${level}: tighten admission before releasing`,
    };
  }

  const eligible = input.candidates
    .filter((candidate) => isEligible(candidate, attemptedKeys))
    .sort(compareCandidates);

  // 2. Release work — suppressed while an observation owes a fresh sample:
  //    the coordinator already released everything it could; further slices
  //    without evidence would just re-enumerate the same candidates.
  if (!input.awaitingSample && eligible.length > 0) {
    const keys: string[] = [];
    let bytes = 0;
    for (const candidate of eligible) {
      if (keys.length >= SLICE_MAX_COUNT) break;
      keys.push(candidate.key);
      bytes += candidate.estimatedBytes;
      if (bytes >= SLICE_TARGET_BYTES) break;
    }
    return {
      type: 'release-slice',
      keys,
      deadlineMs: nowMs + SLICE_BUDGET_MS,
      reason: `episode ${level}: releasing ${keys.length} candidate(s), ~${bytes} B`,
    };
  }

  // 3. Repeat native purge — once per episode, after a release round ran.
  const releasedOnce = [...attemptedKeys].some((key) => !EPISODE_SENTINELS.has(key));
  if (releasedOnce && !attemptedKeys.has(RECLAIM_PURGE_KEY)) {
    return {
      type: 'native-purge',
      reason: `episode ${level}: post-release WebContent memory-cache purge`,
    };
  }

  // 4. Wait for the next observation point; past the last one, terminate.
  //    While a fresh sample is owed, the episode holds 'observe' regardless
  //    of the point's wall-clock position — only a real sample can close it.
  const nextObservationAtMs = input.nextObservationAtMs;
  if (input.awaitingSample && nextObservationAtMs !== undefined) {
    return {
      type: 'observe',
      waitUntilMs: nextObservationAtMs,
      reason: `episode ${level}: awaiting fresh sample before observation`,
    };
  }
  if (nextObservationAtMs !== undefined && nextObservationAtMs > nowMs) {
    return {
      type: 'observe',
      waitUntilMs: nextObservationAtMs,
      reason: `episode ${level}: nothing eligible; wait for observation`,
    };
  }

  const hasProtected = input.candidates.some(
    (candidate) => !Number.isFinite(candidate.protectionScore),
  );
  if (hasProtected) {
    return {
      type: 'episode-terminal',
      outcome: 'protected-over-budget',
      reason: `episode ${level}: only protected (visible/leased) candidates remain`,
    };
  }
  return {
    type: 'episode-terminal',
    outcome: 'no-progress',
    reason: `episode ${level}: observation schedule exhausted with no candidates left`,
  };
}
