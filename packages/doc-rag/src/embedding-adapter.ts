import type { EmbeddingProvider, SharedEmbeddingProvider } from '@piwin/contracts';

/** Adapt the notes EmbeddingProvider (embed[]) to the shared knowledge port. */
export function adaptNotesEmbedding(provider: EmbeddingProvider): SharedEmbeddingProvider {
  return {
    providerId: provider.id,
    modelId: provider.model,
    dimension: provider.dimensions,
    async embedDocuments(texts, signal) {
      const vectors = await provider.embed(texts, signal);
      return vectors.map((vector) => Array.from(vector));
    },
    async embedQuery(text, signal) {
      const [vector] = await provider.embed([text], signal);
      return vector ? Array.from(vector) : [];
    },
  };
}
