import type { AgentEvent } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRANSCRIPT,
  appendLocalUserMessage,
  appendNotice,
  appendNoticeOnce,
  applyAgentEvent,
  prependOlderMessages,
  settleStreaming,
  transcriptFromMessages,
  type TranscriptMessageEntry,
  type TranscriptState,
} from './transcript-model.js';

function fold(events: AgentEvent[], initial: TranscriptState = EMPTY_TRANSCRIPT): TranscriptState {
  return events.reduce(applyAgentEvent, initial);
}

function message(state: TranscriptState, id: string): TranscriptMessageEntry {
  const entry = state.entries.find((candidate) => candidate.id === id);
  if (entry?.kind !== 'message') throw new Error(`no message ${id}`);
  return entry;
}

describe('applyAgentEvent', () => {
  it('streams thinking, text and settles on message/end', () => {
    const state = fold([
      { type: 'message/start', messageId: 'a1', role: 'assistant' },
      { type: 'message/thinking_delta', messageId: 'a1', delta: '想' },
      { type: 'message/text_delta', messageId: 'a1', delta: '你' },
      { type: 'message/text_delta', messageId: 'a1', delta: '好' },
      { type: 'message/end', messageId: 'a1' },
    ]);
    expect(message(state, 'a1')).toMatchObject({ text: '你好', thinking: '想', status: 'done' });
  });

  it('replaces text on a cumulative snapshot instead of appending', () => {
    const state = fold([
      { type: 'message/start', messageId: 'a1', role: 'assistant' },
      { type: 'message/text_delta', messageId: 'a1', delta: 'abc' },
      { type: 'message/text_snapshot', messageId: 'a1', text: 'abcdef' },
    ]);
    expect(message(state, 'a1').text).toBe('abcdef');
  });

  it('does not duplicate the locally echoed user prompt when the Host confirms it', () => {
    const local = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', 'hi');
    const state = fold([{ type: 'message/start', messageId: 'u1', role: 'user' }], local);
    expect(state.entries).toHaveLength(1);
    expect(message(state, 'u1').text).toBe('hi');
  });

  it('attaches tools to the response that emitted them and tracks their status', () => {
    const state = fold([
      { type: 'message/start', messageId: 'a1', role: 'assistant' },
      { type: 'message/tool_args_progress', messageId: 'a1', argumentCharCount: 40, toolName: 'bash' },
      { type: 'tool/start', toolCallId: 't1', toolName: 'bash', responseMessageId: 'a1' },
      { type: 'tool/update', toolCallId: 't1', delta: 'line\n', responseMessageId: 'a1' },
      { type: 'tool/end', toolCallId: 't1', isError: true, responseMessageId: 'a1' },
    ]);
    const owner = message(state, 'a1');
    expect(owner.composing).toBeUndefined();
    expect(owner.tools).toEqual([
      { toolCallId: 't1', toolName: 'bash', status: 'error', output: 'line\n' },
    ]);
  });

  it('falls back to the latest assistant row when the backend names no owner', () => {
    const state = fold([
      { type: 'message/start', messageId: 'a1', role: 'assistant' },
      { type: 'message/start', messageId: 'a2', role: 'assistant' },
      { type: 'tool/start', toolCallId: 't1', toolName: 'read' },
    ]);
    expect(message(state, 'a1').tools).toHaveLength(0);
    expect(message(state, 'a2').tools).toHaveLength(1);
  });

  it('opens a row for live output that arrives outside the loaded page', () => {
    const state = fold([{ type: 'message/text_delta', messageId: 'late', delta: 'x' }]);
    expect(message(state, 'late')).toMatchObject({ role: 'assistant', status: 'streaming', text: 'x' });
  });

  it('settles running work and reports an abort', () => {
    const state = fold([
      { type: 'message/start', messageId: 'a1', role: 'assistant' },
      { type: 'tool/start', toolCallId: 't1', toolName: 'bash', responseMessageId: 'a1' },
      { type: 'session/aborted', sessionId: 's1' },
    ]);
    expect(message(state, 'a1').status).toBe('done');
    expect(message(state, 'a1').tools[0]?.status).toBe('error');
    expect(state.entries.at(-1)).toMatchObject({ kind: 'notice', tone: 'info' });
  });

  it('surfaces agent errors as error notices', () => {
    const state = fold([{ type: 'error', message: 'boom' }]);
    expect(state.entries.at(-1)).toMatchObject({ kind: 'notice', tone: 'error', text: 'boom' });
  });
});

describe('durable pages', () => {
  const page = [
    { id: 'u1', role: 'user' as const, text: 'q', createdAt: '', status: 'done' as const },
    {
      id: 'a1',
      role: 'assistant' as const,
      text: 'a',
      createdAt: '',
      status: 'done' as const,
      thinking: 't',
      tools: [{ toolCallId: 't1', toolName: 'read', status: 'done' as const, output: '' }],
    },
  ];

  it('projects Host rows including thinking and tools', () => {
    const state = transcriptFromMessages(page);
    expect(message(state, 'a1')).toMatchObject({ thinking: 't', tools: [{ toolName: 'read' }] });
  });

  it('prepends an older page without duplicating overlapping rows', () => {
    const state = transcriptFromMessages(page.slice(1));
    const merged = prependOlderMessages(state, page);
    expect(merged.entries.map((entry) => entry.id)).toEqual(['u1', 'a1']);
  });

  it('settleStreaming is a no-op when nothing is running', () => {
    const state = transcriptFromMessages(page);
    expect(settleStreaming(state)).toBe(state);
  });
});

describe('user message/start', () => {
  it('does not open an empty row next to the local echo', () => {
    const echoed = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'client-1', 'hello');
    const next = applyAgentEvent(echoed, { type: 'message/start', messageId: 'host-user-1', role: 'user' });
    expect(next).toBe(echoed);
  });
});

describe('appendNoticeOnce', () => {
  it('does not repeat the notice it would follow', () => {
    const once = appendNotice(EMPTY_TRANSCRIPT, 'error', 'provider timed out');
    expect(appendNoticeOnce(once, 'error', 'provider timed out')).toBe(once);
    expect(appendNoticeOnce(once, 'error', 'something else').entries).toHaveLength(2);
    expect(appendNoticeOnce(once, 'info', 'provider timed out').entries).toHaveLength(2);
  });
});
