import { describe, expect, it } from 'vitest';
import {
  applyNativeSearchToPayload,
  wrapStreamSimpleForNativeSearch,
  type NativeSearchStreamSimple,
} from './native-web-search.js';

describe('applyNativeSearchToPayload', () => {
  it('uses Chat Completions web_search_options without a Responses-only tool', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'search-model', messages: [] },
      'openai-web-search-options',
    ) as Record<string, unknown>;

    expect(payload.web_search_options).toEqual({});
    expect(payload.tools).toBeUndefined();
  });

  it('adds the Anthropic hosted tool next to existing function tools', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'odd-gateway', tools: [{ type: 'function', name: 'keep' }] },
      'anthropic-web-search-tool',
    ) as Record<string, unknown>;

    expect(payload.tools).toEqual([
      { type: 'function', name: 'keep' },
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);
    expect(payload.web_search_options).toBeUndefined();
  });

  it('does not guess a wire shape without an adapter', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'vendor-model', messages: [] },
      undefined,
    ) as Record<string, unknown>;

    expect(payload).toEqual({ model: 'vendor-model', messages: [] });
  });

  it('selects the Responses tool when the adapter declares openai-responses-tool', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'responses-model', messages: [] },
      'openai-responses-tool',
    ) as Record<string, unknown>;

    expect(payload.tools).toEqual([{ type: 'web_search' }]);
    expect(payload.include).toEqual(['web_search_call.action.sources']);
    expect(payload.web_search_options).toBeUndefined();
  });

  it('uses the @google/genai camelCase search tool shape', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'gemini-search', config: { tools: [] } },
      'google-search-tool',
    ) as Record<string, unknown>;

    expect(payload.config).toEqual({ tools: [{ googleSearch: {} }] });
  });
});

describe('wrapStreamSimpleForNativeSearch', () => {
  it('injects the model adapter and preserves the Host web_search function tool', async () => {
    let seen: unknown;
    const base: NativeSearchStreamSimple = async (_model, _context, options) => {
      seen = await options?.onPayload?.({ tools: [{ type: 'function', name: 'web_search' }] }, {});
      return {};
    };
    const wrapped = wrapStreamSimpleForNativeSearch(base, {
      models: [{ id: 'm', nativeSearchAdapter: 'openai-responses-tool' }],
    });
    await wrapped?.({ id: 'm', api: 'openai-responses' }, {}, {});
    expect((seen as Record<string, unknown>).tools).toEqual([
      { type: 'function', name: 'web_search' },
      { type: 'web_search' },
    ]);
  });
});
