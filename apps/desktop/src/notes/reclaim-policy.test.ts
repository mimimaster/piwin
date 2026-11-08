import { describe, expect, it } from 'vitest';
import {
  RECLAIM_ADMISSION_KEY,
  RECLAIM_PURGE_KEY,
  SLICE_BUDGET_MS,
  SLICE_MAX_COUNT,
  SLICE_TARGET_BYTES,
  selectReclaimAction,
  type ReclaimCandidate,
  type ReclaimPolicyInput,
} from './reclaim-policy';

const MIB = 1024 * 1024;

function candidate(overrides: Partial<ReclaimCandidate> = {}): ReclaimCandidate {
  return {
    kind: 'cache-entries',
    key: 'cache:a',
    estimatedBytes: MIB,
    protectionScore: 0,
    lastTouchedMs: 1_000,
    restoreCost: 0.5,
    ...overrides,
  };
}

function input(overrides: Partial<ReclaimPolicyInput> = {}): ReclaimPolicyInput {
  return {
    level: 'critical',
    nowMs: 1_000,
    candidates: [],
    attemptedKeys: new Set(),
    ...overrides,
  };
}

describe('selectReclaimAction', () => {
  it('emits admission-first exactly once, before any release', () => {
    const first = selectReclaimAction(input({ candidates: [candidate()] }));
    expect(first).toEqual({ type: 'admission-first', reason: expect.any(String) });

    // Once the executor records the marker, the policy moves to releases.
    const second = selectReclaimAction(
      input({
        candidates: [candidate()],
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]),
      }),
    );
    expect(second.type).toBe('release-slice');
    // Admission ordering is never re-emitted mid-episode.
    const third = selectReclaimAction(
      input({ attemptedKeys: new Set([RECLAIM_ADMISSION_KEY, 'cache:a']) }),
    );
    expect(third.type).not.toBe('admission-first');
  });

  it('sorts by protectionScore asc, then oldest first, then largest', () => {
    const candidates = [
      candidate({ key: 'c:new-big', lastTouchedMs: 10, estimatedBytes: 8 * MIB }),
      candidate({ key: 'b:protected', protectionScore: 5, lastTouchedMs: 99 }),
      candidate({ key: 'a:old', lastTouchedMs: 500, estimatedBytes: MIB }),
      candidate({ key: 'd:new-small', lastTouchedMs: 10, estimatedBytes: MIB }),
    ];
    const action = selectReclaimAction(
      input({ candidates, attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]) }),
    );
    expect(action.type).toBe('release-slice');
    if (action.type !== 'release-slice') return;
    expect(action.keys[0]).toBe('a:old'); // same score → oldest wins
    expect(action.keys[1]).toBe('c:new-big'); // same age → fattest wins
    expect(action.keys.indexOf('b:protected')).toBe(action.keys.length - 1);
  });

  it('skips Infinite-protection candidates entirely', () => {
    const action = selectReclaimAction(
      input({
        candidates: [
          candidate({ key: 'visible', protectionScore: Number.POSITIVE_INFINITY }),
          candidate({ key: 'plain' }),
        ],
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]),
      }),
    );
    expect(action.type).toBe('release-slice');
    if (action.type !== 'release-slice') return;
    expect(action.keys).toEqual(['plain']);
  });

  it('skips already-attempted keys', () => {
    const action = selectReclaimAction(
      input({
        candidates: [candidate({ key: 'done' }), candidate({ key: 'fresh' })],
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY, 'done']),
      }),
    );
    expect(action.type).toBe('release-slice');
    if (action.type !== 'release-slice') return;
    expect(action.keys).toEqual(['fresh']);
  });

  it('stops the slice once SLICE_TARGET_BYTES is covered', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate({ key: `c${i}`, estimatedBytes: 2 * MIB, lastTouchedMs: i }),
    );
    const action = selectReclaimAction(
      input({ candidates, attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]) }),
    );
    if (action.type !== 'release-slice') throw new Error('expected release-slice');
    // 16 MiB / 2 MiB = 8 items — also hits SLICE_MAX_COUNT, but target first.
    expect(action.keys).toHaveLength(SLICE_TARGET_BYTES / (2 * MIB));
    expect(action.keys.length).toBeLessThanOrEqual(SLICE_MAX_COUNT);
  });

  it('caps the slice at SLICE_MAX_COUNT for tiny candidates', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate({ key: `c${i}`, estimatedBytes: 1, lastTouchedMs: i }),
    );
    const action = selectReclaimAction(
      input({ candidates, attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]) }),
    );
    if (action.type !== 'release-slice') throw new Error('expected release-slice');
    expect(action.keys).toHaveLength(SLICE_MAX_COUNT);
  });

  it('carries deadlineMs = nowMs + SLICE_BUDGET_MS', () => {
    const action = selectReclaimAction(
      input({ nowMs: 5_000, candidates: [candidate()], attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]) }),
    );
    if (action.type !== 'release-slice') throw new Error('expected release-slice');
    expect(action.deadlineMs).toBe(5_000 + SLICE_BUDGET_MS);
  });

  it('zero candidates → observe at the next point → terminal after the last', () => {
    const attempted = new Set([RECLAIM_ADMISSION_KEY]);
    const waiting = selectReclaimAction(
      input({ attemptedKeys: attempted, nextObservationAtMs: 12_000, nowMs: 1_000 }),
    );
    expect(waiting).toEqual({
      type: 'observe',
      waitUntilMs: 12_000,
      reason: expect.any(String),
    });

    // Past the final observation with no candidates at all → no-progress.
    const done = selectReclaimAction(input({ attemptedKeys: attempted, nowMs: 40_000 }));
    expect(done).toMatchObject({ type: 'episode-terminal', outcome: 'no-progress' });
  });

  it('protected-only candidates → protected-over-budget after the last observation', () => {
    const done = selectReclaimAction(
      input({
        candidates: [candidate({ protectionScore: Number.POSITIVE_INFINITY })],
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]),
      }),
    );
    expect(done).toMatchObject({ type: 'episode-terminal', outcome: 'protected-over-budget' });
  });

  it('fires native-purge once, only after a release round completed', () => {
    // No release attempted yet → purge is NOT offered.
    const early = selectReclaimAction(
      input({
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]),
        nextObservationAtMs: 12_000,
      }),
    );
    expect(early.type).toBe('observe');

    // A release ran, purge marker absent → offer native-purge.
    const offered = selectReclaimAction(
      input({
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY, 'cache:a']),
        nextObservationAtMs: 12_000,
      }),
    );
    expect(offered.type).toBe('native-purge');

    // Purge marker present → never again this episode.
    const after = selectReclaimAction(
      input({
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY, 'cache:a', RECLAIM_PURGE_KEY]),
        nextObservationAtMs: 12_000,
      }),
    );
    expect(after.type).toBe('observe');
  });

  it('holds observe while awaiting a fresh sample, even past the point', () => {
    const action = selectReclaimAction(
      input({
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]),
        awaitingSample: true,
        nextObservationAtMs: 1_000, // already due
        nowMs: 5_000,
      }),
    );
    expect(action.type).toBe('observe');
    if (action.type !== 'observe') return;
    expect(action.waitUntilMs).toBe(1_000);
  });

  it('suppresses releases while awaiting a fresh sample', () => {
    const action = selectReclaimAction(
      input({
        candidates: [candidate()],
        attemptedKeys: new Set([RECLAIM_ADMISSION_KEY]),
        awaitingSample: true,
        nextObservationAtMs: 9_000,
        nowMs: 5_000,
      }),
    );
    expect(action.type).toBe('observe');
  });
});
