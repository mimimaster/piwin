import { describe, expect, it, vi } from 'vitest';
import type { ModelRef, SessionTranscriptMessage } from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';
import {
  createLiveSessionContextSource,
  liveSessionContextCacheKey,
} from './live-session-context-source.js';
import type { LiveSessionModelCompletion } from './compose-live-completion.js';

const model: ModelRef = { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' };

function message(
  overrides: Partial<SessionTranscriptMessage> & Pick<SessionTranscriptMessage, 'id' | 'role' | 'text'>,
): SessionTranscriptMessage {
  return {
    createdAt: '2026-09-03T00:00:00.000Z',
    status: 'done',
    ...overrides,
  };
}

function storeWith(messages: SessionTranscriptMessage[]): SessionTranscriptStore {
  return {
    listTail: async () => messages,
  } as unknown as SessionTranscriptStore;
}

/** Mirrors the real composition: one resolve yields the model and its completer. */
function completionWith(
  complete: (request: { systemPrompt: string; userPrompt: string }) => Promise<string>,
): LiveSessionModelCompletion {
  return {
    complete: async (request) => complete(request),
    resolveModelRef: async () => model,
    forSession: async () => ({ model, complete: async (request) => complete(request) }),
  };
}

describe('createLiveSessionContextSource', () => {
  it('summarizes the transcript tail with the session model cache key', async () => {
    const complete = vi.fn(async () => 'User is fixing Live voice.');
    const source = createLiveSessionContextSource({
      getTranscriptStore: async () =>
        storeWith([message({ id: 'u1', role: 'user', text: 'fix live' })]),
      completion: completionWith(complete),
    });
    await expect(source.resolve('s1', new AbortController().signal)).resolves.toBe(
      'User is fixing Live voice.',
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('[User]: fix live'),
      }),
    );
    expect(liveSessionContextCacheKey('s1', 'u1', model)).toBe('s1:u1:xai/grok-4.6');
  });

  it('returns null without calling the model when the transcript is empty', async () => {
    const complete = vi.fn(async () => 'unused');
    const source = createLiveSessionContextSource({
      getTranscriptStore: async () => storeWith([]),
      completion: completionWith(complete),
    });
    await expect(source.resolve('s1', new AbortController().signal)).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('degrades to null when summarization throws and never logs the summary text', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    const source = createLiveSessionContextSource({
      getTranscriptStore: async () =>
        storeWith([message({ id: 'u1', role: 'user', text: 'secret-brief' })]),
      completion: completionWith(async () => {
        throw new Error('model-down');
      }),
    });
    try {
      await expect(source.resolve('s1', new AbortController().signal)).resolves.toBeNull();
      expect(errors.some((line) => line.includes('startup context unavailable'))).toBe(true);
      expect(errors.join('\n')).not.toContain('secret-brief');
    } finally {
      console.error = original;
    }
  });

  it('rethrows when the caller aborts', async () => {
    const source = createLiveSessionContextSource({
      getTranscriptStore: async () => storeWith([message({ id: 'u1', role: 'user', text: 'hi' })]),
      completion: completionWith(async () => 'unused'),
    });
    await expect(source.resolve('s1', AbortSignal.abort())).rejects.toBeDefined();
  });
});
