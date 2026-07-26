import type { EmbeddingProvider } from '@piwin/contracts';

export type OpenAiCompatibleEmbeddingOptions = {
  baseUrl: string;
  model: string;
  /** Resolved secret value (host resolves env/keychain refs; never logged). */
  apiKey?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_DIMENSIONS = 1536;

/**
 * OpenAI-compatible `/embeddings` endpoint provider.
 * Works with OpenAI, and any server speaking the same shape
 * (LM Studio, vLLM, llama.cpp server, SiliconFlow, etc).
 */
export function createOpenAiCompatibleEmbedding(
  options: OpenAiCompatibleEmbeddingOptions,
): EmbeddingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;

  return {
    id: 'openai-compatible',
    model: options.model,
    dimensions: options.dimensions ?? DEFAULT_DIMENSIONS,

    async embed(texts, signal) {
      if (texts.length === 0) {
        return [];
      }
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.apiKey) {
        headers.authorization = `Bearer ${options.apiKey}`;
      }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: options.model, input: texts }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`embedding request failed: ${response.status} ${response.statusText}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ index?: number; embedding?: number[] }>;
      };
      const rows = payload.data;
      if (!Array.isArray(rows) || rows.length !== texts.length) {
        throw new Error(
          `embedding response shape mismatch: expected ${texts.length} vectors, got ${rows?.length ?? 0}`,
        );
      }
      // Servers may reorder; index field is authoritative when present.
      const vectors = new Array<Float32Array>(texts.length);
      for (const [position, row] of rows.entries()) {
        const index = typeof row.index === 'number' ? row.index : position;
        if (!Array.isArray(row.embedding) || index < 0 || index >= texts.length) {
          throw new Error('embedding response missing vector data');
        }
        vectors[index] = Float32Array.from(row.embedding);
      }
      return vectors;
    },
  };
}
