import { describe, expect, it } from 'vitest';
import {
  buildVertexGenerateContentUrl,
  completeVertexRestSearch,
  VertexRestSearchError,
} from './native-search-vertex-rest.js';

const prompts = { systemPrompt: 's', userPrompt: 'u', maxOutputTokens: 64 };

describe('Vertex REST native search', () => {
  it('builds project-scoped, express and custom endpoint URLs', () => {
    expect(buildVertexGenerateContentUrl({ project: 'p', location: 'global', modelId: 'gemini-2.5-pro' })).toBe(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-2.5-pro:generateContent',
    );
    expect(buildVertexGenerateContentUrl({ location: 'global', modelId: 'models/gemini-2.5-pro' })).toBe(
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-pro:generateContent',
    );
    expect(
      buildVertexGenerateContentUrl({
        baseUrl: 'https://proxy.example/v1beta1/',
        project: 'p',
        location: 'europe-west4',
        modelId: 'gemini-2.5-pro',
      }),
    ).toBe(
      'https://proxy.example/v1beta1/projects/p/locations/europe-west4/publishers/google/models/gemini-2.5-pro:generateContent',
    );
    // Pi's location template is not a custom endpoint.
    expect(
      buildVertexGenerateContentUrl({
        baseUrl: 'https://{location}-aiplatform.googleapis.com',
        project: 'p',
        location: 'us-central1',
        modelId: 'm',
      }),
    ).toContain('https://us-central1-aiplatform.googleapis.com/v1/projects/p/');
    expect(() => buildVertexGenerateContentUrl({ baseUrl: 'ftp://x', location: 'global', modelId: 'm' })).toThrow(
      VertexRestSearchError,
    );
  });

  it('uses the Vertex API key in express mode and never asks for ADC', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    await completeVertexRestSearch(
      { ...prompts, apiKey: 'vk', project: 'p', modelId: 'gemini-2.5-pro' },
      async (url, init) => {
        seen = { url: String(url), headers: init?.headers as Record<string, string> };
        return new Response('{}');
      },
      async () => {
        throw new Error('ADC must not be used with a key');
      },
    );
    expect(seen?.url).toBe(
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-pro:generateContent',
    );
    expect(seen?.headers['x-goog-api-key']).toBe('vk');
    expect(seen?.headers.authorization).toBeUndefined();
  });

  it('passes the service-account file to ADC and hides HTTP error bodies', async () => {
    let credentials: string | undefined;
    const error = await completeVertexRestSearch(
      { ...prompts, project: 'p', credentialsFile: ' /tmp/sa.json ', modelId: 'm' },
      async () => new Response('secret detail', { status: 403 }),
      async (input) => {
        credentials = input.credentialsFile;
        return 't';
      },
    ).catch((caught: unknown) => caught);
    expect(credentials).toBe('/tmp/sa.json');
    expect(error).toBeInstanceOf(VertexRestSearchError);
    expect((error as Error).message).toBe('Vertex AI native search HTTP 403');
  });
});
