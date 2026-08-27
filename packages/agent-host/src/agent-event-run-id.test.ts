import { describe, expect, it } from 'vitest';
import {
  AgentEventRunIdMismatchError,
  canCarryAgentEventRunId,
  stampAgentEventRunId,
  stampPublishedAgentEvent,
} from './agent-event-run-id.js';

describe('agent-event-run-id', () => {
  it('stamps foreground events and leaves unowned lifecycle events alone', () => {
    expect(stampAgentEventRunId({ type: 'message/end', messageId: 'm1' }, 'run-1')).toEqual({
      type: 'message/end',
      messageId: 'm1',
      runId: 'run-1',
    });
    expect(canCarryAgentEventRunId({ type: 'session/started', sessionId: 's1' })).toBe(false);
    expect(stampAgentEventRunId({ type: 'session/started', sessionId: 's1' }, 'run-1')).toEqual({
      type: 'session/started',
      sessionId: 's1',
    });
    expect(
      stampAgentEventRunId({ type: 'memory/extraction_start', sessionId: 's1' }, 'run-1'),
    ).toEqual({ type: 'memory/extraction_start', sessionId: 's1' });
  });

  it('attaches a structured failure when publishing an error event', () => {
    expect(
      stampAgentEventRunId(
        { type: 'error', message: 'Stream ended without finish_reason' },
        'run-1',
      ),
    ).toMatchObject({
      type: 'error',
      message: 'Stream ended without finish_reason',
      runId: 'run-1',
      retriable: true,
      failure: {
        code: 'model-stream-missing-finish',
        origin: 'protocol',
      },
    });
  });

  it('rejects a mismatched event runId instead of guessing', () => {
    expect(() =>
      stampAgentEventRunId({ type: 'message/end', messageId: 'm1', runId: 'run-a' }, 'run-b'),
    ).toThrow(AgentEventRunIdMismatchError);
    expect(
      stampPublishedAgentEvent({ type: 'message/end', messageId: 'm1', runId: 'run-a' }, 'run-b'),
    ).toBeUndefined();
  });

  it('leaves events unowned when no foreground Run is active', () => {
    const event = { type: 'compaction/start' as const };
    expect(stampPublishedAgentEvent(event, undefined)).toEqual(event);
  });
});
