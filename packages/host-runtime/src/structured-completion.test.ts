import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { completeStructured, completeStructuredText, StructuredCompletionError } from './structured-completion.js';

function createProvider(): ModelProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'TEST_KEY',
    models: [],
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchMock = Mock<typeof globalThis.fetch>;

describe('completeStructuredText', () => {
  it('does not add response_format when no jsonSchema is given', async () => {
    const fetchSpy = vi.fn(async () =>
      createJsonResponse({ choices: [{ message: { content: 'plain' } }] }),
    ) as unknown as FetchMock;
    const result = await completeStructuredText(
      {
        provider: createProvider(),
        modelId: 'm',
        systemPrompt: 'sys',
        userPrompt: 'user',
        maxOutputTokens: 16,
        temperature: 0,
        signal: new AbortController().signal,
      },
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(result.text).toBe('plain');
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    expect(body.response_format).toBeUndefined();
  });

  it('asks OpenAI-compatible providers for json_schema when provided', async () => {
    const fetchSpy = vi.fn(async () =>
      createJsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    ) as unknown as FetchMock;
    await completeStructuredText(
      {
        provider: createProvider(),
        modelId: 'm',
        systemPrompt: 'sys',
        userPrompt: 'user',
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        schemaName: 'probe',
        maxOutputTokens: 16,
        temperature: 0,
        signal: new AbortController().signal,
      },
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body ?? '{}')) as {
      response_format?: { type?: string; json_schema?: { name?: string } };
    };
    expect(body.response_format?.type).toBe('json_schema');
    expect(body.response_format?.json_schema?.name).toBe('probe');
  });

  it('retries without json_schema when the provider rejects the format', async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        response_format?: { type?: string };
      };
      if (body.response_format?.type === 'json_schema') {
        return createJsonResponse({ error: 'unsupported response_format' }, 400);
      }
      return createJsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    }) as unknown as FetchMock;
    const result = await completeStructuredText(
      {
        provider: createProvider(),
        modelId: 'm',
        systemPrompt: 'sys',
        userPrompt: 'user',
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        schemaName: 'probe',
        maxOutputTokens: 16,
        temperature: 0,
        signal: new AbortController().signal,
      },
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(result.text).toBe('{"ok":true}');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body ?? '{}')) as {
      response_format?: unknown;
    };
    expect(second.response_format).toBeUndefined();
  });
});

describe('completeStructured', () => {
  it('parses JSON wrapped in prose', async () => {
    const fetchSpy = vi.fn(async () =>
      createJsonResponse({
        choices: [{ message: { content: 'Here:\n{"items":[1]}\nThanks' } }],
      }),
    ) as unknown as FetchMock;
    const parsed = await completeStructured(
      {
        provider: createProvider(),
        modelId: 'm',
        systemPrompt: 'sys',
        userPrompt: 'user',
        jsonSchema: { type: 'object' },
        maxOutputTokens: 16,
        temperature: 0,
        signal: new AbortController().signal,
      },
      (value) => {
        if (!value || typeof value !== 'object' || !('items' in value)) {
          throw new Error('bad');
        }
        return value as { items: number[] };
      },
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(parsed).toEqual({ items: [1] });
  });

  it('throws schema-failed when the model does not return JSON', async () => {
    const fetchSpy = vi.fn(async () =>
      createJsonResponse({ choices: [{ message: { content: 'not json at all' } }] }),
    ) as unknown as FetchMock;
    await expect(
      completeStructured(
        {
          provider: createProvider(),
          modelId: 'm',
          systemPrompt: 'sys',
          userPrompt: 'user',
          jsonSchema: { type: 'object' },
          maxOutputTokens: 16,
          temperature: 0,
          signal: new AbortController().signal,
        },
        () => ({ ok: true }),
        { fetch: fetchSpy, resolveSecret: async () => 'k' },
      ),
    ).rejects.toMatchObject({
      name: 'schema-failed',
    } satisfies Partial<StructuredCompletionError>);
  });
});
