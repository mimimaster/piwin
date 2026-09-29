import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  completeNativeModelWebSearch,
  NativeModelWebSearchError,
} from './native-model-web-search.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

function provider(overrides: Partial<ModelProviderConfig>, adapter: string): ModelProviderConfig {
  return {
    id: 'p',
    name: 'P',
    protocol: 'openai-compatible',
    chatApi: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'm',
        capabilities: ['chat', 'native-web-search'],
        nativeSearchAdapter: adapter as never,
      },
    ],
    ...overrides,
  };
}

const RESPONSES_BODY = JSON.stringify({
  output: [
    { type: 'web_search_call', action: { query: 'q issued', sources: [{ url: 'https://a.example', title: 'A' }] } },
    {
      type: 'message',
      content: [{ type: 'output_text', text: 'Brief [A].', annotations: [{ type: 'url_citation', url: 'https://a.example' }] }],
    },
  ],
});

/** Fake Pi stream that exercises onPayload + the tee'd fetch like a real adapter would. */
function fakePi(body: string | undefined, capture: { payload?: unknown; options?: Record<string, unknown> } = {}) {
  const streamSimple: NativeSearchStreamSimple = (model, _context, options) => ({
    async result() {
      capture.options = options as Record<string, unknown>;
      capture.payload = await options?.onPayload?.({ model: model.id, input: [], tools: [] }, model);
      if (body !== undefined && typeof options?.fetch === 'function') {
        const response = await (options.fetch as typeof fetch)('https://api.example/v1/responses');
        await response.text();
      }
      return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Brief [A].' }] };
    },
  });
  return streamSimple;
}

describe('completeNativeModelWebSearch', () => {
  it('OpenAI Responses: injects web_search, tees the body, returns grounded evidence', async () => {
    const capture: { payload?: unknown; options?: Record<string, unknown> } = {};
    const result = await completeNativeModelWebSearch(
      { provider: provider({}, 'openai-responses-tool'), modelId: 'm', apiKey: 'k', query: 'q', maxResults: 5 },
      { streamSimple: fakePi(RESPONSES_BODY, capture), fetch: async () => new Response(RESPONSES_BODY) },
    );
    expect(capture.payload).toMatchObject({ tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] });
    expect(capture.options?.reasoning).toBe('low');
    expect(result.answer).toBe('Brief [A].');
    expect(result.searchQueries).toEqual(['q issued']);
    expect(result.hits).toEqual([{ title: 'A', url: 'https://a.example', snippet: '' }]);
    expect(result.nativeDiagnostic).toMatchObject({
      providerId: 'p',
      adapter: 'openai-responses-tool',
      transport: 'pi-tee',
      eventDetected: true,
      hitCount: 1,
    });
    expect(JSON.stringify(result.nativeDiagnostic)).not.toContain('q issued');
  });

  it('keeps Pi text but no hits when the transport exposes no body (Codex WS)', async () => {
    const result = await completeNativeModelWebSearch(
      { provider: provider({}, 'openai-responses-tool'), modelId: 'm', query: 'q', maxResults: 5 },
      { streamSimple: fakePi(undefined) },
    );
    expect(result.hits).toEqual([]);
    expect(result.answer).toBe('Brief [A].');
    expect(result.warning).toMatch(/no response body/u);
  });

  it('Anthropic: continues pause_turn with raw content at most twice', async () => {
    let calls = 0;
    const payloads: unknown[] = [];
    const paused = JSON.stringify({
      content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 'q1' } }],
      stop_reason: 'pause_turn',
    });
    const streamSimple: NativeSearchStreamSimple = (model, _context, options) => ({
      async result() {
        calls += 1;
        payloads.push(await options?.onPayload?.({ messages: [{ role: 'user', content: 'x' }] }, model));
        const response = await (options?.fetch as typeof fetch)('https://api.anthropic.com/v1/messages');
        await response.text();
        return { role: 'assistant', stopReason: 'stop', content: [] };
      },
    });
    const result = await completeNativeModelWebSearch(
      {
        provider: provider(
          { protocol: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com', headers: { 'anthropic-beta': 'a' } },
          'anthropic-web-search-tool',
        ),
        modelId: 'm',
        apiKey: 'k',
        query: 'q',
        maxResults: 5,
      },
      { streamSimple, fetch: async () => new Response(paused) },
    );
    expect(calls).toBe(3);
    const last = payloads[2] as { messages: unknown[]; tools: unknown[] };
    expect(last.messages).toHaveLength(2);
    expect(last.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
    expect(result.searchQueries).toEqual(['q1']);
  });

  it('Gemini uses direct REST and never calls Pi', async () => {
    let piCalled = false;
    const body = JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: 'G' }] },
          groundingMetadata: {
            webSearchQueries: ['gq'],
            groundingChunks: [{ web: { uri: 'https://g.example', title: 'g' } }],
            searchEntryPoint: { renderedContent: '<div>chips</div>' },
          },
        },
      ],
    });
    const result = await completeNativeModelWebSearch(
      {
        provider: provider(
          { protocol: 'google-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
          'google-search-tool',
        ),
        modelId: 'm',
        apiKey: 'k',
        query: 'q',
        maxResults: 5,
      },
      {
        streamSimple: () => {
          piCalled = true;
          return {};
        },
        fetch: async () => new Response(body),
      },
    );
    expect(piCalled).toBe(false);
    expect(result.searchSuggestionsHtml).toBe('<div>chips</div>');
    expect(result.nativeDiagnostic?.transport).toBe('gemini-rest');
  });

  it('rejects untagged or adapter-less models before any request', async () => {
    const untagged = provider({}, 'openai-responses-tool');
    const model = untagged.models[0];
    if (!model) throw new Error('fixture');
    model.capabilities = ['chat'];
    await expect(
      completeNativeModelWebSearch({ provider: untagged, modelId: 'm', query: 'q', maxResults: 5 }),
    ).rejects.toBeInstanceOf(NativeModelWebSearchError);
    const unknown = provider({}, 'not-an-adapter');
    await expect(
      completeNativeModelWebSearch({ provider: unknown, modelId: 'm', query: 'q', maxResults: 5 }),
    ).rejects.toBeInstanceOf(NativeModelWebSearchError);
  });

  it('maps provider errors to a stable error carrying a bounded diagnostic', async () => {
    const streamSimple: NativeSearchStreamSimple = () => ({
      async result() {
        return { role: 'assistant', stopReason: 'error', errorMessage: 'x'.repeat(900), content: [] };
      },
    });
    const error = await completeNativeModelWebSearch(
      { provider: provider({}, 'openai-responses-tool'), modelId: 'm', query: 'q', maxResults: 5 },
      { streamSimple },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NativeModelWebSearchError);
    expect((error as NativeModelWebSearchError).diagnostic?.error?.length).toBe(300);
  });

  it('sends Anthropic search with an integer max_tokens and thinking off through the real Pi stream', async () => {
    let body: Record<string, unknown> | undefined;
    const fetchSpy = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"captured"}}', {
        status: 400,
      });
    }) as typeof fetch;
    await completeNativeModelWebSearch(
      {
        provider: {
          id: 'custom-anthropic',
          name: 'CPA Anthropic',
          protocol: 'anthropic-compatible',
          baseUrl: 'http://127.0.0.1:8317',
          models: [
            {
              id: 'claude-opus-5-5',
              capabilities: ['chat', 'native-web-search'],
              nativeSearchAdapter: 'anthropic-web-search-tool',
              maxOutputTokens: 128_000,
              thinkingLevels: ['low', 'medium', 'high', 'max'],
            },
          ],
        },
        modelId: 'claude-opus-5-5',
        apiKey: 'k',
        query: 'q',
        maxResults: 5,
      },
      { fetch: fetchSpy },
    ).catch(() => undefined);

    expect(Number.isInteger(body?.max_tokens)).toBe(true);
    expect((body?.thinking as { type?: string } | undefined)?.type).not.toBe('enabled');
    expect(body?.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  });
});
