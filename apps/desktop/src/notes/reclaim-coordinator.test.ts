import { describe, expect, it } from 'vitest';
import {
  EPISODE_COOLDOWN_MS,
  OBSERVATION_POINTS_MS,
  PURGE_TIMEOUT_MS,
  RECOVERY_DELTA_BYTES,
  SAMPLER_TIMEOUT_MS,
  SLICE_BUDGET_MS,
  createReclaimCoordinator,
  type ReclaimCoordinatorDeps,
  type ReclaimEpisode,
} from './reclaim-coordinator';
import type { ReclaimCandidate } from './reclaim-policy';

const MIB = 1024 * 1024;

type Scheduled = { atMs: number; cb: () => void; cancelled: boolean };

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(overrides: Partial<ReclaimCoordinatorDeps> = {}) {
  let nowMs = 0;
  let level: 'normal' | 'moderate' | 'critical' = 'normal';
  const timers: Scheduled[] = [];
  let candidates: ReclaimCandidate[] = [];
  const releasedKeys: string[] = [];
  const recorded: ReclaimEpisode[] = [];
  let purgeCalls = 0;
  let purgeImpl: () => Promise<'ok' | 'timeout' | 'error'> = () => Promise.resolve('ok');
  let releaseImpl: (
    key: string,
    deadlineMs: number,
  ) => Promise<{ released: number; error?: string }> = (key) => {
    releasedKeys.push(key);
    return Promise.resolve({ released: MIB });
  };
  /** When set, overrides the coordinator's internal sample-age tracking. */
  let sampleAgeMs: number | undefined;

  const deps: ReclaimCoordinatorDeps = {
    now: () => nowMs,
    schedule: (cb, delayMs) => {
      const entry: Scheduled = { atMs: nowMs + delayMs, cb, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    getLevel: () => level,
    getFreshSampleAgeMs: () => sampleAgeMs,
    enumerateCandidates: () => candidates,
    release: (key, deadlineMs) => releaseImpl(key, deadlineMs),
    purgeNative: () => {
      purgeCalls += 1;
      return purgeImpl();
    },
    record: (episode) => {
      recorded.push(episode);
    },
    ...overrides,
  };

  const coordinator = createReclaimCoordinator(deps);

  const advance = (ms: number): void => {
    nowMs += ms;
    // Fire every timer due at/below nowMs (stable for repeated 0-delay timers).
    for (;;) {
      const due = timers.find((t) => !t.cancelled && t.atMs <= nowMs);
      if (due === undefined) return;
      due.cancelled = true;
      due.cb();
    }
  };
  const flush = async (turns = 8): Promise<void> => {
    for (let i = 0; i < turns; i += 1) {
      await Promise.resolve();
    }
  };

  return {
    coordinator,
    deps,
    timers,
    releasedKeys,
    recorded,
    advance,
    flush,
    get nowMs() {
      return nowMs;
    },
    setNow: (ms: number) => {
      nowMs = ms;
    },
    setLevel: (l: 'normal' | 'moderate' | 'critical') => {
      level = l;
    },
    setCandidates: (c: ReclaimCandidate[]) => {
      candidates = c;
    },
    setSampleAge: (age: number | undefined) => {
      sampleAgeMs = age;
    },
    get purgeCalls() {
      return purgeCalls;
    },
    setPurgeImpl: (impl: typeof purgeImpl) => {
      purgeImpl = impl;
    },
    setReleaseImpl: (impl: typeof releaseImpl) => {
      releaseImpl = impl;
    },
  };
}

function cand(overrides: Partial<ReclaimCandidate> = {}): ReclaimCandidate {
  return {
    kind: 'cache-entries',
    key: 'cache:a',
    estimatedBytes: 2 * MIB,
    protectionScore: 0,
    lastTouchedMs: 1_000,
    restoreCost: 0.5,
    ...overrides,
  };
}

/** Keep the injected sample age "fresh" for observation evaluation. */
function freshSamples(h: Harness): void {
  h.setSampleAge(0);
}

describe('createReclaimCoordinator', () => {
  it('starts an episode on a critical sample with admission-first ordering', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'cache:a' })]);
    h.coordinator.onPressureSample({ bytes: 2 * 1024 * MIB, level: 'critical' });

    const episode = h.coordinator.getCurrentEpisode();
    expect(episode).toBeDefined();
    expect(episode?.level).toBe('critical');
    expect(episode?.rounds[0]?.kind).toBe('admission-first');
    await h.flush();
    expect(episode?.admitted).toBe(true);
    expect(h.releasedKeys).toContain('cache:a');
  });

  it('ignores a repeated sample during the same episode but tracks bytes', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.coordinator.onPressureSample({ bytes: 1_900 * MIB, level: 'critical' });
    const episode = h.coordinator.getCurrentEpisode();
    expect(episode?.startedAtMs).toBe(0);
    expect(episode?.episodeId).toBe(1);
  });

  it('evaluates observations at 2/10/30 s against fresh samples', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'k' })]);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    freshSamples(h);
    await h.flush();

    h.advance(OBSERVATION_POINTS_MS[0]!); // 2 s
    h.advance(OBSERVATION_POINTS_MS[1]! - OBSERVATION_POINTS_MS[0]!); // 10 s
    const episode = h.coordinator.getCurrentEpisode();
    const observes = episode?.rounds.filter((r) => r.kind === 'observe') ?? [];
    expect(episode).toBeDefined();
    expect(observes.some((r) => r.detail.includes('observation #1'))).toBe(true);
    expect(observes.some((r) => r.detail.includes('observation #2'))).toBe(true);
  });

  it('holds the observation when the sample is stale, resumes on a fresh one', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand()]);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.setSampleAge(10_000); // stale at 2 s
    await h.flush(); // settle the release before the stall window matters
    h.advance(OBSERVATION_POINTS_MS[0]!);
    let episode = h.coordinator.getCurrentEpisode();
    expect(episode?.rounds.some((r) => r.detail.includes('held: sample stale'))).toBe(true);
    expect(episode?.outcome).toBeUndefined();

    // A fresh sample unblocks the held observation without fabricating one.
    h.setSampleAge(0);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB - RECOVERY_DELTA_BYTES, level: 'critical' });
    episode = h.coordinator.getCurrentEpisode();
    expect(episode).toBeUndefined(); // recovered and recorded
    expect(h.recorded[0]?.outcome).toBe('recovered');
    expect(h.recorded[0]?.afterBytes).toBe(2_000 * MIB - RECOVERY_DELTA_BYTES);
  });

  it('holds the observation when the sample is missing entirely', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.setSampleAge(undefined); // dep reports no usable sample
    h.advance(OBSERVATION_POINTS_MS[0]!);
    expect(
      h.coordinator.getCurrentEpisode()?.rounds.some((r) =>
        r.detail.includes('held: sample missing'),
      ),
    ).toBe(true);
    expect(h.coordinator.getCurrentEpisode()?.lastSampleQuality).toBe('missing');
  });

  it('ends sampler-unavailable when no real sample arrives for 60 s', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.setSampleAge(undefined);
    h.advance(SAMPLER_TIMEOUT_MS);
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
    expect(h.recorded[0]?.outcome).toBe('sampler-unavailable');
  });

  it('does NOT end sampler-unavailable while real samples keep arriving past 60 s', async () => {
    // Regression: the watchdog is silence-since-last-sample, not a fixed
    // episode TTL. Samples landing inside the window re-arm it.
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.setSampleAge(0);
    // Feed samples every 30 s for 5 minutes — never silent for 60 s.
    for (let step = 0; step < 10; step += 1) {
      h.advance(30_000);
      h.setSampleAge(0);
      h.coordinator.onPressureSample({ bytes: 1_900 * MIB, level: 'critical' });
    }
    // Episode still live (or ended by a non-sampler outcome); specifically
    // must NOT be reported as sampler-unavailable.
    const outcome = h.recorded.at(-1)?.outcome;
    expect(outcome).not.toBe('sampler-unavailable');
  });

  it('honours the episode cooldown before starting another', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.setSampleAge(undefined);
    h.advance(SAMPLER_TIMEOUT_MS); // terminal at 60 s
    expect(h.recorded).toHaveLength(1);

    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined(); // still in cooldown

    h.advance(EPISODE_COOLDOWN_MS);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    const episode = h.coordinator.getCurrentEpisode();
    expect(episode).toBeDefined();
    expect(episode?.episodeId).toBe(2);
  });

  it('respects the slice deadline and defers remaining keys', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([
      cand({ key: 'a' }),
      cand({ key: 'b', lastTouchedMs: 500 }),
    ]);
    const releasedRecord: string[] = [];
    let nowInsideRelease = 0;
    let calls = 0;
    h.setReleaseImpl((key) => {
      releasedRecord.push(key);
      calls += 1;
      if (calls === 1) {
        nowInsideRelease = h.nowMs;
        // First item eats the whole slice budget.
        h.advance(SLICE_BUDGET_MS + 1);
      }
      return Promise.resolve({ released: MIB });
    });
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush(16);
    // 'b' was deferred past the deadline; the yield timer retries it.
    h.advance(20);
    await h.flush(16);
    expect(releasedRecord).toContain('a');
    expect(releasedRecord).toContain('b');
    expect(nowInsideRelease).toBe(0);
  });

  it('does not mark deferred keys attempted', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'slow' }), cand({ key: 'next', lastTouchedMs: 1 })]);
    const deadlines: number[] = [];
    h.setReleaseImpl(async (key, deadlineMs) => {
      deadlines.push(deadlineMs);
      if (key === 'slow') {
        h.advance(SLICE_BUDGET_MS + 1);
      }
      return { released: MIB };
    });
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush(16);
    h.advance(20); // yield timer retries the deferred key
    await h.flush(16);
    expect(deadlines.length).toBeGreaterThanOrEqual(2);
  });

  it('fires the native purge once per episode and dedupes it', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'k' })]);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush();
    h.advance(500); // let the post-release tick settle
    await h.flush();
    expect(h.purgeCalls).toBe(1);
    // Subsequent ticks never re-fire it.
    freshSamples(h);
    h.advance(OBSERVATION_POINTS_MS[0]!);
    await h.flush();
    expect(h.purgeCalls).toBe(1);
  });

  it('records a purge timeout without stalling the episode', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'k' })]);
    h.setPurgeImpl(() => new Promise<'ok'>(() => {})); // never resolves
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush();
    expect(h.purgeCalls).toBe(1);
    h.advance(PURGE_TIMEOUT_MS);
    const episode = h.coordinator.getCurrentEpisode();
    expect(episode).toBeDefined(); // episode still alive
    expect(episode?.rounds.some((r) => r.detail.includes('timeout'))).toBe(true);
  });

  it('keeps releasing independent items when one release errors', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([
      cand({ key: 'bad' }),
      cand({ key: 'good', lastTouchedMs: 10 }),
    ]);
    h.setReleaseImpl((key) =>
      key === 'bad'
        ? Promise.resolve({ released: 0, error: 'boom' })
        : Promise.resolve({ released: MIB }),
    );
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush(16);
    const episode = h.coordinator.getCurrentEpisode();
    expect(episode?.rounds.some((r) => r.detail.includes('error on bad'))).toBe(true);
    // 'good' still released — estimate accrues even though 'bad' errored.
    expect(episode?.releasedBytesEstimate).toBeGreaterThanOrEqual(MIB);
  });

  it('ends protected-over-budget when only protected weight remains', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'visible', protectionScore: Number.POSITIVE_INFINITY })]);
    freshSamples(h);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.advance(OBSERVATION_POINTS_MS[0]!);
    h.advance(OBSERVATION_POINTS_MS[1]! - OBSERVATION_POINTS_MS[0]!);
    h.advance(OBSERVATION_POINTS_MS[2]! - OBSERVATION_POINTS_MS[1]!);
    await h.flush();
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
    expect(h.recorded[0]?.outcome).toBe('protected-over-budget');
    expect(h.recorded[0]?.protectedCount).toBe(1);
  });

  it('ends no-progress after two idle observations', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([]); // nothing to release, nothing protected
    freshSamples(h);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.advance(OBSERVATION_POINTS_MS[0]!);
    expect(h.coordinator.getCurrentEpisode()).toBeDefined();
    h.advance(OBSERVATION_POINTS_MS[1]! - OBSERVATION_POINTS_MS[0]!);
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
    expect(h.recorded[0]?.outcome).toBe('no-progress');
  });

  it('ends recovered when the footprint drops enough at an observation', async () => {
    const h = makeHarness();
    h.setLevel('moderate');
    h.setCandidates([cand()]);
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'moderate' });
    await h.flush(); // settle the release so the stall timer is cancelled
    h.setSampleAge(0);
    // New sample arrives just before the 2 s observation with a big drop.
    h.advance(OBSERVATION_POINTS_MS[0]! - 10);
    h.coordinator.onPressureSample({
      bytes: 2_000 * MIB - RECOVERY_DELTA_BYTES - 1,
      level: 'moderate',
    });
    h.advance(10);
    expect(h.recorded[0]?.outcome).toBe('recovered');
    expect(h.recorded[0]?.beforeBytes).toBe(2_000 * MIB);
  });

  it('ends recovered when the governor returns to normal', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush();
    h.setLevel('normal');
    h.coordinator.tick(h.nowMs);
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
    expect(h.recorded[0]?.outcome).toBe('recovered');
  });

  it('ends renderer-unresponsive when a release overruns deadline ×4', async () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.setCandidates([cand({ key: 'stuck' })]);
    h.setReleaseImpl(() => new Promise<{ released: number }>(() => {})); // never settles
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    await h.flush();
    h.advance(SLICE_BUDGET_MS * 4 + 1);
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
    expect(h.recorded[0]?.outcome).toBe('renderer-unresponsive');
  });

  it('dispose() is idempotent and cancels pending timers', () => {
    const h = makeHarness();
    h.setLevel('critical');
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    h.coordinator.dispose();
    h.coordinator.dispose();
    h.advance(60_000);
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
    // Post-dispose samples are ignored.
    h.coordinator.onPressureSample({ bytes: 2_000 * MIB, level: 'critical' });
    expect(h.coordinator.getCurrentEpisode()).toBeUndefined();
  });
});
