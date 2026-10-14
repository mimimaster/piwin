import { describe, expect, it } from 'vitest';
import {
  sessionRowHasLiveActivity,
  sessionRowHasOrderingActivity,
  sessionRowIsWorking,
} from './session-row-working';

const base = {
  sessionId: 's1',
  isDraft: false,
  activeSessionId: 's1' as string | null,
  runPhase: 'idle' as const,
  workingSessionIds: { s1: true } as Record<string, true> | undefined,
};

describe('sessionRowIsWorking', () => {
  it('spins the open session only while the run is streaming', () => {
    expect(sessionRowIsWorking({ ...base, runPhase: 'streaming' })).toBe(true);
    expect(sessionRowIsWorking({ ...base, runPhase: 'idle' })).toBe(false);
    expect(sessionRowIsWorking({ ...base, runPhase: 'pausing' })).toBe(false);
    expect(sessionRowIsWorking({ ...base, runPhase: 'aborting' })).toBe(false);
  });

  it('ignores a leftover working map on the idle open session', () => {
    expect(
      sessionRowIsWorking({
        ...base,
        runPhase: 'idle',
        workingSessionIds: { s1: true },
      }),
    ).toBe(false);
  });

  it('spins a background session from the working map', () => {
    expect(
      sessionRowIsWorking({
        ...base,
        activeSessionId: 's2',
        runPhase: 'idle',
        workingSessionIds: { s1: true },
      }),
    ).toBe(true);
    expect(
      sessionRowIsWorking({
        ...base,
        activeSessionId: 's2',
        workingSessionIds: {},
      }),
    ).toBe(false);
  });

  it('never spins a local New Agent draft row', () => {
    expect(
      sessionRowIsWorking({
        ...base,
        isDraft: true,
        runPhase: 'streaming',
        workingSessionIds: { s1: true },
      }),
    ).toBe(false);
  });
});

describe('sessionRowHasLiveActivity', () => {
  it('matches the working spinner for streaming and background runs', () => {
    expect(
      sessionRowHasLiveActivity({
        sessionId: 's1',
        activeSessionId: 's1',
        runPhase: 'streaming',
      }),
    ).toBe(true);
    expect(
      sessionRowHasLiveActivity({
        sessionId: 's1',
        activeSessionId: 's2',
        runPhase: 'idle',
        workingSessionIds: { s1: true },
      }),
    ).toBe(true);
  });

  it('treats backend service and permission waits as live activity', () => {
    expect(
      sessionRowHasLiveActivity({
        sessionId: 's1',
        activeSessionId: 's2',
        runPhase: 'idle',
        backendServiceSessionIds: { s1: true },
      }),
    ).toBe(true);
    expect(
      sessionRowHasLiveActivity({
        sessionId: 's1',
        activeSessionId: 's2',
        runPhase: 'idle',
        waitingPermissionSessionIds: { s1: true },
      }),
    ).toBe(true);
  });

  it('does not treat an idle open session as live from a leftover working map', () => {
    expect(
      sessionRowHasLiveActivity({
        sessionId: 's1',
        activeSessionId: 's1',
        runPhase: 'idle',
        workingSessionIds: { s1: true },
      }),
    ).toBe(false);
  });
});

describe('sessionRowHasOrderingActivity', () => {
  it('keeps a selected running session in its live sort bucket during resume', () => {
    expect(
      sessionRowHasOrderingActivity({
        sessionId: 's1',
        activeSessionId: 's1',
        runPhase: 'idle',
        workingSessionIds: { s1: true },
      }),
    ).toBe(true);
  });
});

it('shows and orders real native work in both foreground and background without a Host Run', () => {
  for (const activeSessionId of ['s1', 'another']) {
    const input = { sessionId: 's1', isDraft: false, activeSessionId, runPhase: 'idle' as const, nativeActivity: 'running' as const };
    expect(sessionRowIsWorking(input)).toBe(true);
    expect(sessionRowHasOrderingActivity(input)).toBe(true);
    expect(sessionRowIsWorking({ ...input, nativeActivity: 'idle' })).toBe(false);
    expect(sessionRowHasLiveActivity({ ...input, nativeActivity: 'waiting' })).toBe(true);
  }
});

it('does not keep a settled native turn spinning from an old Desktop projection', () => {
  const input = { sessionId: 'native', isDraft: false, activeSessionId: 'native', runPhase: 'streaming' as const, workingSessionIds: { native: true as const }, nativeActivity: 'idle' as const };
  expect(sessionRowIsWorking(input)).toBe(false);
  expect(sessionRowHasOrderingActivity(input)).toBe(false);
});
