/**
 * Utilities for testing connection to embedding and reranker endpoints.
 */
import type { KnowledgeEmbeddingProviderKind } from './knowledge-embedding-draft.js';

export type TestEmbeddingOptions = {
  provider: KnowledgeEmbeddingProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

export type TestEmbeddingResult = {
  durationMs: number;
  dimension?: number;
};

export type TestRerankerOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

export type TestRerankerResult = {
  durationMs: number;
};

const TEST_TIMEOUT_MS = 15_000;

export async function testKnowledgeEmbedding(
  options: TestEmbeddingOptions,
): Promise<TestEmbeddingResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  const model = options.model.trim();

  if (!baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!model) {
    throw new Error('Model ID is required');
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    if (options.provider === 'ollama') {
      const endpoint = `${baseUrl}/api/embed`;
      let response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: ['ping'] }),
        signal: controller.signal,
      }).catch((err) => {
        if (controller.signal.aborted) {
          throw new Error('Request timed out after 15s');
        }
        throw err;
      });

      if (!response.ok) {
        // Fallback to OpenAI-compatible /embeddings endpoint on Ollama
        const fallbackEndpoint = `${baseUrl}/embeddings`;
        const fallbackResponse = await fetchImpl(fallbackEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, input: 'ping' }),
          signal: controller.signal,
        }).catch(() => null);

        if (fallbackResponse && fallbackResponse.ok) {
          response = fallbackResponse;
        } else {
          const message = await extractErrorMessage(response);
          throw new Error(message);
        }
      }

      const payload = (await response.json()) as {
        embeddings?: number[][];
        data?: Array<{ embedding?: number[] }>;
      };

      const dim =
        payload.embeddings?.[0]?.length ??
        payload.data?.[0]?.embedding?.length;

      return {
        durationMs: Math.max(1, Math.round(performance.now() - start)),
        ...(dim !== undefined ? { dimension: dim } : {}),
      };
    }

    // OpenAI-compatible endpoint
    const endpoint = `${baseUrl}/embeddings`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey?.trim()) {
      headers.authorization = `Bearer ${options.apiKey.trim()}`;
    }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: 'ping' }),
      signal: controller.signal,
    }).catch((err) => {
      if (controller.signal.aborted) {
        throw new Error('Request timed out after 15s');
      }
      throw err;
    });

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      throw new Error(message);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    const dim = payload.data?.[0]?.embedding?.length;

    return {
      durationMs: Math.max(1, Math.round(performance.now() - start)),
      ...(dim !== undefined ? { dimension: dim } : {}),
    };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Connection timed out after 15s');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export type TestParserKind = 'mineru' | 'unstructured';

export type TestParserOptions = {
  kind: TestParserKind;
  baseUrl: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

export async function testKnowledgeParser(
  options: TestParserOptions,
): Promise<TestRerankerResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Base URL is required');
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (options.apiKey?.trim()) {
    headers.authorization = `Bearer ${options.apiKey.trim()}`;
  }

  const paths =
    options.kind === 'mineru'
      ? ['/health', '/docs', '']
      : ['/healthcheck', '/health', '/docs', ''];

  try {
    let lastError = 'No HTTP response';
    for (const path of paths) {
      const endpoint = `${baseUrl}${path}`;
      try {
        const response = await fetchImpl(endpoint, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (response.status < 500) {
          return {
            durationMs: Math.max(1, Math.round(performance.now() - start)),
          };
        }
        lastError = await extractErrorMessage(response);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error('Connection timed out after 15s');
        }
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(lastError);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Connection timed out after 15s');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testKnowledgeReranker(
  options: TestRerankerOptions,
): Promise<TestRerankerResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  const model = options.model.trim();

  if (!baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!model) {
    throw new Error('Model ID is required');
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const endpoint = `${baseUrl}/rerank`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey?.trim()) {
      headers.authorization = `Bearer ${options.apiKey.trim()}`;
    }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        query: 'ping',
        documents: ['ping'],
        top_n: 1,
      }),
      signal: controller.signal,
    }).catch((err) => {
      if (controller.signal.aborted) {
        throw new Error('Request timed out after 15s');
      }
      throw err;
    });

    if (response.ok) {
      return {
        durationMs: Math.max(1, Math.round(performance.now() - start)),
      };
    }

    // If /rerank returns 404 or 405, check fallback to /chat/completions
    if (response.status === 404 || response.status === 405) {
      const chatEndpoint = baseUrl.endsWith('/v1')
        ? `${baseUrl}/chat/completions`
        : `${baseUrl}/v1/chat/completions`;

      const chatResponse = await fetchImpl(chatEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      }).catch((err) => {
        if (controller.signal.aborted) {
          throw new Error('Request timed out after 15s');
        }
        throw err;
      });

      if (chatResponse.ok) {
        return {
          durationMs: Math.max(1, Math.round(performance.now() - start)),
        };
      }

      const chatMessage = await extractErrorMessage(chatResponse);
      throw new Error(chatMessage);
    }

    const message = await extractErrorMessage(response);
    throw new Error(message);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Connection timed out after 15s');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text) as {
          error?: { message?: string } | string;
          message?: string;
        };
        if (typeof json.error === 'string') return json.error;
        if (json.error?.message) return json.error.message;
        if (json.message) return json.message;
      } catch {
        return text.slice(0, 160);
      }
    }
  } catch {}
  return `HTTP ${response.status} ${response.statusText || 'request rejected'}`;
}
