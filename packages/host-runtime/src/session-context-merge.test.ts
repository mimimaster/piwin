import { describe, expect, it } from 'vitest';
import type { ContextOccupancy, SessionContextSnapshot } from '@piwin/contracts';
import {
  applyMeasurement,
  applyCompactionEnd,
  applyActivationRevalidate,
  applyResponseEvidence,
  applyRunStarted,
  applyRunTerminal,
  occupancyEqual,
  snapshotPersistEqual,
} from './session-context-merge.js';

const sampledAt = '2026-08-30T00:00:00.000Z';

function knownOccupancy(tokensUsed: number): Extract<ContextOccupancy, { kind: 'known' }> {
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

function idleKnown(): SessionContextSnapshot {
  return {
    sessionId: 'session-1',
    revision: 3,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: 'leaf-1' },
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: true,
    },
    phase: 'idle',
    occupancy: knownOccupancy(8_000),
    lastConfirmed: {
      occupancy: knownOccupancy(8_000),
      contextBoundary: { activeLeafMessageId: 'leaf-1' },
      sampledAt,
    },
    updatedAt: sampledAt,
  };
}

describe('session context merge lastConfirmed promote', () => {
  it('restores history evidence from a durable compaction boundary after a crash gap', () => {
    const restored = applyActivationRevalidate(
      {
        ...idleKnown(),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: false,
        },
      },
      {
        nowIso: '2026-08-30T00:01:00.000Z',
        runtimeGenerationId: 'generation-after-restart',
        contextBoundary: {
          activeLeafMessageId: 'leaf-1',
          compactionBoundary: 'compact:80000:5000',
        },
      },
    );

    expect(restored.responseEvidence.historyHasDisplayableResponse).toBe(true);
    expect(restored.contextBoundary.compactionBoundary).toBe('compact:80000:5000');
  });

  it('treats successful compaction as history evidence even without a visible response row', () => {
    const snapshot: SessionContextSnapshot = {
      ...idleKnown(),
      responseEvidence: {
        currentRunHasResponse: false,
        historyHasDisplayableResponse: false,
      },
    };
    const compacted = applyCompactionEnd(snapshot, {
      nowIso: '2026-08-30T00:01:00.000Z',
      ok: true,
      tokensBefore: 80_000,
      tokensAfter: 5_000,
    });
    expect(compacted.responseEvidence).toMatchObject({
      currentRunHasResponse: false,
      historyHasDisplayableResponse: true,
    });
    expect(compacted.occupancy).toMatchObject({ kind: 'known', tokensUsed: 5_000 });
    expect(compacted.contextBoundary.compactionBoundary).toBe('compact:80000:5000');
  });

  it('keeps history evidence when a successful compact has no post-compact token sample', () => {
    const compacted = applyCompactionEnd(
      {
        ...idleKnown(),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: false,
        },
      },
      { nowIso: '2026-08-30T00:01:00.000Z', ok: true, tokensBefore: 80_000 },
    );
    expect(compacted.responseEvidence.historyHasDisplayableResponse).toBe(true);
    expect(compacted.occupancy).toEqual({ kind: 'unknown', reason: 'compaction-unmeasured' });
    expect(compacted.lastConfirmed).toBeUndefined();
  });

  it('promotes lastConfirmed when response evidence arrives after waiting samples', () => {
    const waiting = applyRunStarted(idleKnown(), {
      nowIso: '2026-08-30T00:01:00.000Z',
      runId: 'run-2',
    });
    expect(waiting.occupancy).toEqual({ kind: 'unknown', reason: 'waiting-for-response' });
    expect(waiting.lastConfirmed?.occupancy.tokensUsed).toBe(8_000);

    const sampled = applyMeasurement(
      waiting,
      {
        sessionId: 'session-1',
        sampleSequence: 1,
        occupancy: knownOccupancy(9_100),
        contextBoundary: { activeLeafMessageId: 'leaf-1' },
        sampledAt,
      },
      { nowIso: '2026-08-30T00:01:00.500Z' },
    );
    expect(sampled.drop).toBe(false);
    expect(sampled.snapshot.occupancy).toEqual({ kind: 'unknown', reason: 'waiting-for-response' });
    expect(sampled.snapshot.lastConfirmed?.occupancy.tokensUsed).toBe(9_100);

    const evidenced = applyResponseEvidence(sampled.snapshot, {
      nowIso: '2026-08-30T00:01:01.000Z',
      runId: 'run-2',
      messageId: 'msg-new',
    });
    expect(evidenced.snapshot.occupancy).toEqual(knownOccupancy(9_100));
    expect(evidenced.snapshot.phase).toBe('streaming');
    expect(evidenced.snapshot.responseEvidence.currentRunHasResponse).toBe(true);
    expect(evidenced.snapshot.responseEvidence.evidenceMessageId).toBe('msg-new');
    expect(evidenced.snapshot.contextBoundary.activeLeafMessageId).toBe('msg-new');
    expect(evidenced.snapshot.coveredMessageId).toBe('msg-new');
    expect(evidenced.immediate).toBe(true);
  });

  it('does not promote lastConfirmed while the current run is still waiting', () => {
    const waiting = applyRunStarted(idleKnown(), {
      nowIso: '2026-08-30T00:01:00.000Z',
      runId: 'run-2',
    });
    expect(waiting.phase).toBe('waiting-response');
    expect(waiting.occupancy.kind).toBe('unknown');
    expect(waiting.lastConfirmed?.occupancy.tokensUsed).toBe(8_000);
  });

  it('promotes lastConfirmed on terminal after a response; first-turn cancel stays unknown', () => {
    const waiting = applyRunStarted(idleKnown(), {
      nowIso: '2026-08-30T00:01:00.000Z',
      runId: 'run-2',
    });
    const evidenced = applyResponseEvidence(waiting, {
      nowIso: '2026-08-30T00:01:01.000Z',
      runId: 'run-2',
      messageId: 'msg-new',
    });
    const finished = applyRunTerminal(evidenced.snapshot, {
      nowIso: '2026-08-30T00:01:02.000Z',
      runId: 'run-2',
    });
    expect(finished.runId).toBeUndefined();
    expect(finished.phase).toBe('idle');
    expect(finished.occupancy).toEqual(knownOccupancy(8_000));

    const emptyStart: SessionContextSnapshot = {
      ...idleKnown(),
      occupancy: { kind: 'unknown', reason: 'never-sampled' },
      responseEvidence: {
        currentRunHasResponse: false,
        historyHasDisplayableResponse: false,
      },
    };
    delete emptyStart.lastConfirmed;
    const firstWait = applyRunStarted(emptyStart, {
      nowIso: '2026-08-30T00:02:00.000Z',
      runId: 'run-1',
    });
    const cancelled = applyRunTerminal(firstWait, {
      nowIso: '2026-08-30T00:02:01.000Z',
      runId: 'run-1',
    });
    expect(cancelled.occupancy).toEqual({ kind: 'unknown', reason: 'run-ended-without-response' });
    expect(cancelled.phase).toBe('empty');
  });

  it('promotes lastConfirmed when a later run ends without response but history exists', () => {
    const waiting = applyRunStarted(idleKnown(), {
      nowIso: '2026-08-30T00:01:00.000Z',
      runId: 'run-2',
    });
    const ended = applyRunTerminal(waiting, {
      nowIso: '2026-08-30T00:01:03.000Z',
      runId: 'run-2',
    });
    expect(ended.occupancy).toEqual(knownOccupancy(8_000));
    expect(ended.phase).toBe('idle');
  });
});

describe('snapshot persist equality', () => {
  it('ignores revision/updatedAt but not lastConfirmed or authority fields', () => {
    const base = idleKnown();
    const lastConfirmed = base.lastConfirmed;
    if (lastConfirmed === undefined) {
      throw new Error('expected lastConfirmed');
    }
    expect(
      snapshotPersistEqual(base, { ...base, revision: 99, updatedAt: '2026-08-31T00:00:00.000Z' }),
    ).toBe(true);
    expect(
      snapshotPersistEqual(base, {
        ...base,
        lastConfirmed: {
          occupancy: knownOccupancy(200),
          contextBoundary: lastConfirmed.contextBoundary,
          sampledAt: lastConfirmed.sampledAt,
        },
      }),
    ).toBe(false);
    expect(
      snapshotPersistEqual(base, {
        ...base,
        contextBoundary: { activeLeafMessageId: 'leaf-2' },
      }),
    ).toBe(false);
    expect(snapshotPersistEqual(base, { ...base, coveredMessageId: 'msg-2' })).toBe(false);
    expect(snapshotPersistEqual(base, { ...base, coveredRequestId: 'req-2' })).toBe(false);
    expect(
      snapshotPersistEqual(base, {
        ...base,
        responseEvidence: {
          ...base.responseEvidence,
          evidenceMessageId: 'msg-evidence',
        },
      }),
    ).toBe(false);
    expect(
      occupancyEqual(knownOccupancy(8_000), {
        ...knownOccupancy(8_000),
        sampledAt: '2026-08-31T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      snapshotPersistEqual(base, {
        ...base,
        occupancy: { ...knownOccupancy(8_000), sampledAt: '2026-08-31T00:00:00.000Z' },
      }),
    ).toBe(false);
    expect(
      snapshotPersistEqual(base, {
        ...base,
        lastConfirmed: {
          occupancy: lastConfirmed.occupancy,
          contextBoundary: lastConfirmed.contextBoundary,
          sampledAt: '2026-08-31T00:00:00.000Z',
        },
      }),
    ).toBe(false);
  });
});
