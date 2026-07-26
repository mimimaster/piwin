import type { EmbeddingProvider, NotesEmbeddingConfig } from '@piwin/contracts';
import { createOllamaEmbedding } from './ollama.js';
import { createOpenAiCompatibleEmbedding } from './openai-compatible.js';

export type CreateEmbeddingProviderOptions = {
  config: NotesEmbeddingConfig;
  /** Resolved secret (host resolves apiKeyEnv/apiKeyRef; package never reads env). */
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

/** Config → provider. Returns null for unknown provider ids (forward compat). */
export function createEmbeddingProvider(
  options: CreateEmbeddingProviderOptions,
): EmbeddingProvider | null {
  const { config } = options;
  if (config.provider === 'openai-compatible') {
    return createOpenAiCompatibleEmbedding({
      baseUrl: config.baseUrl,
      model: config.model,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(typeof config.dimensions === 'number' ? { dimensions: config.dimensions } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }
  if (config.provider === 'ollama') {
    return createOllamaEmbedding({
      baseUrl: config.baseUrl,
      model: config.model,
      ...(typeof config.dimensions === 'number' ? { dimensions: config.dimensions } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }
  return null;
}
