import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentEventEnvelope, ExecutionRunRecord } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type ChatUiAction } from './chat-reducer';
import { createStreamEventBuffer } from './stream-event-buffer';

function createDeltaEvent(delta: string): AgentEvent {
  return { type: 'message/text_delta', messageId: 'assistant-1', delta };
}

function createTerminalRun(): ExecutionRunRecord {
  return {
    runId: 'run-1',
    kind: 'session-turn',
    status: 'completed',
    rootRunId: 'run-1',
    sessionId: 's1',
    startedAt: '2026-08-26T00:00:00.000Z',
    endedAt: '2026-08-26T00:00:01.000Z',
    terminalCode: 'completed',
  };
}

describe('createStreamEventBuffer', () => {
  it('dispatches a native Host delta immediately with its envelope intact', () => {
    const actions: ChatUiAction[] = [];
    const buffer = createStreamEventBuffer({ dispatch: (action) => actions.push(action) });
    const envelope: AgentEventEnvelope = {
      eventId: 'event-1',
      sequence: 7,
      runId: 'run-1',
    };

    buffer.push('s1', createDeltaEvent('hello'), envelope);

    expect(actions).toEqual([
      {
        type: 'event',
        sessionId: 's1',
        event: createDeltaEvent('hello'),
        envelope,
      },
    ]);
  });

  it('does not split or pace a large provider delta on the client', () => {
    const actions: ChatUiAction[] = [];
    const buffer = createStreamEventBuffer({ dispatch: (action) => actions.push(action) });
    const providerDelta = '这是模型原生返回的一整段内容。'.repeat(40);

    buffer.push('s1', createDeltaEvent(providerDelta));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'event',
      event: { type: 'message/text_delta', delta: providerDelta },
    });
  });

  it('keeps lifecycle controls behind the deltas that preceded them', () => {
    const actions: ChatUiAction[] = [];
    const buffer = createStreamEventBuffer({ dispatch: (action) => actions.push(action) });

    buffer.push('s1', createDeltaEvent('first'));
    buffer.push('s1', { type: 'message/end', messageId: 'assistant-1' });
    buffer.pushAction('s1', { type: 'run/terminal', run: createTerminalRun() });

    expect(actions.map((action) => action.type)).toEqual(['event', 'event', 'run/terminal']);
    expect(actions[0]).toMatchObject({ event: { type: 'message/text_delta', delta: 'first' } });
    expect(actions[1]).toMatchObject({ event: { type: 'message/end' } });
  });

  it('retains the complete native stream when terminal follows the final delta', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'assistant-1', role: 'assistant' },
    });
    const buffer = createStreamEventBuffer({
      dispatch: (action) => {
        state = chatUiReducer(state, action);
      },
    });
    const chunks = Array.from({ length: 80 }, (_, index) => `${index + 1}. token\n`);

    for (const chunk of chunks) {
      buffer.push('s1', createDeltaEvent(chunk));
    }
    buffer.push('s1', { type: 'message/end', messageId: 'assistant-1' });
    buffer.pushAction('s1', { type: 'run/terminal', run: createTerminalRun() });

    expect(state.messages[0]?.text).toBe(chunks.join(''));
    expect(state.messages[0]?.status).toBe('done');
    expect(state.streaming).toBe(false);
  });

  it('leaves replay deduplication to the canonical reducer envelope policy', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'assistant-1', role: 'assistant' },
    });
    const buffer = createStreamEventBuffer({
      dispatch: (action) => {
        state = chatUiReducer(state, action);
      },
    });
    const envelope: AgentEventEnvelope = {
      eventId: 'event-replayed',
      sequence: 1,
      runId: 'run-1',
    };

    buffer.push('s1', createDeltaEvent('only once'), envelope);
    buffer.push('s1', createDeltaEvent('only once'), envelope);

    expect(state.messages[0]?.text).toBe('only once');
  });

  it('does not defer cleanup behind visibility-dependent callbacks', () => {
    const actions: ChatUiAction[] = [];
    const buffer = createStreamEventBuffer({ dispatch: (action) => actions.push(action) });

    buffer.push('s1', createDeltaEvent('visible now'));
    buffer.flush();
    buffer.reset();
    buffer.dispose();

    expect(actions).toHaveLength(1);
  });

  it('does not schedule a frame callback even when a scheduler is passed', () => {
    const scheduled: Array<() => void> = [];
    const actions: ChatUiAction[] = [];
    const buffer = createStreamEventBuffer({
      dispatch: (action) => actions.push(action),
      frameScheduler: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
    });

    buffer.push('s1', createDeltaEvent('now'));

    expect(scheduled).toHaveLength(0);
    expect(actions).toHaveLength(1);
  });
});
