import { describe, expect, it, vi } from 'vitest';
import type { NoteRecord, NoteSearchHit } from '@piwin/contracts';
import { applyRanking, createLlmRerank, parseRankingIds } from './llm-rerank.js';

function makeHit(id: string): NoteSearchHit {
  const note: NoteRecord = {
    id,
    collection: 'default',
    title: `title ${id}`,
    content: `content ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    relativePath: `default/${id}.md`,
    contentHash: `hash-${id}`,
  };
  return { note, score: 1, snippet: `snippet ${id}`, channels: ['fts'], rank: { fts: 1 } };
}

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('parseRankingIds', () => {
  it('parses a bare JSON array', () => {
    expect(parseRankingIds('["a","b"]')).toEqual(['a', 'b']);
  });

  it('extracts array from fenced/prose output', () => {
    expect(parseRankingIds('Sure! Here:\n```json\n["x","y"]\n```')).toEqual(['x', 'y']);
  });

  it('throws on garbage', () => {
    expect(() => parseRankingIds('no array here')).toThrow();
    expect(() => parseRankingIds('[]')).toThrow('empty');
  });
});

describe('applyRanking', () => {
  it('reorders by ranking and stamps reranked rank', () => {
    const hits = [makeHit('a'), makeHit('b'), makeHit('c')];
    const result = applyRanking(hits, ['c', 'a', 'b']);
    expect(result.map((hit) => hit.note.id)).toEqual(['c', 'a', 'b']);
    expect(result[0]?.rank.reranked).toBe(1);
    expect(result[2]?.rank.reranked).toBe(3);
  });

  it('appends candidates missing from partial/hallucinated rankings', () => {
    const hits = [makeHit('a'), makeHit('b'), makeHit('c')];
    const result = applyRanking(hits, ['b', 'nonexistent', 'b']);
    expect(result.map((hit) => hit.note.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('createLlmRerank', () => {
  it('reorders hits per model ranking', async () => {
    const fetchImpl = vi.fn(async () => chatResponse('["note-2","note-1"]'));
    const rerank = createLlmRerank({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      apiKey: 'sk-x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await rerank.rerank('query', [makeHit('note-1'), makeHit('note-2')]);
    expect(result.map((hit) => hit.note.id)).toEqual(['note-2', 'note-1']);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-x');
  });

  it('returns original order on request failure', async () => {
    const rerank = createLlmRerank({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: (async () => new Response('down', { status: 503 })) as typeof fetch,
    });
    const hits = [makeHit('a'), makeHit('b')];
    expect(await rerank.rerank('q', hits)).toEqual(hits);
  });

  it('returns original order on malformed model output', async () => {
    const rerank = createLlmRerank({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: (async () => chatResponse('I cannot rank these documents.')) as typeof fetch,
    });
    const hits = [makeHit('a'), makeHit('b')];
    expect(await rerank.rerank('q', hits)).toEqual(hits);
  });

  it('skips network entirely for <2 hits', async () => {
    const fetchImpl = vi.fn();
    const rerank = createLlmRerank({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const single = [makeHit('a')];
    expect(await rerank.rerank('q', single)).toEqual(single);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('only sends top maxCandidates and keeps the tail', async () => {
    const fetchImpl = vi.fn(async () => chatResponse('["b","a"]'));
    const rerank = createLlmRerank({
      baseUrl: 'https://x',
      model: 'm',
      maxCandidates: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await rerank.rerank('q', [makeHit('a'), makeHit('b'), makeHit('tail')]);
    expect(result.map((hit) => hit.note.id)).toEqual(['b', 'a', 'tail']);
  });
});
