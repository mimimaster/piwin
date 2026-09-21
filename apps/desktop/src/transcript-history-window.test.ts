import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from './chat-reducer.js';
import { canLoadNewerTranscript, canLoadOlderTranscript } from './transcript-history-window.js';
import {
  measureTranscriptCacheBytes,
  MAX_TRANSCRIPT_CACHE_BYTES,
} from './transcript-page-cache.js';

function messages(start: number, end: number, text = 'hello'): SessionTranscriptMessage[] {
  return Array.from({ length: end - start }, (_, index) => ({
    id: `m${start + index}`,
    role: 'user',
    text,
    status: 'done',
    createdAt: '2026-09-21',
    runId: `r${start + index}`,
  }));
}
function initial(): ChatUiState {
  let state = chatUiReducer(createInitialChatUiState(), { type: 'session/set', sessionId: 'long' });
  return chatUiReducer(state, {
    type: 'session/load-messages',
    sessionId: 'long',
    messages: messages(250, 300),
  });
}
function seek(state: ChatUiState, start: number, end: number, text = 'hello') {
  return chatUiReducer(state, {
    type: 'session/seek-messages',
    sessionId: 'long',
    epoch: state.userMessageIndexEpoch,
    messages: messages(start, end, text),
    window: {
      revision: 'r1',
      totalCount: 300,
      startIndex: start,
      endIndex: end,
      messageBytes: 100,
      anchorMessageId: `m${start}`,
      anchorOffset: 0,
    },
  });
}
function page(
  state: ChatUiState,
  direction: 'older' | 'newer',
  start: number,
  end: number,
  text = 'hello',
) {
  const anchor = direction === 'older' ? end - 1 : start;
  return chatUiReducer(state, {
    type: 'session/page-history',
    sessionId: 'long',
    epoch: state.userMessageIndexEpoch,
    direction,
    messages: messages(start, end, text),
    window: {
      revision: 'r2',
      totalCount: 300,
      startIndex: start,
      endIndex: end,
      messageBytes: 100,
      anchorMessageId: `m${anchor}`,
      anchorOffset: anchor - start,
    },
  });
}

describe('bounded bidirectional history', () => {
  it('walks through all 300 messages in both directions while retaining at most 160', () => {
    let state = seek(initial(), 250, 300);
    const liveTail = state.messages;
    const seen = new Set<string>();
    while (canLoadOlderTranscript(state)) {
      const start = state.historyView?.window.startIndex ?? 0;
      state = page(state, 'older', Math.max(0, start - 49), start + 1);
      for (const message of state.historyView?.messages ?? []) seen.add(message.id);
      expect(state.historyView?.messages.length).toBeLessThanOrEqual(160);
      expect(state.messages).toBe(liveTail);
    }
    expect(seen.size).toBe(300);
    expect(state.historyView?.messages[0]?.id).toBe('m0');
    while (canLoadNewerTranscript(state)) {
      const end = state.historyView?.window.endIndex ?? 0;
      state = page(state, 'newer', end - 1, Math.min(300, end + 49));
      expect(state.historyView?.messages.length).toBeLessThanOrEqual(160);
    }
    expect(state.historyView?.messages.at(-1)?.id).toBe('m299');
    expect(Object.keys(state.historyView?.runRecordsById ?? {})).toHaveLength(160);
    expect(state.messages).toBe(liveTail);
  });

  it('evicts the opposite edge at the byte limit and keeps navigation available', () => {
    const state = page(
      seek(initial(), 100, 140, 'x'.repeat(50_000)),
      'older',
      90,
      101,
      'x'.repeat(50_000),
    );
    expect(measureTranscriptCacheBytes(state.historyView?.messages ?? [])).toBeLessThanOrEqual(
      MAX_TRANSCRIPT_CACHE_BYTES,
    );
    expect(state.historyView?.messages[0]?.id).toBe('m90');
    expect(state.historyView?.messages.length).toBeLessThan(50);
    expect(canLoadOlderTranscript(state)).toBe(true);
    expect(canLoadNewerTranscript(state)).toBe(true);
  });

  it('rejects a late page after the reader seeks to another window', () => {
    const state = seek(initial(), 50, 100);
    expect(page(state, 'older', 151, 201)).toBe(state);
  });

  it('makes no state change when the Host returns only the boundary', () => {
    const state = seek(initial(), 50, 100);
    expect(page(state, 'older', 50, 51)).toBe(state);
  });
});

it('keeps older history reachable after a live session trims without a hydrated page cursor', () => {
  let state = chatUiReducer(createInitialChatUiState(), { type: 'session/set', sessionId: 'long' });
  state = chatUiReducer(state, { type: 'session/load-messages', sessionId: 'long', messages: messages(0, 160) });
  const next = messages(160, 161)[0];
  if (!next) throw new Error('Missing message');
  state = chatUiReducer(state, { type: 'transcript/append', sessionId: 'long', message: next });
  expect(state.messages).toHaveLength(160);
  expect(canLoadOlderTranscript(state)).toBe(true);
});
