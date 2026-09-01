import { describe, expect, it } from 'vitest';
import { ringOccupancyFromSnapshot, type ContextOccupancy, type SessionContextSnapshot } from '@piwin/contracts';
import { repairPersistedCrossLeafKnownPollution } from './session-context-persisted-repair.js';

const SAMPLED_AT = '2026-09-01T08:23:05.531Z';
const CURRENT_LEAF = 'voice-live-leaf';
const LAST_LEAF = 'piw-old-leaf';

function knownOccupancy(
  tokensUsed = 7_797,
  sampledAt = SAMPLED_AT,
): Extract<ContextOccupancy, { kind: 'known' }> {
  return {
    kind: 'known',
    tokensUsed,
    tokensLimit: 128_000,
    quality: 'measured',
    coverage: 'complete',
    basis: 'pi-context-usage',
    sampledAt,
  };
}

function pollutionSnapshot(overrides: Partial<SessionContextSnapshot> = {}): SessionContextSnapshot {
  const occupancy = knownOccupancy();
  return {
    sessionId: 'session-repair',
    revision: 4,
    contextVersion: 3,
    contextBoundary: { activeLeafMessageId: CURRENT_LEAF },
    runtimeGenerationId: 'gen-voice',
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: true,
    },
    phase: 'idle',
    occupancy,
    lastConfirmed: {
      occupancy,
      contextBoundary: { activeLeafMessageId: LAST_LEAF },
      sampledAt: SAMPLED_AT,
    },
    coveredMessageId: LAST_LEAF,
    coveredRequestId: 'req-old',
    updatedAt: '2026-09-01T08:23:37.011Z',
    ...overrides,
  };
}

describe('repairPersistedCrossLeafKnownPollution', () => {
  it('demotes the exact old-patch idle known cross-leaf shape and keeps lastConfirmed', () => {
    const snapshot = pollutionSnapshot();
    const repaired = repairPersistedCrossLeafKnownPollution(snapshot);
    expect(repaired).not.toBe(snapshot);
    expect(repaired.phase).toBe('invalidated');
    expect(repaired.occupancy).toEqual({
      kind: 'unknown',
      reason: 'runtime-generation-mismatch',
    });
    expect(repaired.contextVersion).toBe(snapshot.contextVersion);
    expect(repaired.revision).toBe(snapshot.revision);
    expect(repaired.runtimeGenerationId).toBe('gen-voice');
    expect(repaired.contextBoundary).toEqual(snapshot.contextBoundary);
    expect(repaired.lastConfirmed).toEqual(snapshot.lastConfirmed);
    expect(repaired.responseEvidence).toEqual(snapshot.responseEvidence);
    expect(repaired.coveredMessageId).toBeUndefined();
    expect(repaired.coveredRequestId).toBeUndefined();
    expect(repaired.updatedAt).toBe(snapshot.updatedAt);
    expect(ringOccupancyFromSnapshot(repaired)).toBeNull();
  });

  it('does not repair when coveredMessageId equals the current leaf', () => {
    const snapshot = pollutionSnapshot({ coveredMessageId: CURRENT_LEAF });
    expect(repairPersistedCrossLeafKnownPollution(snapshot)).toBe(snapshot);
  });

  it('does not repair normal current measurement, live run, no history, same leaf, or incompatible non-leaf boundary', () => {
    const occupancy = knownOccupancy();
    const cases: Array<{ name: string; snapshot: SessionContextSnapshot }> = [
      {
        name: 'different tokens',
        snapshot: pollutionSnapshot({ occupancy: knownOccupancy(9_001) }),
      },
      {
        name: 'different sampledAt',
        snapshot: pollutionSnapshot({
          occupancy: knownOccupancy(7_797, '2026-09-01T09:00:00.000Z'),
        }),
      },
      {
        name: 'live run',
        snapshot: pollutionSnapshot({ runId: 'run-live' }),
      },
      {
        name: 'no history',
        snapshot: pollutionSnapshot({
          responseEvidence: {
            currentRunHasResponse: false,
            historyHasDisplayableResponse: false,
          },
        }),
      },
      {
        name: 'same leaf',
        snapshot: pollutionSnapshot({
          contextBoundary: { activeLeafMessageId: LAST_LEAF },
        }),
      },
      {
        name: 'empty current leaf',
        snapshot: pollutionSnapshot({
          contextBoundary: { activeLeafMessageId: null },
        }),
      },
      {
        name: 'current-run response',
        snapshot: pollutionSnapshot({
          responseEvidence: {
            currentRunHasResponse: true,
            historyHasDisplayableResponse: true,
          },
        }),
      },
      {
        name: 'model incompatible',
        snapshot: pollutionSnapshot({
          lastConfirmed: {
            occupancy,
            contextBoundary: {
              activeLeafMessageId: LAST_LEAF,
              model: { providerId: 'openai', modelId: 'gpt-4' },
            },
            sampledAt: SAMPLED_AT,
          },
          contextBoundary: {
            activeLeafMessageId: CURRENT_LEAF,
            model: { providerId: 'anthropic', modelId: 'claude-3' },
          },
        }),
      },
      {
        name: 'compaction incompatible',
        snapshot: pollutionSnapshot({
          lastConfirmed: {
            occupancy,
            contextBoundary: {
              activeLeafMessageId: LAST_LEAF,
              compactionBoundary: 'compact:before',
            },
            sampledAt: SAMPLED_AT,
          },
          contextBoundary: {
            activeLeafMessageId: CURRENT_LEAF,
            compactionBoundary: 'compact:after',
          },
        }),
      },
      {
        name: 'capability incompatible',
        snapshot: pollutionSnapshot({
          lastConfirmed: {
            occupancy,
            contextBoundary: {
              activeLeafMessageId: LAST_LEAF,
              capabilityFingerprint: 'cap-a',
            },
            sampledAt: SAMPLED_AT,
          },
          contextBoundary: {
            activeLeafMessageId: CURRENT_LEAF,
            capabilityFingerprint: 'cap-b',
          },
        }),
      },
      {
        name: 'seed incompatible',
        snapshot: pollutionSnapshot({
          lastConfirmed: {
            occupancy,
            contextBoundary: {
              activeLeafMessageId: LAST_LEAF,
              seedFingerprint: 'seed-a',
            },
            sampledAt: SAMPLED_AT,
          },
          contextBoundary: {
            activeLeafMessageId: CURRENT_LEAF,
            seedFingerprint: 'seed-b',
          },
        }),
      },
    ];
    for (const testCase of cases) {
      expect(repairPersistedCrossLeafKnownPollution(testCase.snapshot), testCase.name).toBe(
        testCase.snapshot,
      );
    }
  });

  it('does not repair idle unknown, missing lastConfirmed, or already-invalidated rows', () => {
    const withoutConfirmed = pollutionSnapshot();
    delete withoutConfirmed.lastConfirmed;
    const withoutCovered = pollutionSnapshot();
    delete withoutCovered.coveredMessageId;
    const cases: SessionContextSnapshot[] = [
      pollutionSnapshot({ occupancy: { kind: 'unknown', reason: 'waiting-for-response' } }),
      withoutConfirmed,
      withoutCovered,
      pollutionSnapshot({ phase: 'invalidated' }),
      pollutionSnapshot({ phase: 'waiting-response', runId: 'run-2' }),
      pollutionSnapshot({ phase: 'streaming' }),
    ];
    for (const snapshot of cases) {
      expect(repairPersistedCrossLeafKnownPollution(snapshot)).toBe(snapshot);
    }
  });

  it('still repairs when non-leaf model/capability/seed/compaction axes match', () => {
    const occupancy = knownOccupancy();
    const shared = {
      model: { providerId: 'openai', modelId: 'gpt-4' },
      compactionBoundary: 'compact:same',
      capabilityFingerprint: 'cap-same',
      seedFingerprint: 'seed-same',
    };
    const snapshot = pollutionSnapshot({
      lastConfirmed: {
        occupancy,
        contextBoundary: { activeLeafMessageId: LAST_LEAF, ...shared },
        sampledAt: SAMPLED_AT,
      },
      contextBoundary: { activeLeafMessageId: CURRENT_LEAF, ...shared },
    });
    const repaired = repairPersistedCrossLeafKnownPollution(snapshot);
    expect(repaired.phase).toBe('invalidated');
    expect(repaired.occupancy).toEqual({
      kind: 'unknown',
      reason: 'runtime-generation-mismatch',
    });
    expect(repaired.contextBoundary).toEqual(snapshot.contextBoundary);
    expect(repaired.lastConfirmed).toEqual(snapshot.lastConfirmed);
  });
});
