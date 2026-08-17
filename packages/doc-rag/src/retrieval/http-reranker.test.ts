import { describe, expect, it, vi } from 'vitest';
import { createHttpReranker } from './http-reranker.js';

describe('createHttpReranker', () => {
  it('maps /rerank results back onto document ids', async () => {
    const fetchImpl = vi.fn(async (..._args: unknown[]) =>
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const reranker = createHttpReranker({
      providerId: 'router',
      modelId: 'rerank-english-v3.0',
      baseUrl: 'https://router.example/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ranked = await reranker.rerank({
      query: 'spaced repetition',
      documents: [
        { id: 'a', text: 'first' },
        { id: 'b', text: 'second' },
      ],
      topK: 2,
    });
    expect(ranked.map((item) => item.id)).toEqual(['b', 'a']);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://router.example/v1/rerank');
  });
});
