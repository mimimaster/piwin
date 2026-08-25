import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, HostPush } from '@piwin/contracts';
import {
  applyForegroundRunResponse,
  applyHostPushToForeground,
  foregroundMutationsEnabled,
  initialForegroundRunState,
  knownForegroundRunId,
  reduceForegroundRun,
} from './foreground-run-projection.js';

function activeRun(overrides: Partial<ExecutionRunRecord> = {}): ExecutionRunRecord {
  return {
    runId: 'run-new',
    kind: 'session-turn',
    status: 'running',
    rootRunId: 'run-new',
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('foreground-run projection', () => {
  it('keeps a live Run active when message/end arrives', () => {
    let state = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'run-updated', run: activeRun({ runId: 'run-live' }) },
      'session-1',
    );
    const messageEnd: HostPush = {
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/end', messageId: 'm1', runId: 'run-live' },
    };
    state = applyHostPushToForeground(state, messageEnd, 'session-1');
    expect(state).toMatchObject({ kind: 'active', runId: 'run-live' });
    expect(foregroundMutationsEnabled(state)).toBe(true);
  });

  it('does not let a superseded cancelling run/updated clobber a newer Run', () => {
    let state = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'run-updated', run: activeRun({ runId: 'run-old' }) },
      'session-1',
    );
    state = reduceForegroundRun(
      state,
      { type: 'run-updated', run: activeRun({ runId: 'run-new' }) },
      'session-1',
    );
    state = applyHostPushToForeground(
      state,
      {
        type: 'run/updated',
        run: activeRun({ runId: 'run-old', status: 'cancelling' }),
      },
      'session-1',
    );
    expect(state).toMatchObject({ kind: 'active', runId: 'run-new', status: 'running' });
    state = applyHostPushToForeground(
      state,
      { type: 'run/terminal', run: activeRun({ runId: 'run-old', status: 'cancelled' }) },
      'session-1',
    );
    expect(state).toMatchObject({ kind: 'active', runId: 'run-new' });
  });

  it('updates the same runId through cancelling without replacing it', () => {
    let state = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'run-updated', run: activeRun({ runId: 'run-live' }) },
      'session-1',
    );
    state = applyHostPushToForeground(
      state,
      { type: 'run/updated', run: activeRun({ runId: 'run-live', status: 'cancelling' }) },
      'session-1',
    );
    expect(state).toMatchObject({ kind: 'active', runId: 'run-live', status: 'cancelling' });
  });

  it('ignores run/terminal for an old runId while a newer Run is active', () => {
    let state = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'run-updated', run: activeRun({ runId: 'run-old' }) },
      'session-1',
    );
    state = reduceForegroundRun(
      state,
      { type: 'run-updated', run: activeRun({ runId: 'run-new' }) },
      'session-1',
    );
    state = applyHostPushToForeground(
      state,
      { type: 'run/terminal', run: activeRun({ runId: 'run-old', status: 'cancelled' }) },
      'session-1',
    );
    expect(state).toMatchObject({ kind: 'active', runId: 'run-new' });
  });

  it('becomes idle only on exact runId run/terminal', () => {
    let state = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'run-updated', run: activeRun({ runId: 'run-exact' }) },
      'session-1',
    );
    state = applyHostPushToForeground(
      state,
      { type: 'run/terminal', run: activeRun({ runId: 'run-exact', status: 'completed' }) },
      'session-1',
    );
    expect(state).toEqual({ kind: 'idle', generation: 0 });
    expect(knownForegroundRunId(state)).toBeUndefined();
  });

  it('disables mutations while unknown or reconciling', () => {
    expect(foregroundMutationsEnabled(initialForegroundRunState())).toBe(false);
    const reconciling = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'begin-reconcile', generation: 2 },
      'session-1',
    );
    expect(reconciling).toEqual({ kind: 'reconciling', generation: 2 });
    expect(foregroundMutationsEnabled(reconciling)).toBe(false);
  });

  it('ignores a stale foreground-run response after a newer selection generation', () => {
    const reconciling = reduceForegroundRun(
      initialForegroundRunState(),
      { type: 'begin-reconcile', generation: 3 },
      'session-1',
    );
    const stale = applyForegroundRunResponse(
      reconciling,
      {
        type: 'response',
        command: 'session/foreground-run',
        success: true,
        data: { sessionId: 'session-1', run: activeRun({ runId: 'stale' }) },
      },
      2,
      'session-1',
    );
    expect(stale).toEqual({ kind: 'reconciling', generation: 3 });
    const current = applyForegroundRunResponse(
      reconciling,
      {
        type: 'response',
        command: 'session/foreground-run',
        success: true,
        data: { sessionId: 'session-1', run: activeRun({ runId: 'live' }) },
      },
      3,
      'session-1',
    );
    expect(current).toMatchObject({ kind: 'active', runId: 'live', generation: 3 });
  });
});
