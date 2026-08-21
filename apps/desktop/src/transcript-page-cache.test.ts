import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  MAX_TRANSCRIPT_CACHE_BYTES,
  MAX_TRANSCRIPT_CACHE_MESSAGES,
  measureTranscriptCacheBytes,
  prependBoundedTranscriptPage,
  retainBoundedSessionTranscript,
  retainBoundedTranscriptWindow,
} from './transcript-page-cache';

function message(id: string, text = id): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

describe('transcript page cache', () => {
  it('prepends chronologically, deduplicates, and preserves the active tail', () => {
    const current = [message('m3'), message('m4')];
    const merged = prependBoundedTranscriptPage(current, [
      message('m1'),
      message('m2'),
      message('m3'),
    ]);
    expect(merged.messages.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(merged.acceptedOlderCount).toBe(2);
    expect(merged.cacheLimitReached).toBe(false);
  });

  it('stops at both item and UTF-8 byte budgets without evicting current messages', () => {
    const current = Array.from({ length: 150 }, (_, index) => message(`tail-${index}`));
    const older = Array.from({ length: 30 }, (_, index) => message(`older-${index}`));
    const itemBound = prependBoundedTranscriptPage(current, older);
    expect(itemBound.messages).toHaveLength(MAX_TRANSCRIPT_CACHE_MESSAGES);
    expect(itemBound.messages.slice(-150).map((item) => item.id)).toEqual(
      current.map((item) => item.id),
    );
    expect(itemBound.cacheLimitReached).toBe(true);

    const largeTail = [message('tail', 'x'.repeat(MAX_TRANSCRIPT_CACHE_BYTES - 1_000))];
    const byteBound = prependBoundedTranscriptPage(largeTail, [
      message('older', 'y'.repeat(2_000)),
    ]);
    expect(byteBound.messages.map((item) => item.id)).toEqual(['tail']);
    expect(byteBound.retainedBytes).toBe(measureTranscriptCacheBytes(largeTail));
    expect(byteBound.cacheLimitReached).toBe(true);
  });

  it('bounds a live-grown window while retaining protected current-tail messages', () => {
    const messages = Array.from({ length: 240 }, (_, index) => message(`m-${index}`));
    const protectedIds = new Set(messages.slice(-16).map((item) => item.id));

    const bounded = retainBoundedTranscriptWindow(messages, protectedIds);

    expect(bounded.messages).toHaveLength(MAX_TRANSCRIPT_CACHE_MESSAGES);
    expect(bounded.messages.slice(-16).map((item) => item.id)).toEqual(
      messages.slice(-16).map((item) => item.id),
    );
    expect(bounded.droppedCount).toBe(80);
    expect(bounded.cacheLimitReached).toBe(true);
  });

  it('keeps the newest Host transcript rows under the shared cache budget', () => {
    const messages = Array.from({ length: 200 }, (_, index) => ({
      id: `m-${index}`,
      role: 'assistant' as const,
      text: `row ${index}`,
      createdAt: '2026-08-20T00:00:00.000Z',
      status: 'done' as const,
    }));
    const bounded = retainBoundedSessionTranscript(messages);
    expect(bounded).toHaveLength(MAX_TRANSCRIPT_CACHE_MESSAGES);
    expect(bounded[0]?.id).toBe('m-40');
    expect(bounded[bounded.length - 1]?.id).toBe('m-199');
  });
});
