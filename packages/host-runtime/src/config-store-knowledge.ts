/**
 * Normalize optional `PiwinConfig.knowledge`. Kept out of config-store.ts
 * (already over the line cap).
 */
import type { KnowledgeConfig, KnowledgeEmbeddingConfig, PiwinConfig } from '@piwin/contracts';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function mapNotesEmbedding(
  notes: PiwinConfig['notes'],
): KnowledgeEmbeddingConfig | undefined {
  const embedding = notes?.embedding;
  if (!embedding) return undefined;
  return {
    enabled: true,
    provider: embedding.provider,
    baseUrl: embedding.baseUrl,
    model: embedding.model,
    ...(embedding.apiKeyEnv ? { apiKeyEnv: embedding.apiKeyEnv } : {}),
    ...(embedding.apiKeyRef ? { apiKeyRef: embedding.apiKeyRef } : {}),
    ...(typeof embedding.dimensions === 'number' ? { dimension: embedding.dimensions } : {}),
  };
}

function normalizeEmbedding(value: unknown): KnowledgeEmbeddingConfig | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const embedding: KnowledgeEmbeddingConfig = {};
  if (typeof record.enabled === 'boolean') embedding.enabled = record.enabled;
  if (record.provider === 'openai-compatible' || record.provider === 'ollama') {
    embedding.provider = record.provider;
  }
  if (typeof record.baseUrl === 'string') embedding.baseUrl = record.baseUrl;
  if (typeof record.model === 'string') embedding.model = record.model;
  if (typeof record.apiKeyEnv === 'string') embedding.apiKeyEnv = record.apiKeyEnv;
  if (typeof record.apiKeyRef === 'string') embedding.apiKeyRef = record.apiKeyRef;
  const dimension = asPositiveNumber(record.dimension ?? record.dimensions);
  if (dimension !== undefined) embedding.dimension = dimension;
  return Object.keys(embedding).length > 0 ? embedding : undefined;
}

export function normalizeKnowledgeConfig(
  value: unknown,
  notes: PiwinConfig['notes'],
): KnowledgeConfig | undefined {
  const record = asRecord(value);
  const knowledge: KnowledgeConfig = record ? { ...asKnowledgePartial(record) } : {};
  if (!knowledge.embedding) {
    const mapped = mapNotesEmbedding(notes);
    if (mapped) knowledge.embedding = mapped;
  }
  return Object.keys(knowledge).length > 0 ? knowledge : undefined;
}

function asKnowledgePartial(record: Record<string, unknown>): KnowledgeConfig {
  const knowledge: KnowledgeConfig = {};
  const embedding = normalizeEmbedding(record.embedding);
  if (embedding) knowledge.embedding = embedding;
  const extraction = asRecord(record.extractionLlm ?? record.extraction_llm);
  if (extraction && typeof extraction.modelRef === 'string') {
    knowledge.extractionLlm = {
      modelRef: extraction.modelRef,
      ...(typeof extraction.temperature === 'number' ? { temperature: extraction.temperature } : {}),
    };
  }
  const flashcard = asRecord(record.flashcardLlm ?? record.flashcard_llm);
  if (flashcard && typeof flashcard.modelRef === 'string') {
    knowledge.flashcardLlm = { modelRef: flashcard.modelRef };
  }
  return knowledge;
}
