import { describe, expect, it } from 'vitest';
import type { ContextOccupancy, SessionContextSnapshot } from './context-telemetry.js';
import {
  CONTEXT_TELEMETRY_VERSION,
  createUnknownSessionContextSnapshot,
  isFiniteNonNegative,
  parseSessionContextSnapshot,
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
});
