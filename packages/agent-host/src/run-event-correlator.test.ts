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

  it('does not invent a current run for an uncorrelated error', () => {
    const correlator = new RunEventCorrelator();
    const result = correlator.correlate(
      'session-1',
      { type: 'error', message: 'late error' },
      'run-2',
      undefined,
    );
    expect(result.accepted).toBe(false);
    expect(result.event).toEqual({ type: 'error', message: 'late error' });
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
    const terminal = correlator.correlate(
      'session-1',
      {
        type: 'run/terminal',
        sessionId: 'session-1',
        runId: 'run-1',
        outcome: 'completed',
        at: '2026-07-24T00:00:00.000Z',
      },
      'run-1',
      undefined,
    );
    expect(terminal.accepted).toBe(true);

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
});
