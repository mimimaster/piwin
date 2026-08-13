import { describe, expect, it } from 'vitest';
import { applyNativeSearchToPayload, normalizeNativeSearchCitations } from './native-web-search.js';

describe('applyNativeSearchToPayload', () => {
  it('uses Chat Completions web_search_options without a Responses-only tool', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'search-model', messages: [] },
      true,
      'openai-completions',
    ) as Record<string, unknown>;

    expect(payload.web_search_options).toEqual({});
    expect(payload.tools).toBeUndefined();
  });

  it('honors a declared adapter over model api sniffing', () => {
    // The model api says Google, but the model declares the Anthropic tool
    // mechanism; the declaration wins.
    const payload = applyNativeSearchToPayload(
      { model: 'odd-gateway', tools: [{ type: 'function', name: 'keep' }] },
      true,
      'google-generative-ai',
      'anthropic-web-search-tool',
    ) as Record<string, unknown>;

    expect(payload.tools).toEqual([
      { type: 'function', name: 'keep' },
      { type: 'web_search_20250305', name: 'web_search' },
    ]);
    expect(payload.web_search_options).toBeUndefined();
  });

  it('does not guess a wire shape for a vendor-specific adapter', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'vendor-model', messages: [] },
      true,
      'openai-completions',
      'vendor-specific',
    ) as Record<string, unknown>;

    expect(payload).toEqual({ model: 'vendor-model', messages: [] });
  });

  it('selects the Responses tool when the adapter declares openai-responses-tool', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'responses-model', messages: [] },
      true,
      'openai-completions',
      'openai-responses-tool',
    ) as Record<string, unknown>;

    expect(payload.tools).toEqual([{ type: 'web_search_preview' }]);
    expect(payload.web_search_options).toBeUndefined();
  });

  it('uses the @google/genai camelCase search tool shape', () => {
    const payload = applyNativeSearchToPayload(
      { model: 'gemini-search', config: { tools: [] } },
      true,
      'google-generative-ai',
    ) as Record<string, unknown>;

    expect(payload.config).toEqual({ tools: [{ googleSearch: {} }] });
  });

  it('strips nested Google search tools without removing function declarations', () => {
    const payload = applyNativeSearchToPayload(
      {
        model: 'gemini-search',
        config: {
          tools: [{ googleSearch: {} }, { functionDeclarations: [{ name: 'web_search' }] }],
        },
      },
      false,
      'google-generative-ai',
    ) as Record<string, unknown>;

    expect(payload.config).toEqual({
      tools: [{ functionDeclarations: [{ name: 'web_search' }] }],
    });
  });

  it('strips provider-native tools but preserves the external Host web_search tool', () => {
    const payload = applyNativeSearchToPayload(
      {
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          { name: 'web_search', description: 'Host tool', input_schema: { type: 'object' } },
          { type: 'function', function: { name: 'web_search' } },
        ],
      },
      false,
      'anthropic-messages',
    ) as Record<string, unknown>;

    expect(payload.tools).toEqual([
      { name: 'web_search', description: 'Host tool', input_schema: { type: 'object' } },
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });
});

describe('normalizeNativeSearchCitations', () => {
  it('normalizes OpenAI URL annotations with native provenance', () => {
    const evidence = normalizeNativeSearchCitations({
      query: 'piwin',
      annotations: [
        {
          type: 'url_citation',
          url_citation: { url: 'https://example.com/piwin', title: 'Piwin' },
        },
      ],
    });

    expect(evidence).toEqual({
      query: 'piwin',
      provenance: 'native',
      citations: [
        {
          title: 'Piwin',
          url: 'https://example.com/piwin',
          provenance: 'native',
        },
      ],
    });
  });

  it('normalizes Google grounding metadata', () => {
    const evidence = normalizeNativeSearchCitations({
      groundingMetadata: {
        groundingChunks: [{ web: { uri: 'https://example.com/google', title: 'Google result' } }],
      },
    });

    expect(evidence).toEqual({
      provenance: 'native',
      citations: [
        {
          title: 'Google result',
          url: 'https://example.com/google',
          provenance: 'native',
        },
      ],
    });
  });

  it('normalizes Anthropic-style citation arrays nested in content', () => {
    const evidence = normalizeNativeSearchCitations({
      content: [
        {
          type: 'text',
          text: 'grounded answer',
          citations: [
            {
              title: 'Piwin docs',
              url: 'https://example.com/docs',
              cited_text: 'The cited passage.',
              source: 'docs',
            },
          ],
        },
      ],
    });

    expect(evidence).toEqual({
      provenance: 'native',
      citations: [
        {
          title: 'Piwin docs',
          url: 'https://example.com/docs',
          snippet: 'The cited passage.',
          source: 'docs',
          provenance: 'native',
        },
      ],
    });
  });

  it('drops non-http citation URLs and deduplicates by normalized URL', () => {
    const evidence = normalizeNativeSearchCitations({
      citations: [
        { title: 'Unsafe', url: 'javascript:alert(1)' },
        { title: 'One', url: '  https://example.com/a  ', snippet: 'first' },
        { title: 'Duplicate', url: 'HTTPS://EXAMPLE.COM/a', snippet: 'second' },
      ],
    });

    expect(evidence?.citations).toEqual([
      {
        title: 'One',
        url: 'https://example.com/a',
        snippet: 'first',
        provenance: 'native',
      },
    ]);
    expect(evidence?.citations.every((citation) => citation.provenance === 'native')).toBe(true);
  });
});
