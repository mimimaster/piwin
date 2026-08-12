import { describe, expect, it, vi } from 'vitest';
import type { ModelRef } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import {
  parseWebSearchModelResponse,
  WebSearchModelDelegateResponseError,
  type WebSearchModelDelegate,
} from './model-search-delegate.js';
import { webSearch } from './search-provider.js';

const delegateModel: ModelRef = {
  protocol: 'google-gemini',
  providerId: 'gemini',
  modelId: 'gemini-search',
};

describe('model web-search delegation', () => {
  it('parses fenced JSON, validates URLs, deduplicates, and enforces the limit', () => {
    const hits = parseWebSearchModelResponse(
      [
        '```json',
        JSON.stringify({
          hits: [
            { title: 'A', url: 'https://example.com/a', snippet: 'first' },
            { title: 'A duplicate', url: 'https://example.com/a', snippet: 'duplicate' },
            { title: 'Unsafe', url: 'file:///tmp/nope', snippet: 'bad' },
            { title: 'B', link: 'https://example.com/b', description: 'second' },
          ],
        }),
        '```',
      ].join('\n'),
      2,
    );

    expect(hits).toEqual([
      {
        title: 'A',
        url: 'https://example.com/a',
        snippet: 'first',
        source: 'model-delegate',
      },
      {
        title: 'B',
        url: 'https://example.com/b',
        snippet: 'second',
        source: 'model-delegate',
      },
    ]);
  });

  it('fails when the delegate does not return valid result URLs', () => {
    expect(() => parseWebSearchModelResponse('{"hits":[{"url":"file:///tmp/no"}]}', 5)).toThrow(
      WebSearchModelDelegateResponseError,
    );
  });

  it('uses the selected model exclusively instead of ordinary search sources', async () => {
    const search = vi.fn<WebSearchModelDelegate['search']>(async () => [
      {
        title: 'Delegated',
        url: 'https://example.com/delegated',
        snippet: 'from Gemini',
        source: 'model-delegate',
      },
    ]);
    const config = {
      ...createDefaultWebConfig(),
      searchDelegateModel: delegateModel,
    };

    const result = await webSearch(
      'current result',
      config,
      undefined,
      {},
      {
        model: delegateModel,
        search,
      },
    );

    expect(search).toHaveBeenCalledWith(
      'current result',
      expect.objectContaining({ limit: config.searchMaxResults }),
    );
    expect(result.providerId).toBe('model-delegate:gemini/gemini-search');
    expect(result.hits[0]?.title).toBe('Delegated');
  });
});
