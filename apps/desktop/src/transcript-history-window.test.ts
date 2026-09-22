import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from './chat-reducer.js';
import { canLoadNewerTranscript, canLoadOlderTranscript } from './transcript-history-window.js';
import {
  measureTranscriptCacheBytes,
  MAX_HISTORY_VIEW_MESSAGES,
  MAX_TRANSCRIPT_CACHE_BYTES,
} from './transcript-page-cache.js';

/** Long enough that walking it must evict at the history-view cap. */
const TOTAL = 1_500;

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
    messages: messages(TOTAL - 50, TOTAL),
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
      totalCount: TOTAL,
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
  keepMessageId?: string,
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
      totalCount: TOTAL,
      startIndex: start,
      endIndex: end,
      messageBytes: 100,
      anchorMessageId: `m${anchor}`,
      anchorOffset: anchor - start,
    },
    ...(keepMessageId !== undefined ? { keepMessageId } : {}),
  });
}

describe('bounded bidirectional history', () => {
  it('walks the whole history in both directions while retaining at most the history cap', () => {
    let state = seek(initial(), TOTAL - 50, TOTAL);
    const liveTail = state.messages;
    const seen = new Set<string>();
    while (canLoadOlderTranscript(state)) {
      const start = state.historyView?.window.startIndex ?? 0;
      state = page(state, 'older', Math.max(0, start - 49), start + 1);
      for (const message of state.historyView?.messages ?? []) seen.add(message.id);
      expect(state.historyView?.messages.length).toBeLessThanOrEqual(MAX_HISTORY_VIEW_MESSAGES);
      expect(state.messages).toBe(liveTail);
    }
    expect(seen.size).toBe(TOTAL);
    expect(state.historyView?.messages[0]?.id).toBe('m0');
    while (canLoadNewerTranscript(state)) {
      const end = state.historyView?.window.endIndex ?? 0;
      state = page(state, 'newer', end - 1, Math.min(TOTAL, end + 49));
      expect(state.historyView?.messages.length).toBeLessThanOrEqual(MAX_HISTORY_VIEW_MESSAGES);
    }
    expect(state.historyView?.messages.at(-1)?.id).toBe(`m${TOTAL - 1}`);
    expect(Object.keys(state.historyView?.runRecordsById ?? {})).toHaveLength(
      MAX_HISTORY_VIEW_MESSAGES,
    );
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

  it('never evicts the message on screen, even past the cap', () => {
    // The reader sits at the newest resident message while the rows between
    // it and the loading edge are a closed tool fold: the far edge is them.
    let state = seek(initial(), 1_000, 1_050);
    while ((state.historyView?.messages.length ?? 0) + 49 <= MAX_HISTORY_VIEW_MESSAGES) {
      const start = state.historyView?.window.startIndex ?? 0;
      state = page(state, 'older', start - 49, start + 1);
    }
    const start = state.historyView?.window.startIndex ?? 0;
    state = page(state, 'older', start - 49, start + 1, 'hello', 'm1049');
    expect(state.historyView?.messages.at(-1)?.id).toBe('m1049');
    expect(state.historyView?.messages[0]?.id).toBe(`m${start - 49}`);
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
