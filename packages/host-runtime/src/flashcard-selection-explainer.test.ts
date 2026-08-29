import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  explainFlashcardSelection,
  FLASHCARD_SELECTION_MAX_OUTPUT_CHARS,
  FLASHCARD_SELECTION_TIMEOUT_MS,
  FlashcardSelectionExplainerError,
  type FlashcardSelectionExplainerRequest,
} from './flashcard-selection-explainer.js';
import { visibleCharCount } from './flashcard-selection-prompt.js';

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
  overrides: Partial<FlashcardSelectionExplainerRequest> = {},
): FlashcardSelectionExplainerRequest {
  return {
    provider: createProvider(),
    modelId: 'tutor-model',
    systemPrompt: 'Be brief.',
    userPrompt: '<piwin-flashcard-data></piwin-flashcard-data>',
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

type FetchMock = Mock<typeof globalThis.fetch>;

function createFetchSpy(
  response: Response | ((input: string | URL, init?: RequestInit) => Response),
): FetchMock {
  const handler = typeof response === 'function' ? response : () => response;
  return vi.fn(async (input: string | URL, init?: RequestInit) =>
    handler(input, init),
  ) as unknown as FetchMock;
}

async function expectRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
  throw new Error('Expected promise to reject, but it resolved');
}

describe('explainFlashcardSelection', () => {
  it('returns sanitized markdown on success', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: '  A short hint.\n' } }] }),
    );
    const result = await explainFlashcardSelection(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    expect(result.markdown).toBe('A short hint.');
  });

  it('throws when the model returns empty text', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: '  \n\0 ' } }] }),
    );
    const error = await expectRejection(
      explainFlashcardSelection(createRequest(), {
        fetch: fetchSpy,
        resolveSecret: async () => 'k',
      }),
    );
    expect(error).toBeInstanceOf(FlashcardSelectionExplainerError);
    expect((error as FlashcardSelectionExplainerError).code).toBe(
      'flashcard-selection-provider-failed',
    );
  });

  it('throws provider-failed on timeout', async () => {
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
      const promise = explainFlashcardSelection(createRequest(), {
        fetch: fetchSpy,
        resolveSecret: async () => 'k',
      });
      const caught = promise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(FLASHCARD_SELECTION_TIMEOUT_MS);
      const error = (await caught) as FlashcardSelectionExplainerError;
      expect(error).toBeInstanceOf(FlashcardSelectionExplainerError);
      expect(error.code).toBe('flashcard-selection-provider-failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws cancelled when the abort signal fires', async () => {
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
    const promise = explainFlashcardSelection(createRequest({ signal: controller.signal }), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    controller.abort();
    const error = await expectRejection(promise);
    expect((error as FlashcardSelectionExplainerError).code).toBe('flashcard-selection-cancelled');
  });

  it('clips oversize output to 1200 unicode characters', async () => {
    const oversized = `${'讲'.repeat(FLASHCARD_SELECTION_MAX_OUTPUT_CHARS + 80)}\0`;
    const fetchSpy = createFetchSpy(
      createJsonResponse({ choices: [{ message: { content: oversized } }] }),
    );
    const result = await explainFlashcardSelection(createRequest(), {
      fetch: fetchSpy,
      resolveSecret: async () => 'k',
    });
    expect(visibleCharCount(result.markdown)).toBe(FLASHCARD_SELECTION_MAX_OUTPUT_CHARS);
    expect(result.markdown.includes('\0')).toBe(false);
  });

  it('throws provider-failed on HTTP errors without leaking the response body', async () => {
    const fetchSpy = createFetchSpy(
      createJsonResponse({ error: 'invalid_api_key', detail: 'secret-value-123' }, 401),
    );
    const error = await expectRejection(
      explainFlashcardSelection(createRequest(), {
        fetch: fetchSpy,
        resolveSecret: async () => 'super-secret-value',
      }),
    );
    expect((error as FlashcardSelectionExplainerError).code).toBe(
      'flashcard-selection-provider-failed',
    );
    expect(error.message).not.toContain('secret-value-123');
    expect(error.message).not.toContain('super-secret-value');
    expect(error.message).not.toContain('invalid_api_key');
  });
});
