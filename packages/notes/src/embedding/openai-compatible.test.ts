import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleEmbedding } from './openai-compatible.js';
import { createOllamaEmbedding } from './ollama.js';
import { createEmbeddingProvider } from './create-provider.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createOpenAiCompatibleEmbedding', () => {
  it('posts to /embeddings with bearer auth and parses vectors by index', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    );
    const provider = createOpenAiCompatibleEmbedding({
      baseUrl: 'https://api.example.com/v1/',
      model: 'test-embed',
      apiKey: 'sk-test',
      dimensions: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const vectors = await provider.embed(['first', 'second']);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/embeddings');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'test-embed',
      input: ['first', 'second'],
    });
    // Reordered response is resolved via index field.
    expect([...(vectors[0] ?? [])]).toEqual([Math.fround(0.1), Math.fround(0.2)]);
    expect([...(vectors[1] ?? [])]).toEqual([Math.fround(0.3), Math.fround(0.4)]);
  });

  it('throws on http error and shape mismatch', async () => {
    const failing = createOpenAiCompatibleEmbedding({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    });
    await expect(failing.embed(['a'])).rejects.toThrow('embedding request failed: 500');

    const mismatched = createOpenAiCompatibleEmbedding({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: (async () => jsonResponse({ data: [] })) as typeof fetch,
    });
    await expect(mismatched.embed(['a'])).rejects.toThrow('shape mismatch');
  });

  it('short-circuits empty input without network', async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAiCompatibleEmbedding({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates abort', async () => {
    const provider = createOpenAiCompatibleEmbedding({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return jsonResponse({ data: [{ index: 0, embedding: [1] }] });
      }) as typeof fetch,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.embed(['a'], controller.signal)).rejects.toThrow();
  });
});

describe('createOllamaEmbedding', () => {
  it('posts to /api/embed without auth and parses embeddings array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ embeddings: [[0.5, 0.6]] }));
    const provider = createOllamaEmbedding({
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const vectors = await provider.embed(['hello']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/embed');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(vectors).toHaveLength(1);
  });
});

describe('createEmbeddingProvider', () => {
  it('maps config to the right provider and passes secrets through', () => {
    const openai = createEmbeddingProvider({
      config: {
        provider: 'openai-compatible',
        baseUrl: 'https://x',
        model: 'm',
        dimensions: 4,
      },
      apiKey: 'sk',
    });
    expect(openai?.id).toBe('openai-compatible');
    expect(openai?.dimensions).toBe(4);

    const ollama = createEmbeddingProvider({
      config: { provider: 'ollama', baseUrl: 'http://l', model: 'm' },
    });
    expect(ollama?.id).toBe('ollama');
  });
});
