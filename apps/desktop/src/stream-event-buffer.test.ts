import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { createStreamEventBuffer } from './stream-event-buffer';

function createDeltaEvent(delta: string): AgentEvent {
  return { type: 'message/text_delta', messageId: 'assistant-1', delta };
}

describe('createStreamEventBuffer', () => {
  it('batches same-frame stream events for one session', () => {
    const scheduled: Array<() => void> = [];
    const actions: Array<{ type: string; events?: AgentEvent[] }> = [];
    const buffer = createStreamEventBuffer({
      dispatch: (action) => actions.push(action),
      frameScheduler: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      frameCanceller: () => undefined,
    });

    buffer.push('s1', createDeltaEvent('a'));
    buffer.push('s1', createDeltaEvent('b'));
    expect(actions).toHaveLength(0);

    scheduled[0]?.();

    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe('event/batch');
    expect(actions[0]?.events).toEqual([
      { type: 'message/text_delta', messageId: 'assistant-1', delta: 'a' },
      { type: 'message/text_delta', messageId: 'assistant-1', delta: 'b' },
    ]);
  });

  it('flushes pending deltas before immediate lifecycle events', () => {
    const scheduled: Array<() => void> = [];
    const actions: Array<{ type: string; event?: AgentEvent }> = [];
    const buffer = createStreamEventBuffer({
      dispatch: (action) => actions.push(action),
      frameScheduler: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      frameCanceller: () => undefined,
    });

    buffer.push('s1', createDeltaEvent('partial'));
    buffer.push('s1', {
      type: 'message/start',
      messageId: 'assistant-2',
      role: 'assistant',
    });

    expect(actions[0]?.type).toBe('event/batch');
    expect(actions[1]?.type).toBe('event');
    expect(actions[1]?.event?.type).toBe('message/start');
    expect(scheduled).toHaveLength(1);
    buffer.dispose();
  });

  it('does not combine different sessions into one batch', () => {
    const scheduled: Array<() => void> = [];
    const actions: Array<{ type: string; sessionId?: string; event?: AgentEvent }> = [];
    const buffer = createStreamEventBuffer({
      dispatch: (action) => actions.push(action),
      frameScheduler: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      frameCanceller: () => undefined,
    });

    buffer.push('s1', createDeltaEvent('a'));
    buffer.push('s2', createDeltaEvent('b'));
    scheduled[0]?.();

    expect(actions).toEqual([
      {
        type: 'event',
        sessionId: 's1',
        event: createDeltaEvent('a'),
      },
      {
        type: 'event',
        sessionId: 's2',
        event: createDeltaEvent('b'),
      },
    ]);
  });
});
