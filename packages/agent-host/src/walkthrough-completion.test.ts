import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { WalkthroughCompletionError, completeWalkthrough } from './walkthrough-completion.js';
import type { WalkthroughCompletionRequest } from './walkthrough-completion.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'TEST_KEY',
    models: [],
    ...overrides,
  };
}

function createRequest(
  overrides: Partial<WalkthroughCompletionRequest> = {},
): WalkthroughCompletionRequest {
  return {
    provider: createProvider(),
    modelId: 'gpt-4o',
    systemPrompt: 'You are a walkthrough generator.',
    userPrompt: 'Summarize the changes.',
    maxOutputTokens: 4096,
    temperature: 0.2,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchImpl = typeof globalThis.fetch;
type FetchMock = Mock<FetchImpl>;

function createFetchSpy(
  response: Response | ((input: string | URL, init?: RequestInit) => Response),
): FetchMock {
  const handler = typeof response === 'function' ? response : () => response;
  return vi.fn(async (input: string | URL, init?: RequestInit) =>
    handler(input, init),
  ) as unknown as FetchMock;
}

function readBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

/** Await a promise expected to reject, returning the captured error. */
async function expectRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
  throw new Error('Expected promise to reject, but it resolved');
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible                                                  */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — OpenAI-compatible', () => {
  it('posts to the correct URL, headers and body and parses choices[0].message.content', async () => {
    let requestedUrl = '';
    let authorization = '';
    let contentType = '';
    const fetchSpy = createFetchSpy((_input, init) => {
      requestedUrl = String(_input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      contentType = new Headers(init?.headers).get('content-type') ?? '';
      return createJsonResponse({
        choices: [{ message: { content: '# Walkthrough\n\nDid the thing.' } }],
      });
    });

    const result = await completeWalkthrough(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'openai-secret',
    });

    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(authorization).toBe('Bearer openai-secret');
    expect(contentType).toBe('application/json');
    const body = readBody(fetchSpy.mock.calls[0]?.[1]);
    expect(body).toEqual({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a walkthrough generator.' },
        { role: 'user', content: 'Summarize the changes.' },
      ],
      max_tokens: 4096,
      temperature: 0.2,
      stream: false,
    });
    expect(result.text).toBe('# Walkthrough\n\nDid the thing.');
  });

  it('appends /v1 when the base URL does not end with /v1', async () => {
    let requestedUrl = '';
    const fetchSpy = createFetchSpy((_input) => {
      requestedUrl = String(_input);
      return createJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await completeWalkthrough(
      createRequest({ provider: createProvider({ baseUrl: 'https://api.example.com' }) }),
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions');
  });

  it('strips trailing slashes from the base URL', async () => {
    let requestedUrl = '';
    const fetchSpy = createFetchSpy((_input) => {
      requestedUrl = String(_input);
      return createJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await completeWalkthrough(
      createRequest({ provider: createProvider({ baseUrl: 'https://api.example.com/v1/' }) }),
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions');
  });
});

/* ------------------------------------------------------------------ */
/* Anthropic-compatible                                               */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — Anthropic-compatible', () => {
  it('posts to /messages with x-api-key and parses the first text content block', async () => {
    let requestedUrl = '';
    let apiKey = '';
    let apiVersion = '';
    const fetchSpy = createFetchSpy((_input, init) => {
      requestedUrl = String(_input);
      apiKey = new Headers(init?.headers).get('x-api-key') ?? '';
      apiVersion = new Headers(init?.headers).get('anthropic-version') ?? '';
      return createJsonResponse({
        content: [
          { type: 'text', text: '## Walkthrough\n\nSteps here.' },
          { type: 'text', text: 'ignored second block' },
        ],
      });
    });

    const result = await completeWalkthrough(
      createRequest({
        provider: createProvider({
          protocol: 'anthropic-compatible',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKeyRef: 'keychain:anthropic',
        }),
      }),
      { fetch: fetchSpy, resolveSecret: async () => 'anthropic-secret' },
    );

    expect(requestedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(apiKey).toBe('anthropic-secret');
    expect(apiVersion).toBe('2023-06-01');
    const body = readBody(fetchSpy.mock.calls[0]?.[1]);
    expect(body).toEqual({
      model: 'gpt-4o',
      system: 'You are a walkthrough generator.',
      messages: [{ role: 'user', content: 'Summarize the changes.' }],
      max_tokens: 4096,
      temperature: 0.2,
    });
    expect(result.text).toBe('## Walkthrough\n\nSteps here.');
  });

  it('appends /v1 when the base URL does not end with /v1', async () => {
    let requestedUrl = '';
    const fetchSpy = createFetchSpy((_input) => {
      requestedUrl = String(_input);
      return createJsonResponse({ content: [{ type: 'text', text: 'ok' }] });
    });
    await completeWalkthrough(
      createRequest({
        provider: createProvider({
          protocol: 'anthropic-compatible',
          baseUrl: 'https://api.anthropic.com',
        }),
      }),
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(requestedUrl).toBe('https://api.anthropic.com/v1/messages');
  });
});

/* ------------------------------------------------------------------ */
/* Google Gemini                                                      */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — Google Gemini', () => {
  it('posts to the generateContent URL with x-goog-api-key and joins text parts', async () => {
    let requestedUrl = '';
    let apiKey = '';
    const fetchSpy = createFetchSpy((_input, init) => {
      requestedUrl = String(_input);
      apiKey = new Headers(init?.headers).get('x-goog-api-key') ?? '';
      return createJsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: '# Walkthrough\n\n' }, { text: 'Part two.' }],
            },
          },
        ],
      });
    });

    const result = await completeWalkthrough(
      createRequest({
        provider: createProvider({
          protocol: 'google-gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKeyEnv: 'GEMINI_KEY',
        }),
        modelId: 'gemini-2.5-pro',
      }),
      { fetch: fetchSpy, resolveSecret: async () => 'gemini-secret' },
    );

    expect(requestedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    );
    expect(apiKey).toBe('gemini-secret');
    const body = readBody(fetchSpy.mock.calls[0]?.[1]);
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: 'You are a walkthrough generator.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Summarize the changes.' }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.2 },
    });
    expect(result.text).toBe('# Walkthrough\n\nPart two.');
  });

  it('URL-encodes the model id', async () => {
    let requestedUrl = '';
    const fetchSpy = createFetchSpy((_input) => {
      requestedUrl = String(_input);
      return createJsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      });
    });
    await completeWalkthrough(
      createRequest({
        provider: createProvider({ protocol: 'google-gemini', baseUrl: 'https://api.example.com' }),
        modelId: 'models/special name',
      }),
      { fetch: fetchSpy, resolveSecret: async () => 'k' },
    );
    expect(requestedUrl).toBe(
      'https://api.example.com/models/models%2Fspecial%20name:generateContent',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Custom headers do not override protected auth headers             */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — custom headers', () => {
  it('does not let custom headers override the protected auth header', async () => {
    let authorization = '';
    let customHeader = '';
    const fetchSpy = createFetchSpy((_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      customHeader = new Headers(init?.headers).get('x-custom') ?? '';
      return createJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });

    await completeWalkthrough(
      createRequest({
        provider: createProvider({
          headers: { authorization: 'Bearer EVIL', 'x-custom': 'mine' },
        }),
      }),
      { fetch: fetchSpy, resolveSecret: async () => 'real-secret' },
    );

    expect(authorization).toBe('Bearer real-secret');
    expect(customHeader).toBe('mine');
  });
});

/* ------------------------------------------------------------------ */
/* HTTP errors                                                         */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — HTTP errors', () => {
  it('throws provider-request-failed on 4xx without leaking the response body', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ error: 'invalid_api_key', detail: 'secret-value-123' }, 401),
    );

    const error = await expectRejection(
      completeWalkthrough(createRequest(), { fetch: fetchSpy, resolveSecret: async () => 'k' }),
    );

    expect(error).toBeInstanceOf(WalkthroughCompletionError);
    expect(error.name).toBe('provider-request-failed');
    expect((error as WalkthroughCompletionError).code).toBe('provider-request-failed');
    expect(error.message).not.toContain('secret-value-123');
    expect(error.message).not.toContain('invalid_api_key');
  });

  it('throws provider-request-failed on 5xx', async () => {
    const fetchSpy = createFetchSpy(createJsonResponse({ detail: 'down' }, 500));
    const error = await expectRejection(
      completeWalkthrough(createRequest(), { fetch: fetchSpy, resolveSecret: async () => 'k' }),
    );
    expect(error.name).toBe('provider-request-failed');
  });
});

/* ------------------------------------------------------------------ */
/* Malformed responses                                                */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — malformed responses', () => {
  it('throws provider-request-failed when the OpenAI response has no choices', async () => {
    const fetchSpy = createFetchSpy(createJsonResponse({}));
    const error = await expectRejection(
      completeWalkthrough(createRequest(), { fetch: fetchSpy, resolveSecret: async () => 'k' }),
    );
    expect(error.name).toBe('provider-request-failed');
  });

  it('throws provider-request-failed when the Anthropic response has no text block', async () => {
    const fetchSpy = createFetchSpy(createJsonResponse({ content: [{ type: 'tool_use' }] }));
    const error = await expectRejection(
      completeWalkthrough(
        createRequest({ provider: createProvider({ protocol: 'anthropic-compatible' }) }),
        { fetch: fetchSpy, resolveSecret: async () => 'k' },
      ),
    );
    expect(error.name).toBe('provider-request-failed');
  });

  it('throws provider-request-failed when the Gemini response has no candidates', async () => {
    const fetchSpy = createFetchSpy(createJsonResponse({}));
    const error = await expectRejection(
      completeWalkthrough(
        createRequest({ provider: createProvider({ protocol: 'google-gemini' }) }),
        { fetch: fetchSpy, resolveSecret: async () => 'k' },
      ),
    );
    expect(error.name).toBe('provider-request-failed');
  });

  it('throws provider-request-failed when the payload is not an object', async () => {
    const fetchSpy = createFetchSpy(createJsonResponse('just a string'));
    const error = await expectRejection(
      completeWalkthrough(createRequest(), { fetch: fetchSpy, resolveSecret: async () => 'k' }),
    );
    expect(error.name).toBe('provider-request-failed');
  });
});

/* ------------------------------------------------------------------ */
/* Empty output                                                       */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — empty output', () => {
  it('throws empty-output when the parsed text is empty after trim', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: '   \n\t  ' } }] }),
    );
    const error = await expectRejection(
      completeWalkthrough(createRequest(), { fetch: fetchSpy, resolveSecret: async () => 'k' }),
    );
    expect(error.name).toBe('empty-output');
  });

  it('throws empty-output when the Gemini parts contain no text', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
    );
    const error = await expectRejection(
      completeWalkthrough(
        createRequest({ provider: createProvider({ protocol: 'google-gemini' }) }),
        { fetch: fetchSpy, resolveSecret: async () => 'k' },
      ),
    );
    expect(error.name).toBe('empty-output');
  });
});

/* ------------------------------------------------------------------ */
/* Timeout                                                            */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — timeout', () => {
  it('throws provider-timeout when the request exceeds the timeout', async () => {
    const fetchSpy = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }
      });
    }) as unknown as FetchMock;

    vi.useFakeTimers();
    try {
      const promise = completeWalkthrough(createRequest(), {
        fetch: fetchSpy,
        resolveSecret: async () => 'k',
      });
      // Attach a catch handler early to avoid an unhandled rejection while
      // we advance the fake timer.
      const caught = promise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(60_000);
      const error = (await caught) as Error;
      expect(error).toBeInstanceOf(WalkthroughCompletionError);
      expect(error.name).toBe('provider-timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ */
/* AbortSignal cancel                                                 */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — cancellation', () => {
  it('throws cancelled when the external AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await expectRejection(
      completeWalkthrough(createRequest({ signal: controller.signal }), {
        fetch: createFetchSpy(createJsonResponse({ choices: [{ message: { content: 'ok' } }] })),
        resolveSecret: async () => 'k',
      }),
    );
    expect(error.name).toBe('cancelled');
  });

  it('throws cancelled when the external AbortSignal aborts mid-flight', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }
      });
    }) as unknown as FetchMock;

    const promise = completeWalkthrough(createRequest({ signal: controller.signal }), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    controller.abort();
    const error = await expectRejection(promise);
    expect(error.name).toBe('cancelled');
  });
});

/* ------------------------------------------------------------------ */
/* Secret resolver                                                    */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — secret resolution', () => {
  it('calls the injected resolveSecret and does not put the secret in the error', async () => {
    const resolveSecret = vi.fn(async () => 'super-secret-value') as unknown as Mock<
      (provider: ModelProviderConfig) => Promise<string | null>
    >;
    const fetchSpy = createFetchSpy(createJsonResponse({}, 500));
    const error = await expectRejection(
      completeWalkthrough(createRequest(), { fetch: fetchSpy, resolveSecret }),
    );
    expect(resolveSecret).toHaveBeenCalledTimes(1);
    expect(resolveSecret.mock.calls[0]?.[0]).toEqual(createProvider());
    expect(error.message).not.toContain('super-secret-value');
  });

  it('throws missing-credentials when a configured key cannot be resolved by the default resolver', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = createProvider({ apiKeyEnv: 'MISSING_KEY' });
    delete (provider as { apiKeyRef?: string }).apiKeyRef;
    const error = await expectRejection(
      completeWalkthrough(createRequest({ provider }), { fetch: fetchSpy }),
    );
    expect(error.name).toBe('missing-credentials');
  });

  it('allows no-auth requests when the provider has no key source', async () => {
    let authorization = '';
    const fetchSpy = createFetchSpy((_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return createJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    const provider = createProvider();
    delete (provider as { apiKeyEnv?: string }).apiKeyEnv;
    delete (provider as { apiKeyRef?: string }).apiKeyRef;
    const result = await completeWalkthrough(createRequest({ provider }), { fetch: fetchSpy });
    expect(authorization).toBe('');
    expect(result.text).toBe('ok');
  });
});

/* ------------------------------------------------------------------ */
/* Output processing (spec §10.4)                                     */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — output processing', () => {
  it('trims surrounding whitespace', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: '\n\n  hello world  \n' } }] }),
    );
    const result = await completeWalkthrough(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    expect(result.text).toBe('hello world');
  });

  it('removes NUL characters', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: 'a\0b\0c' } }] }),
    );
    const result = await completeWalkthrough(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    expect(result.text).toBe('abc');
  });

  it('truncates output exceeding 32 KiB UTF-8 and appends the truncation suffix', async () => {
    const longText = 'x'.repeat(40_000);
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: longText } }] }),
    );
    const result = await completeWalkthrough(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    const encoder = new TextEncoder();
    expect(encoder.encode(result.text).length).toBeLessThanOrEqual(32 * 1024);
    expect(result.text.endsWith('[output truncated]')).toBe(true);
    expect(result.text.startsWith('x'.repeat(100))).toBe(true);
  });

  it('truncates on a UTF-8 character boundary for multi-byte content', async () => {
    const chunk = '😀'; // 4 bytes per rune
    const longText = chunk.repeat(20_000); // 80_000 bytes
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: longText } }] }),
    );
    const result = await completeWalkthrough(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    const encoder = new TextEncoder();
    expect(encoder.encode(result.text).length).toBeLessThanOrEqual(32 * 1024);
    expect(result.text.endsWith('[output truncated]')).toBe(true);
    // No replacement character from a split rune should appear before the suffix.
    expect(result.text.includes('\uFFFD')).toBe(false);
  });

  it('does not truncate output under the cap', async () => {
    const text = 'y'.repeat(32_000);
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: text } }] }),
    );
    const result = await completeWalkthrough(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    expect(result.text).toBe(text);
    expect(result.text.includes('[output truncated]')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Walkthrough defaults passed through                                */
/* ------------------------------------------------------------------ */

describe('completeWalkthrough — walkthrough defaults', () => {
  it('sends the request maxOutputTokens and temperature in the body', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );
    await completeWalkthrough(createRequest({ maxOutputTokens: 4096, temperature: 0.2 }), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    const body = readBody(fetchSpy.mock.calls[0]?.[1]);
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.2);
  });

  it('forwards non-default maxOutputTokens and temperature when provided', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );
    await completeWalkthrough(createRequest({ maxOutputTokens: 2048, temperature: 0.7 }), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    const body = readBody(fetchSpy.mock.calls[0]?.[1]);
    expect(body.max_tokens).toBe(2048);
    expect(body.temperature).toBe(0.7);
  });
});
