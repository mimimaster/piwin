import { describe, expect, it } from 'vitest';
import {
  applyContextTelemetry,
  createInitialContextTelemetryState,
} from './context-telemetry-reducer.js';
import {
  makeContextSnapshot,
  makeKnownOccupancy,
  makeLastRequest,
} from './context-telemetry-test-fixtures.js';

describe('context telemetry reducer (T05)', () => {
  it('T05: hydrate rev10 after live rev11 keeps 11; duplicate 11 is a no-op', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    const live11 = makeContextSnapshot({
      sessionId: 'session-a',
      revision: 11,
      phase: 'streaming',
      occupancy: makeKnownOccupancy({ tokensUsed: 90_000, tokensLimit: 128_000 }),
      responseEvidence: {
        currentRunHasResponse: true,
        historyHasDisplayableResponse: true,
        evidenceMessageId: 'a1',
      },
    });
    state = applyContextTelemetry(state, { type: 'snapshot', snapshot: live11, source: 'live' });
    expect(state.displayed?.revision).toBe(11);

    const hydrate10 = makeContextSnapshot({
      sessionId: 'session-a',
      revision: 10,
      phase: 'idle',
      occupancy: makeKnownOccupancy({ tokensUsed: 40_000, tokensLimit: 128_000 }),
    });
    const afterHydrate = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: hydrate10,
      source: 'hydrate',
    });
    expect(afterHydrate.displayed?.revision).toBe(11);
    expect(afterHydrate.displayed?.occupancy).toEqual(live11.occupancy);

    const duplicate = applyContextTelemetry(afterHydrate, {
      type: 'snapshot',
      snapshot: { ...live11 },
      source: 'live',
    });
    expect(duplicate).toBe(afterHydrate);
  });

  it('T05: accepts a snapshot for the selected session while transcript is still loading', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    const snapshot = makeContextSnapshot({
      sessionId: 'session-a',
      revision: 2,
      phase: 'streaming',
      occupancy: makeKnownOccupancy({ tokensUsed: 12_000 }),
      responseEvidence: {
        currentRunHasResponse: true,
        historyHasDisplayableResponse: true,
      },
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot,
      source: 'live',
      awaitingTranscript: true,
    });
    expect(state.displayed?.revision).toBe(2);
    expect(state.displayed?.occupancy).toEqual(snapshot.occupancy);
  });

  it('drops another session snapshot and older revisions on the same HostInstance', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 4,
        occupancy: makeKnownOccupancy({ tokensUsed: 10 }),
      }),
      source: 'live',
    });
    const other = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-b',
        revision: 9,
        occupancy: makeKnownOccupancy({ tokensUsed: 99 }),
      }),
      source: 'live',
    });
    expect(other.displayed?.sessionId).toBe('session-a');
    expect(other.displayed?.revision).toBe(4);

    const older = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 3,
        occupancy: makeKnownOccupancy({ tokensUsed: 1 }),
      }),
      source: 'replay',
    });
    expect(older).toBe(state);
  });

  it('HostInstance change resets the slice instead of ordering by Date.now', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 8,
        occupancy: makeKnownOccupancy({ tokensUsed: 50_000 }),
        updatedAt: '2026-08-30T12:00:00.000Z',
      }),
      source: 'live',
    });
    state = applyContextTelemetry(state, { type: 'host-instance', hostInstanceId: 'host-2' });
    expect(state.displayed).toBeNull();
    expect(state.warmOrder).toEqual([]);
    expect(state.hostInstanceId).toBe('host-2');

    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-2',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 1,
        occupancy: makeKnownOccupancy({ tokensUsed: 3 }),
        updatedAt: '2026-08-29T00:00:00.000Z',
      }),
      source: 'hydrate',
    });
    expect(state.displayed?.revision).toBe(1);
    expect(state.displayed?.occupancy).toEqual(makeKnownOccupancy({ tokensUsed: 3 }));
  });

  it('failure/unknown occupancy is explicit and does not keep a previous known sample by omission', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 2,
        occupancy: makeKnownOccupancy({ tokensUsed: 80_000 }),
      }),
      source: 'live',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 3,
        phase: 'unavailable',
        occupancy: { kind: 'unknown', reason: 'store-write-failed' },
      }),
      source: 'live',
    });
    expect(state.displayed?.occupancy).toEqual({
      kind: 'unknown',
      reason: 'store-write-failed',
    });
    expect(state.displayed?.phase).toBe('unavailable');
  });

  it('switching away clears the displayed projection and does not reuse another session snapshot', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 2,
        occupancy: makeKnownOccupancy({ tokensUsed: 70_000 }),
      }),
      source: 'live',
    });
    const afterSwitch = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-b',
      hostInstanceId: 'host-1',
    });
    expect(afterSwitch.displayed).toBeNull();
    expect(afterSwitch.selectedSessionId).toBe('session-b');
    expect(afterSwitch.lastRequestUsage).toBeNull();
  });

  it('lastRequestUsage is a separate field bound to a message id', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    const occupancy = makeContextSnapshot({
      sessionId: 'session-a',
      revision: 2,
      occupancy: makeKnownOccupancy({ tokensUsed: 90_000 }),
    });
    state = applyContextTelemetry(state, { type: 'snapshot', snapshot: occupancy, source: 'live' });
    const usage = makeLastRequest({ messageId: 'assistant-42', promptTokens: 10, totalTokens: 15 });
    state = applyContextTelemetry(state, {
      type: 'last-request',
      sessionId: 'session-a',
      usage,
    });
    expect(state.lastRequestUsage?.messageId).toBe('assistant-42');
    expect(state.displayed?.occupancy).toEqual(occupancy.occupancy);
    expect(state.lastRequestUsage?.totalTokens).toBe(15);
  });

  it('bounded warm set restores only the matching session on return', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        revision: 5,
        occupancy: makeKnownOccupancy({ tokensUsed: 21 }),
      }),
      source: 'live',
    });
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-b',
      hostInstanceId: 'host-1',
    });
    expect(state.displayed).toBeNull();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    expect(state.displayed?.revision).toBe(5);
    expect(state.displayed?.occupancy).toEqual(makeKnownOccupancy({ tokensUsed: 21 }));
  });
});
