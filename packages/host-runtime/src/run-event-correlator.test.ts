import { describe, expect, it } from 'vitest';
import { RunEventCorrelator } from './run-event-correlator.js';

describe('RunEventCorrelator', () => {
  it('keeps a late message event on its original run after a new run starts', () => {
    const correlator = new RunEventCorrelator();
    const started = correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'message-1', role: 'assistant' },
      'run-1',
      'run-1',
    );
    expect(started.event).toMatchObject({ messageId: 'message-1', runId: 'run-1' });

    const lateDelta = correlator.correlate(
      'session-1',
      { type: 'message/text_delta', messageId: 'message-1', delta: 'late' },
      'run-2',
      undefined,
    );
    expect(lateDelta.accepted).toBe(true);
    expect(lateDelta.event).toMatchObject({ messageId: 'message-1', runId: 'run-1' });
  });

  it('attributes identity-less provider errors to the active run when ALS is lost', () => {
    // Pi stream callbacks often break AsyncLocalStorage. Provider failures still
    // belong to the live foreground turn (ADR 0015); dropping them replaces
    // upstream text with a generic empty-response fallback.
    const correlator = new RunEventCorrelator();
    const result = correlator.correlate(
      'session-1',
      { type: 'error', message: '404: No endpoints available' },
      'run-1',
      undefined,
    );
    expect(result.accepted).toBe(true);
    expect(result.event).toMatchObject({
      type: 'error',
      message: '404: No endpoints available',
      runId: 'run-1',
    });
  });

  it('still rejects explicit errors from a replaced run', () => {
    const correlator = new RunEventCorrelator();
    correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'message-1', role: 'assistant' },
      'run-1',
      'run-1',
    );
    correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'message-2', role: 'assistant' },
      'run-2',
      'run-2',
    );

    const result = correlator.correlate(
      'session-1',
      { type: 'error', message: 'late error', runId: 'run-1' },
      'run-2',
      undefined,
    );
    expect(result.accepted).toBe(false);
  });

  it('uses execution context ownership for events without stable identities', () => {
    const correlator = new RunEventCorrelator();
    const result = correlator.correlate(
      'session-1',
      { type: 'session/aborted', sessionId: 'session-1' },
      'run-2',
      'run-1',
    );
    expect(result.accepted).toBe(true);
    expect(result.event).toMatchObject({ type: 'session/aborted', runId: 'run-1' });
  });

  it('rejects an explicit event from a replaced run', () => {
    const correlator = new RunEventCorrelator();
    correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'message-1', role: 'assistant', runId: 'run-1' },
      'run-1',
      undefined,
    );

    const result = correlator.correlate(
      'session-1',
      { type: 'message/text_delta', messageId: 'message-1', delta: 'stale', runId: 'run-1' },
      'run-2',
      undefined,
    );

    expect(result.accepted).toBe(false);
    expect(result.event).toMatchObject({ runId: 'run-1', delta: 'stale' });
  });

  it('rejects explicit events after their run has terminated', () => {
    const correlator = new RunEventCorrelator();
    correlator.markRunTerminal('session-1', 'run-1');

    const result = correlator.correlate(
      'session-1',
      { type: 'error', message: 'stale error', runId: 'run-1' },
      undefined,
      undefined,
    );

    expect(result.accepted).toBe(false);
    expect(result.event).toEqual({ type: 'error', message: 'stale error', runId: 'run-1' });
  });

  it('automatically marks the previous run stale when active ownership changes', () => {
    const correlator = new RunEventCorrelator();
    correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'message-1', role: 'assistant' },
      'run-1',
      'run-1',
    );

    correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'message-2', role: 'assistant' },
      'run-2',
      'run-2',
    );

    const staleEvent = correlator.correlate(
      'session-1',
      { type: 'error', message: 'late error', runId: 'run-1' },
      undefined,
      undefined,
    );
    expect(staleEvent.accepted).toBe(false);
  });

  it('attributes foreground events to the active run when execution context is lost', () => {
    // Pi SDK emits events from internal async stream callbacks that can break
    // the AsyncLocalStorage chain. When that happens, executionRunId is
    // undefined but the active run is still registered. Foreground events
    // with a stable identity (message/tool/permission) must be attributed to
    // the active run — there is no other run they could belong to (ADR 0015).
    const correlator = new RunEventCorrelator();

    const start = correlator.correlate(
      'session-1',
      { type: 'message/start', messageId: 'msg-1', role: 'assistant' },
      'run-1',
      undefined, // execution context lost
    );
    expect(start.accepted).toBe(true);
    expect(start.event).toMatchObject({ messageId: 'msg-1', runId: 'run-1' });

    const delta = correlator.correlate(
      'session-1',
      { type: 'message/text_delta', messageId: 'msg-1', delta: 'hello' },
      'run-1',
      undefined,
    );
    expect(delta.accepted).toBe(true);
    expect(delta.event).toMatchObject({ runId: 'run-1', delta: 'hello' });

    const toolStart = correlator.correlate(
      'session-1',
      { type: 'tool/start', toolCallId: 'tool-1', toolName: 'write' },
      'run-1',
      undefined,
    );
    expect(toolStart.accepted).toBe(true);
    expect(toolStart.event).toMatchObject({ runId: 'run-1', toolName: 'write' });
  });
});
