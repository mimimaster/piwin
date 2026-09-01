import { describe, expect, it } from 'vitest';
import type { ContextBoundary, ContextOccupancy, SessionContextSnapshot } from './context-telemetry.js';
import {
  CONTEXT_TELEMETRY_VERSION,
  canPromoteLastConfirmed,
  createUnknownSessionContextSnapshot,
  isFiniteNonNegative,
  parseSessionContextSnapshot,
  promoteLastConfirmed,
  ringOccupancyFromSnapshot,
} from './context-telemetry.js';

type UnknownOccupancy = Extract<ContextOccupancy, { kind: 'unknown' }>;
type UnknownKeys = keyof UnknownOccupancy;
type UnknownHasOnlyKindAndReason = UnknownKeys extends 'kind' | 'reason'
  ? 'kind' | 'reason' extends UnknownKeys
    ? true
    : false
  : false;
const unknownOccupancyHasOnlyKindAndReason: UnknownHasOnlyKindAndReason = true;

const boundary = { activeLeafMessageId: 'leaf-1' };

function knownOccupancy() {
  return {
    kind: 'known' as const,
    tokensUsed: 12,
    tokensLimit: 128_000,
    quality: 'measured' as const,
    coverage: 'complete' as const,
    basis: 'pi-contextUsage',
    sampledAt: '2026-08-30T00:00:00.000Z',
  };
}

function validSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'session-1',
    revision: 1,
    contextVersion: 1,
    contextBoundary: boundary,
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: false,
    },
    phase: 'idle',
    occupancy: { kind: 'unknown', reason: 'not-sampled' },
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function lastConfirmedOf(contextBoundary: ContextBoundary = boundary) {
  return {
    occupancy: knownOccupancy(),
    contextBoundary,
    sampledAt: '2026-08-30T00:00:01.000Z',
  };
}

function idleDirtySnapshot(overrides: Partial<SessionContextSnapshot> = {}): SessionContextSnapshot {
  return {
    sessionId: 'session-1',
    revision: 4,
    contextVersion: 2,
    contextBoundary: boundary,
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: true,
    },
    phase: 'idle',
    occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
    lastConfirmed: lastConfirmedOf(),
    updatedAt: '2026-08-30T00:00:02.000Z',
    ...overrides,
  };
}

describe('context telemetry contracts', () => {
  it('keeps unknown occupancy a closed kind/reason pair', () => {
    expect(unknownOccupancyHasOnlyKindAndReason).toBe(true);
    const occupancy: UnknownOccupancy = { kind: 'unknown', reason: 'cold' };
    expect('tokensUsed' in occupancy).toBe(false);
    expect(CONTEXT_TELEMETRY_VERSION).toBe(1);
  });

  it('createUnknownSessionContextSnapshot always uses unknown occupancy', () => {
    const snapshot = createUnknownSessionContextSnapshot({
      sessionId: 'session-1',
      revision: 1,
      contextVersion: 1,
      contextBoundary: boundary,
      reason: 'never-sampled',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });
    expect(snapshot.occupancy.kind).toBe('unknown');
    if (snapshot.occupancy.kind !== 'unknown') {
      throw new Error('expected unknown occupancy');
    }
    expect(snapshot.occupancy.reason).toBe('never-sampled');
    expect(snapshot.responseEvidence.currentRunHasResponse).toBe(false);
    expect(parseSessionContextSnapshot(snapshot)).toEqual(snapshot);
  });

  it('parses a known occupancy snapshot and rejects illegal numeric samples', () => {
    const parsed = parseSessionContextSnapshot(
      validSnapshot({ occupancy: knownOccupancy(), runId: 'run-1' }),
    );
    expect(parsed?.occupancy).toEqual(knownOccupancy());
    expect(parsed?.runId).toBe('run-1');

    expect(isFiniteNonNegative(0)).toBe(true);
    expect(isFiniteNonNegative(1.5)).toBe(true);
    expect(isFiniteNonNegative(-1)).toBe(false);
    expect(isFiniteNonNegative(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNonNegative(Number.NaN)).toBe(false);

    expect(
      parseSessionContextSnapshot(
        validSnapshot({ occupancy: { ...knownOccupancy(), tokensUsed: Number.POSITIVE_INFINITY } }),
      ),
    ).toBeNull();
    expect(
      parseSessionContextSnapshot(
        validSnapshot({ occupancy: { ...knownOccupancy(), tokensUsed: Number.NaN } }),
      ),
    ).toBeNull();
    expect(
      parseSessionContextSnapshot(
        validSnapshot({ occupancy: { ...knownOccupancy(), tokensUsed: -1 } }),
      ),
    ).toBeNull();
    expect(
      parseSessionContextSnapshot(
        validSnapshot({ occupancy: { ...knownOccupancy(), tokensLimit: 0 } }),
      ),
    ).toBeNull();
    expect(
      parseSessionContextSnapshot(
        validSnapshot({ occupancy: { ...knownOccupancy(), tokensLimit: Number.NEGATIVE_INFINITY } }),
      ),
    ).toBeNull();
  });

  it('rejects unknown occupancy that carries tokensUsed and incomplete snapshots', () => {
    expect(
      parseSessionContextSnapshot(
        validSnapshot({
          occupancy: { kind: 'unknown', reason: 'cold', tokensUsed: 12 },
        }),
      ),
    ).toBeNull();
    expect(parseSessionContextSnapshot(validSnapshot({ revision: 0 }))).toBeNull();
    expect(parseSessionContextSnapshot(validSnapshot({ contextVersion: 1.5 }))).toBeNull();
    expect(parseSessionContextSnapshot(null)).toBeNull();
    expect(parseSessionContextSnapshot(validSnapshot({ occupancy: { kind: 'known' } }))).toBeNull();
  });

  it('round-trips lastConfirmed only when occupancy is known', () => {
    const snapshot: SessionContextSnapshot = {
      sessionId: 'session-1',
      revision: 2,
      contextVersion: 3,
      contextBoundary: boundary,
      responseEvidence: {
        currentRunHasResponse: true,
        historyHasDisplayableResponse: true,
        evidenceMessageId: 'msg-9',
      },
      phase: 'streaming',
      occupancy: knownOccupancy(),
      lastConfirmed: {
        occupancy: knownOccupancy(),
        contextBoundary: boundary,
        sampledAt: '2026-08-30T00:00:01.000Z',
      },
      updatedAt: '2026-08-30T00:00:02.000Z',
    };
    expect(parseSessionContextSnapshot(snapshot)).toEqual(snapshot);
    expect(
      parseSessionContextSnapshot(
        validSnapshot({
          lastConfirmed: {
            occupancy: { kind: 'unknown', reason: 'stale' },
            contextBoundary: boundary,
            sampledAt: '2026-08-30T00:00:01.000Z',
          },
        }),
      ),
    ).toBeNull();
  });

  it('promotes idle unknown waiting-for-response with history evidence and same boundary', () => {
    const snapshot = idleDirtySnapshot();
    expect(canPromoteLastConfirmed(snapshot)).toBe(true);
    const promoted = promoteLastConfirmed(snapshot);
    expect(promoted.occupancy).toEqual(knownOccupancy());
    expect(promoted.phase).toBe('idle');
    expect(promoted.lastConfirmed).toEqual(snapshot.lastConfirmed);
    expect(promoted.contextVersion).toBe(2);
    expect(promoted.revision).toBe(4);
  });

  it('promotes idle unknown run-ended-without-response with history evidence and same boundary', () => {
    const snapshot = idleDirtySnapshot({
      occupancy: { kind: 'unknown', reason: 'run-ended-without-response' },
    });
    expect(canPromoteLastConfirmed(snapshot)).toBe(true);
    expect(promoteLastConfirmed(snapshot).occupancy).toEqual(knownOccupancy());
  });

  it('does not promote a live waiting-response snapshot without current-run response', () => {
    const waiting = idleDirtySnapshot({
      phase: 'waiting-response',
      runId: 'run-2',
    });
    expect(canPromoteLastConfirmed(waiting)).toBe(false);
    expect(promoteLastConfirmed(waiting)).toBe(waiting);
  });

  it('does not promote runtime-generation-mismatch after invalidate with a moved leaf', () => {
    const snapshot = idleDirtySnapshot({
      phase: 'invalidated',
      occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
      contextBoundary: { activeLeafMessageId: 'voice-live-leaf' },
    });
    expect(canPromoteLastConfirmed(snapshot)).toBe(false);
    expect(promoteLastConfirmed(snapshot)).toBe(snapshot);
  });

  it('does not promote abort, compaction, store, branch/schema, or empty snapshots', () => {
    const blocked: SessionContextSnapshot[] = [
      idleDirtySnapshot({ occupancy: { kind: 'unknown', reason: 'error-or-aborted-usage' } }),
      idleDirtySnapshot({ occupancy: { kind: 'unknown', reason: 'compaction-unmeasured' } }),
      idleDirtySnapshot({
        phase: 'unavailable',
        occupancy: { kind: 'unknown', reason: 'store-unavailable' },
      }),
      idleDirtySnapshot({
        phase: 'invalidated',
        occupancy: { kind: 'unknown', reason: 'branch-switch' },
      }),
      idleDirtySnapshot({
        phase: 'invalidated',
        occupancy: { kind: 'unknown', reason: 'schema-or-session-mismatch' },
      }),
      idleDirtySnapshot({
        phase: 'empty',
        occupancy: { kind: 'unknown', reason: 'never-sampled' },
      }),
    ];
    for (const snapshot of blocked) {
      expect(canPromoteLastConfirmed(snapshot)).toBe(false);
      expect(promoteLastConfirmed(snapshot)).toBe(snapshot);
    }
    const { lastConfirmed: _dropped, ...withoutConfirmed } = idleDirtySnapshot();
    expect(canPromoteLastConfirmed(withoutConfirmed)).toBe(false);
  });

  it('does not promote when model, compaction, capability, seed, or stamped leaf disagree', () => {
    const incompatible: SessionContextSnapshot[] = [
      idleDirtySnapshot({
        lastConfirmed: lastConfirmedOf({
          activeLeafMessageId: 'leaf-1',
          model: { providerId: 'openai', modelId: 'gpt-4' },
        }),
        contextBoundary: {
          activeLeafMessageId: 'leaf-1',
          model: { providerId: 'anthropic', modelId: 'claude-3' },
        },
      }),
      idleDirtySnapshot({
        lastConfirmed: lastConfirmedOf({
          activeLeafMessageId: 'leaf-1',
          compactionBoundary: 'compact:before',
        }),
        contextBoundary: { activeLeafMessageId: 'leaf-1', compactionBoundary: 'compact:after' },
      }),
      idleDirtySnapshot({
        lastConfirmed: lastConfirmedOf({
          activeLeafMessageId: 'leaf-1',
          capabilityFingerprint: 'cap-a',
        }),
        contextBoundary: { activeLeafMessageId: 'leaf-1', capabilityFingerprint: 'cap-b' },
      }),
      idleDirtySnapshot({
        lastConfirmed: lastConfirmedOf({
          activeLeafMessageId: 'leaf-1',
          seedFingerprint: 'seed-a',
        }),
        contextBoundary: { activeLeafMessageId: 'leaf-1', seedFingerprint: 'seed-b' },
      }),
      idleDirtySnapshot({
        contextBoundary: { activeLeafMessageId: 'other-leaf' },
      }),
    ];
    for (const snapshot of incompatible) {
      expect(canPromoteLastConfirmed(snapshot)).toBe(false);
      expect(promoteLastConfirmed(snapshot)).toBe(snapshot);
    }
  });

  it('does not change contextVersion, revision, or turn invalidated into idle', () => {
    const idle = idleDirtySnapshot();
    const promotedIdle = promoteLastConfirmed(idle);
    expect(promotedIdle.contextVersion).toBe(idle.contextVersion);
    expect(promotedIdle.revision).toBe(idle.revision);
    expect(promotedIdle.phase).toBe('idle');

    const invalidated = idleDirtySnapshot({
      phase: 'invalidated',
      occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
      contextBoundary: { activeLeafMessageId: 'voice-live-leaf' },
    });
    const promotedInvalidated = promoteLastConfirmed(invalidated);
    expect(promotedInvalidated).toBe(invalidated);
    expect(promotedInvalidated.phase).toBe('invalidated');
    expect(promotedInvalidated.contextVersion).toBe(2);
    expect(promotedInvalidated.revision).toBe(4);
  });

  it('returns current known occupancy only and does not fall back to lastConfirmed', () => {
    expect(ringOccupancyFromSnapshot(idleDirtySnapshot({ occupancy: knownOccupancy() }))).toEqual(
      knownOccupancy(),
    );
    expect(ringOccupancyFromSnapshot(idleDirtySnapshot())).toBeNull();
    expect(
      ringOccupancyFromSnapshot(
        idleDirtySnapshot({
          phase: 'invalidated',
          occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
          contextBoundary: { activeLeafMessageId: 'voice-live-leaf' },
        }),
      ),
    ).toBeNull();
    expect(
      ringOccupancyFromSnapshot(
        idleDirtySnapshot({
          phase: 'unavailable',
          occupancy: { kind: 'unknown', reason: 'store-unavailable' },
        }),
      ),
    ).toBeNull();
    expect(
      ringOccupancyFromSnapshot(
        idleDirtySnapshot({
          phase: 'waiting-response',
          runId: 'run-2',
        }),
      ),
    ).toBeNull();
  });
});
