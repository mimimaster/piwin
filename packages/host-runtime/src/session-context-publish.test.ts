import { describe, expect, it } from 'vitest';
import type { ContextOccupancy, SessionContextSnapshot } from '@piwin/contracts';
import { createSessionContextPublisher } from './session-context-publish.js';

const sampledAt = '2026-08-30T00:00:00.000Z';

function knownOccupancy(
  tokensUsed: number,
  at: string = sampledAt,
): Extract<ContextOccupancy, { kind: 'known' }> {
  return {
    kind: 'known',
    tokensUsed,
    tokensLimit: 128_000,
    quality: 'measured',
    coverage: 'complete',
    basis: 'pi-context-usage',
    sampledAt: at,
  };
}

function persistedSnapshot(): SessionContextSnapshot {
  const occupancy = knownOccupancy(100);
  const contextBoundary = { activeLeafMessageId: 'leaf-1' };
  return {
    sessionId: 'session-1',
    revision: 4,
    contextVersion: 2,
    contextBoundary,
    responseEvidence: {
      currentRunHasResponse: true,
      historyHasDisplayableResponse: true,
      evidenceMessageId: 'msg-1',
    },
    phase: 'idle',
    occupancy,
    lastConfirmed: {
      occupancy,
      contextBoundary,
      sampledAt,
    },
    coveredMessageId: 'msg-1',
    coveredRequestId: 'req-1',
    updatedAt: sampledAt,
  };
}

function createHarness() {
  const persistCalls: SessionContextSnapshot[] = [];
  const publisher = createSessionContextPublisher({
    now: () => 1_000,
    persist: async (snapshot) => {
      persistCalls.push(snapshot);
      return { ok: true, snapshot };
    },
    push: () => undefined,
    logUnavailable: () => undefined,
    schedule: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      return {
        clear: () => {
          clearTimeout(handle);
        },
      };
    },
  });
  return { publisher, persistCalls };
}

describe('session context publisher persist equality', () => {
  it('persists lastConfirmed-only tokensUsed changes that leave UI occupancy unchanged', async () => {
    const { publisher, persistCalls } = createHarness();
    const initial = persistedSnapshot();
    publisher.notePersisted(initial);
    const lastConfirmed = initial.lastConfirmed;
    if (lastConfirmed === undefined) {
      throw new Error('expected lastConfirmed');
    }
    const updated: SessionContextSnapshot = {
      ...initial,
      lastConfirmed: {
        occupancy: knownOccupancy(200),
        contextBoundary: lastConfirmed.contextBoundary,
        sampledAt: lastConfirmed.sampledAt,
      },
    };
    const outcome = await publisher.publish(updated, true);
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]?.lastConfirmed?.occupancy.tokensUsed).toBe(200);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') {
      throw new Error('expected persist ok');
    }
    expect(outcome.snapshot.lastConfirmed?.occupancy.tokensUsed).toBe(200);
    const flushed = await publisher.flush();
    expect(flushed?.status).toBe('ok');
    if (flushed === undefined || flushed.status !== 'ok') {
      throw new Error('expected flush ok');
    }
    expect(flushed.snapshot.lastConfirmed?.occupancy.tokensUsed).toBe(200);
  });

  it('does not drop authority-field-only changes as display-equal', async () => {
    const cases: Array<{ name: string; mutate: (snapshot: SessionContextSnapshot) => SessionContextSnapshot }> =
      [
        {
          name: 'contextBoundary',
          mutate: (snapshot) => ({
            ...snapshot,
            contextBoundary: { activeLeafMessageId: 'leaf-2' },
          }),
        },
        {
          name: 'coveredMessageId',
          mutate: (snapshot) => ({ ...snapshot, coveredMessageId: 'msg-2' }),
        },
        {
          name: 'coveredRequestId',
          mutate: (snapshot) => ({ ...snapshot, coveredRequestId: 'req-2' }),
        },
        {
          name: 'evidenceMessageId',
          mutate: (snapshot) => ({
            ...snapshot,
            responseEvidence: {
              ...snapshot.responseEvidence,
              evidenceMessageId: 'msg-evidence',
            },
          }),
        },
        {
          name: 'occupancy sampledAt',
          mutate: (snapshot) => ({
            ...snapshot,
            occupancy:
              snapshot.occupancy.kind === 'known'
                ? { ...snapshot.occupancy, sampledAt: '2026-08-31T00:00:00.000Z' }
                : snapshot.occupancy,
          }),
        },
        {
          name: 'lastConfirmed sampledAt',
          mutate: (snapshot) => {
            const lastConfirmed = snapshot.lastConfirmed;
            if (lastConfirmed === undefined) {
              throw new Error('expected lastConfirmed');
            }
            return {
              ...snapshot,
              lastConfirmed: {
                occupancy: lastConfirmed.occupancy,
                contextBoundary: lastConfirmed.contextBoundary,
                sampledAt: '2026-08-31T00:00:00.000Z',
              },
            };
          },
        },
      ];

    for (const testCase of cases) {
      const { publisher, persistCalls } = createHarness();
      const initial = persistedSnapshot();
      publisher.notePersisted(initial);
      const outcome = await publisher.publish(testCase.mutate(initial), true);
      expect(persistCalls, testCase.name).toHaveLength(1);
      expect(outcome.status, testCase.name).toBe('ok');
    }
  });

  it('skips persist when only revision/updatedAt change', async () => {
    const { publisher, persistCalls } = createHarness();
    const initial = persistedSnapshot();
    publisher.notePersisted(initial);
    const outcome = await publisher.publish(
      { ...initial, revision: 99, updatedAt: '2026-08-31T00:00:00.000Z' },
      true,
    );
    expect(persistCalls).toHaveLength(0);
    expect(outcome.status).toBe('ok');
  });
});
