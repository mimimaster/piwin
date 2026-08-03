import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import type { SubagentStreamState } from './chat-reducer';
import { reconcileSubagentTranscript } from './subagent-session-projection';

function makeMessage(
  overrides: Partial<SessionTranscriptMessage> & { id: string },
): SessionTranscriptMessage {
  return {
    role: 'assistant',
    text: 'hello',
    createdAt: '2026-08-03T00:00:00.000Z',
    status: 'done',
    ...overrides,
  };
}

function makeStream(overrides: Partial<SubagentStreamState>): SubagentStreamState {
  return {
    childSessionId: 'child-1',
    text: '',
    thinking: '',
    tools: [],
    streaming: true,
    currentMessageId: null,
    ...overrides,
  };
}

describe('reconcileSubagentTranscript', () => {
  it('maps history without a live tail untouched', () => {
    const history = [
      makeMessage({ id: 'user-1', role: 'user', text: 'Fix the bug' }),
      makeMessage({ id: 'assistant-1', text: 'Fixed' }),
    ];
    const view = reconcileSubagentTranscript({ historicalMessages: history, stream: null });
    expect(view.historicalMessages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
    ]);
    expect(view.liveTail).toBeNull();
  });

  it('normalizes hydrated streaming messages to done', () => {
    const history = [makeMessage({ id: 'assistant-1', status: 'streaming' })];
    const view = reconcileSubagentTranscript({ historicalMessages: history, stream: null });
    expect(view.historicalMessages[0]?.status).toBe('done');
  });

  it('deduplicates the persisted message represented by the live tail', () => {
    const history = [
      makeMessage({ id: 'user-1', role: 'user', text: 'Fix the bug' }),
      makeMessage({ id: 'assistant-1', text: 'partial' }),
    ];
    const stream = makeStream({
      currentMessageId: 'assistant-1',
      text: 'partial output so far',
      streaming: true,
    });
    const view = reconcileSubagentTranscript({ historicalMessages: history, stream });
    expect(view.historicalMessages.map((message) => message.id)).toEqual(['user-1']);
    expect(view.liveTail).toBe(stream);
  });

  it('does not drop history after the stream ends when the final message is persisted', () => {
    const history = [
      makeMessage({ id: 'user-1', role: 'user', text: 'Fix the bug' }),
      makeMessage({ id: 'assistant-1', text: 'final answer' }),
    ];
    const stream = makeStream({
      currentMessageId: 'assistant-1',
      text: 'final answer',
      streaming: false,
    });
    const view = reconcileSubagentTranscript({ historicalMessages: history, stream });
    expect(view.historicalMessages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
    ]);
    expect(view.liveTail).toBeNull();
  });

  it('keeps a terminal live tail until history catches up', () => {
    const history = [makeMessage({ id: 'user-1', role: 'user', text: 'Fix the bug' })];
    const stream = makeStream({
      currentMessageId: 'assistant-1',
      text: 'final answer not yet persisted',
      streaming: false,
    });
    const view = reconcileSubagentTranscript({ historicalMessages: history, stream });
    expect(view.historicalMessages.map((message) => message.id)).toEqual(['user-1']);
    expect(view.liveTail).toBe(stream);
  });

  it('keeps historical tools and attachments', () => {
    const history = [
      makeMessage({
        id: 'assistant-1',
        tools: [
          {
            toolCallId: 'tool-1',
            toolName: 'edit_file',
            status: 'done' as const,
            output: 'patched',
          },
        ],
        attachments: [
          {
            id: 'media-1',
            kind: 'media',
            path: '/tmp/x.png',
            mimeType: 'image/png',
            byteSize: 1024,
            source: 'paste',
          },
        ],
      }),
    ];
    const view = reconcileSubagentTranscript({ historicalMessages: history, stream: null });
    expect(view.historicalMessages[0]?.tools).toHaveLength(1);
    expect(view.historicalMessages[0]?.tools[0]?.toolName).toBe('edit_file');
    expect(view.historicalMessages[0]?.attachments).toHaveLength(1);
  });

  it('returns an empty history with only a live tail', () => {
    const stream = makeStream({ currentMessageId: 'assistant-1', text: 'streaming now' });
    const view = reconcileSubagentTranscript({ historicalMessages: [], stream });
    expect(view.historicalMessages).toEqual([]);
    expect(view.liveTail).toBe(stream);
  });

  it('does not mutate the input arrays', () => {
    const history = [makeMessage({ id: 'assistant-1' })];
    const stream = makeStream({ currentMessageId: 'assistant-1' });
    reconcileSubagentTranscript({ historicalMessages: history, stream });
    expect(history).toHaveLength(1);
    expect(history[0]?.text).toBe('hello');
  });
});
