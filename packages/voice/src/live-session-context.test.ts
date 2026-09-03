import { describe, expect, it, vi } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  LIVE_SESSION_CONTEXT_CACHE_LIMIT,
  LiveSessionContextError,
  PIWIN_LIVE_SESSION_CONTEXT_PROMPT,
  createLiveSessionContextSummarizer,
  serializeLiveSessionTranscript,
} from './live-session-context.js';

function message(
  overrides: Partial<SessionTranscriptMessage> & Pick<SessionTranscriptMessage, 'id' | 'role' | 'text'>,
): SessionTranscriptMessage {
  return {
    createdAt: '2026-09-03T00:00:00.000Z',
    status: 'done',
    ...overrides,
  };
}

describe('serializeLiveSessionTranscript', () => {
  it('labels user, assistant, and voice-handover turns and skips noise', () => {
    const serialized = serializeLiveSessionTranscript([
      message({ id: 'u1', role: 'user', text: '  fix live  ' }),
      message({ id: 'a1', role: 'assistant', text: 'Working on it.', thinking: 'secret' }),
      message({ id: 's1', role: 'system', text: 'internal' }),
      message({ id: 't1', role: 'tool', text: 'tool output' }),
      message({ id: 'stream', role: 'assistant', text: 'partial', status: 'streaming' }),
      message({ id: 'empty', role: 'user', text: '   ' }),
      message({
        id: 'v1',
        role: 'user',
        text: 'search docs',
        source: 'voice-delegation',
      }),
    ]);
    expect(serialized).toBe(
      '[User]: fix live\n\n[Assistant]: Working on it.\n\n[Voice handover]: search docs',
    );
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('internal');
    expect(serialized).not.toContain('partial');
  });

  it('keeps the tail that fits the byte budget and hard-clips a single oversized turn', () => {
    const tail = serializeLiveSessionTranscript(
      [
        message({ id: 'old', role: 'user', text: 'oldest' }),
        message({ id: 'mid', role: 'user', text: 'middle' }),
        message({ id: 'new', role: 'user', text: 'newest' }),
      ],
      20,
    );
    expect(tail).toContain('newest');
    expect(tail).not.toContain('oldest');

    const clipped = serializeLiveSessionTranscript(
      [message({ id: 'huge', role: 'user', text: 'x'.repeat(50) })],
      10,
    );
    expect(new TextEncoder().encode(clipped).byteLength).toBeLessThanOrEqual(10);
    expect(clipped.startsWith('[User]:')).toBe(true);
  });
});

describe('createLiveSessionContextSummarizer', () => {
  it('returns null for an empty transcript and does not call the model', async () => {
    const complete = vi.fn(async () => 'unused');
    const summarize = createLiveSessionContextSummarizer({ complete });
    await expect(
      summarize({
        sessionId: 's1',
        messages: [message({ id: 'empty', role: 'user', text: '  ' })],
        signal: new AbortController().signal,
        cacheKey: 's1:empty:xai/grok',
      }),
    ).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('strips fences, clips, caches by caller key, and skips a second complete', async () => {
    const complete = vi.fn<Parameters<typeof createLiveSessionContextSummarizer>[0]['complete']>(
      async () => '```\nSECRET\n``` The user is fixing Live voice.',
    );
    const summarize = createLiveSessionContextSummarizer({ complete });
    const input = {
      sessionId: 's1',
      messages: [message({ id: 'u1', role: 'user', text: 'fix live' })],
      signal: new AbortController().signal,
      cacheKey: 's1:u1:xai/grok',
    };
    const first = await summarize(input);
    const second = await summarize(input);
    expect(first).toBe('The user is fixing Live voice.');
    expect(second).toBe(first);
    expect(complete).toHaveBeenCalledTimes(1);
    const payload = complete.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      sessionId: 's1',
      systemPrompt: PIWIN_LIVE_SESSION_CONTEXT_PROMPT,
    });
    expect(payload?.userPrompt).toContain('[User]: fix live');
  });

  it('throws a stable error on empty model output and propagates abort', async () => {
    const empty = createLiveSessionContextSummarizer({ complete: async () => '```\n```' });
    await expect(
      empty({
        sessionId: 's1',
        messages: [message({ id: 'u1', role: 'user', text: 'hi' })],
        signal: new AbortController().signal,
        cacheKey: 's1:u1:empty',
      }),
    ).rejects.toBeInstanceOf(LiveSessionContextError);

    const complete = vi.fn(async () => 'late');
    const aborted = createLiveSessionContextSummarizer({ complete });
    await expect(
      aborted({
        sessionId: 's1',
        messages: [message({ id: 'u1', role: 'user', text: 'hi' })],
        signal: AbortSignal.abort(),
        cacheKey: 's1:u1:abort',
      }),
    ).rejects.toBeDefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it('evicts the oldest cache entry past the limit', async () => {
    let calls = 0;
    const summarize = createLiveSessionContextSummarizer({
      complete: async () => {
        calls += 1;
        return `summary-${calls}`;
      },
    });
    const messages = [message({ id: 'u1', role: 'user', text: 'hi' })];
    for (let index = 0; index < LIVE_SESSION_CONTEXT_CACHE_LIMIT + 1; index += 1) {
      await summarize({
        sessionId: 's1',
        messages,
        signal: new AbortController().signal,
        cacheKey: `s1:u1:model-${index}`,
      });
    }
    await summarize({
      sessionId: 's1',
      messages,
      signal: new AbortController().signal,
      cacheKey: 's1:u1:model-0',
    });
    expect(calls).toBe(LIVE_SESSION_CONTEXT_CACHE_LIMIT + 2);
  });
});
