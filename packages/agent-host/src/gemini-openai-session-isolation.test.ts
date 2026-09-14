import { describe, expect, it } from 'vitest';
import {
  applyGeminiOpenAiSessionIsolation,
  geminiOpenAiPromptCacheKey,
  isGeminiOpenAiCompatModelId,
  sanitizeGeminiOpenAiMessages,
  wrapStreamSimpleForGeminiOpenAiSession,
} from './gemini-openai-session-isolation.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

describe('gemini OpenAI session isolation', () => {
  it('matches Gemini ids behind local OpenAI-compat aliases', () => {
    expect(isGeminiOpenAiCompatModelId('gemini-3.8-flash-high')).toBe(true);
    expect(isGeminiOpenAiCompatModelId('custom/gemini-3.6-flash-high')).toBe(true);
    expect(isGeminiOpenAiCompatModelId('grok-4.5')).toBe(false);
  });

  it('keys off the latest user turn index plus text, ignoring later tool turns', () => {
    const first = geminiOpenAiPromptCacheKey([
      { role: 'user', content: 'install the extension' },
      { role: 'assistant', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ]);
    const sameUser = geminiOpenAiPromptCacheKey([
      { role: 'user', content: 'install the extension' },
      { role: 'assistant', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'assistant', tool_calls: [{ id: 'c2' }] },
      { role: 'tool', tool_call_id: 'c2', content: 'still ok' },
    ]);
    const nextUser = geminiOpenAiPromptCacheKey([
      { role: 'user', content: 'install the extension' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: '你可以回滚' },
    ]);
    const retrySameText = geminiOpenAiPromptCacheKey([
      { role: 'user', content: 'install the extension' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: '你可以回滚' },
      { role: 'user', content: '你可以回滚' },
    ]);
    expect(first).toBeDefined();
    expect(sameUser).toBe(first);
    expect(nextUser).toBeDefined();
    expect(nextUser).not.toBe(first);
    expect(retrySameText).not.toBe(nextUser);
  });

  it('drops leading assistant/tool orphans left after the first user is trimmed', () => {
    const messages = [
      { role: 'developer', content: 'system' },
      { role: 'assistant', tool_calls: [{ id: 'orphan-1' }] },
      { role: 'tool', tool_call_id: 'orphan-1', content: 'left behind' },
      { role: 'assistant', tool_calls: [{ id: 'orphan-2' }] },
      { role: 'tool', tool_call_id: 'orphan-2', content: 'also left behind' },
      { role: 'user', content: '你自己安装下' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '你可以回滚' },
    ];
    expect(sanitizeGeminiOpenAiMessages(messages)).toEqual([
      { role: 'developer', content: 'system' },
      { role: 'user', content: '你自己安装下' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '你可以回滚' },
    ]);
  });

  it('leaves an already-legal history unchanged', () => {
    const messages = [
      { role: 'developer', content: 'system' },
      { role: 'user', content: 'install' },
      { role: 'assistant', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ];
    expect(sanitizeGeminiOpenAiMessages(messages)).toBe(messages);
  });

  it('writes prompt_cache_key and sanitized messages without mutating the original', () => {
    const payload = {
      model: 'gemini-3.8-flash-high',
      messages: [
        { role: 'developer', content: 'system' },
        { role: 'assistant', tool_calls: [{ id: 'orphan' }] },
        { role: 'tool', tool_call_id: 'orphan', content: 'stale' },
        { role: 'user', content: '你可以回滚' },
      ],
    };
    const next = applyGeminiOpenAiSessionIsolation(payload) as Record<string, unknown>;
    const sanitized = sanitizeGeminiOpenAiMessages(payload.messages);
    expect(next.messages).toEqual(sanitized);
    expect(next.prompt_cache_key).toBe(geminiOpenAiPromptCacheKey(sanitized));
    expect(next.session_id).toBe(next.prompt_cache_key);
    expect(payload.messages).toHaveLength(4);
    expect(payload).not.toHaveProperty('prompt_cache_key');
  });

  it('wraps Gemini OpenAI streams, sets Session-Id, and leaves other models alone', async () => {
    const seen: Array<{ payload: unknown; headers?: unknown }> = [];
    const base: NativeSearchStreamSimple = async (_model, _context, options) => {
      const payload = {
        messages: [
          { role: 'assistant', tool_calls: [{ id: 'orphan' }] },
          { role: 'user', content: 'follow-up' },
        ],
      };
      const transformed = await options?.onPayload?.(payload, { id: 'gemini-3.8-flash-high' });
      seen.push({ payload: transformed ?? payload, headers: options?.headers });
      return transformed ?? payload;
    };
    const wrapped = wrapStreamSimpleForGeminiOpenAiSession(base);
    const gemini = (await wrapped?.(
      { id: 'gemini-3.8-flash-high', api: 'openai-completions' },
      {
        messages: [
          { role: 'assistant', tool_calls: [{ id: 'orphan' }] },
          { role: 'user', content: 'follow-up' },
        ],
      },
      {},
    )) as Record<string, unknown>;
    const expectedKey = geminiOpenAiPromptCacheKey([{ role: 'user', content: 'follow-up' }]);
    expect(gemini.prompt_cache_key).toEqual(expectedKey);
    expect(gemini.messages).toEqual([{ role: 'user', content: 'follow-up' }]);
    expect(seen[0]?.headers).toMatchObject({
      'Session-Id': expectedKey,
      'X-Session-Affinity': expectedKey,
    });

    seen.length = 0;
    const grokBase: NativeSearchStreamSimple = async (_model, _context, options) => {
      const payload = { messages: [{ role: 'user', content: 'follow-up' }] };
      const transformed = await options?.onPayload?.(payload, { id: 'grok-4.5' });
      seen.push({ payload: transformed ?? payload, headers: options?.headers });
      return transformed ?? payload;
    };
    const grokWrapped = wrapStreamSimpleForGeminiOpenAiSession(grokBase);
    const grok = await grokWrapped?.({ id: 'grok-4.5', api: 'openai-completions' }, {}, {});
    expect(grok).not.toHaveProperty('prompt_cache_key');
    expect(seen[0]?.payload).not.toHaveProperty('prompt_cache_key');
    expect(seen[0]?.headers).toBeUndefined();
  });
});
