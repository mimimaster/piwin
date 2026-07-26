import type { EmbeddingProvider } from '@piwin/contracts';

export type OllamaEmbeddingOptions = {
  /** e.g. http://localhost:11434 */
  baseUrl: string;
  model: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_DIMENSIONS = 768;

/** Ollama native `/api/embed` provider (no API key; local daemon). */
export function createOllamaEmbedding(options: OllamaEmbeddingOptions): EmbeddingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/api/embed`;

  return {
    id: 'ollama',
    model: options.model,
    dimensions: options.dimensions ?? DEFAULT_DIMENSIONS,

    async embed(texts, signal) {
      if (texts.length === 0) {
        return [];
      }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.model, input: texts }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`ollama embed failed: ${response.status} ${response.statusText}`);
      }
      const payload = (await response.json()) as { embeddings?: number[][] };
      const rows = payload.embeddings;
      if (!Array.isArray(rows) || rows.length !== texts.length) {
        throw new Error(
          `ollama embed shape mismatch: expected ${texts.length} vectors, got ${rows?.length ?? 0}`,
        );
      }
      return rows.map((row) => Float32Array.from(row));
    },
  };
}
