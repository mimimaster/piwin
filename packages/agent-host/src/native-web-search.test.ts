import { describe, expect, it } from 'vitest';
import { normalizeNativeSearchCitations } from './native-web-search.js';

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
        groundingChunks: [
          { web: { uri: 'https://example.com/google', title: 'Google result' } },
        ],
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
