import { describe, expect, it } from 'vitest';
import { completeGeminiRestSearch, GeminiRestSearchError } from './native-search-gemini-rest.js';

const base = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelId: 'gemini-2.5-flash',
  systemPrompt: 's',
  userPrompt: 'u',
  maxOutputTokens: 100,
};

describe('Gemini REST native search', () => {
  it('posts google_search with x-goog-api-key and returns the raw body', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const body = await completeGeminiRestSearch(
      { ...base, apiKey: 'k', headers: { 'x-gw': '1' } },
      async (input, init) => {
        seenUrl = String(input);
        seenInit = init;
        return new Response('{"candidates":[]}', { status: 200 });
      },
    );
    expect(body).toBe('{"candidates":[]}');
    expect(seenUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(seenInit?.headers).toMatchObject({ 'x-goog-api-key': 'k', 'x-gw': '1' });
    expect(JSON.parse(String(seenInit?.body)).tools).toEqual([{ google_search: {} }]);
  });

  it('appends v1beta to bare roots', async () => {
    let seenUrl = '';
    await completeGeminiRestSearch({ ...base, baseUrl: 'https://gw.example/', apiKey: 'k' }, async (input) => {
      seenUrl = String(input);
      return new Response('{}');
    });
    expect(seenUrl).toBe('https://gw.example/v1beta/models/gemini-2.5-flash:generateContent');
  });

  it('fails closed for OAuth (no key), Vertex, and HTTP errors', async () => {
    const ok = async () => new Response('{}');
    await expect(completeGeminiRestSearch(base, ok)).rejects.toBeInstanceOf(GeminiRestSearchError);
    await expect(
      completeGeminiRestSearch({ ...base, apiKey: 'k', baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1' }, ok),
    ).rejects.toThrow(/Vertex/u);
    await expect(
      completeGeminiRestSearch({ ...base, apiKey: 'k' }, async () => new Response('bad', { status: 400 })),
    ).rejects.toThrow(/HTTP 400/u);
  });
});
