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
  const parser = normalizeParser(record.parser);
  if (parser) knowledge.parser = parser;
  const reranker = normalizeReranker(record.reranker);
  if (reranker) knowledge.reranker = reranker;
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

function normalizeHttpAuth(record: Record<string, unknown>): {
  apiKeyEnv?: string;
  apiKeyRef?: string;
} {
  return {
    ...(typeof record.apiKeyEnv === 'string' ? { apiKeyEnv: record.apiKeyEnv } : {}),
    ...(typeof record.apiKeyRef === 'string' ? { apiKeyRef: record.apiKeyRef } : {}),
  };
}

function normalizeParser(value: unknown): KnowledgeConfig['parser'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const parser: NonNullable<KnowledgeConfig['parser']> = {};
  const mineruRecord = asRecord(record.mineru);
  if (mineruRecord) {
    const mineru: NonNullable<NonNullable<KnowledgeConfig['parser']>['mineru']> = {
      ...normalizeHttpAuth(mineruRecord),
    };
    if (typeof mineruRecord.enabled === 'boolean') mineru.enabled = mineruRecord.enabled;
    if (mineruRecord.mode === 'http' || mineruRecord.mode === 'local-command') {
      mineru.mode = mineruRecord.mode;
    }
    if (typeof mineruRecord.baseUrl === 'string') mineru.baseUrl = mineruRecord.baseUrl;
    if (typeof mineruRecord.command === 'string') mineru.command = mineruRecord.command;
    const mineruTimeout = asPositiveNumber(mineruRecord.timeoutMs);
    if (mineruTimeout !== undefined) mineru.timeoutMs = mineruTimeout;
    if (Object.keys(mineru).length > 0) parser.mineru = mineru;
  }
  const unstructuredRecord = asRecord(record.unstructured);
  if (unstructuredRecord) {
    const unstructured: NonNullable<NonNullable<KnowledgeConfig['parser']>['unstructured']> = {
      ...normalizeHttpAuth(unstructuredRecord),
    };
    if (typeof unstructuredRecord.enabled === 'boolean') {
      unstructured.enabled = unstructuredRecord.enabled;
    }
    if (unstructuredRecord.mode === 'http') unstructured.mode = 'http';
    if (typeof unstructuredRecord.baseUrl === 'string') {
      unstructured.baseUrl = unstructuredRecord.baseUrl;
    }
    const unstructuredTimeout = asPositiveNumber(unstructuredRecord.timeoutMs);
    if (unstructuredTimeout !== undefined) unstructured.timeoutMs = unstructuredTimeout;
    if (Object.keys(unstructured).length > 0) parser.unstructured = unstructured;
  }
  return Object.keys(parser).length > 0 ? parser : undefined;
}

function normalizeReranker(value: unknown): KnowledgeConfig['reranker'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const reranker: NonNullable<KnowledgeConfig['reranker']> = {
    ...normalizeHttpAuth(record),
  };
  if (typeof record.enabled === 'boolean') reranker.enabled = record.enabled;
  if (typeof record.provider === 'string') reranker.provider = record.provider;
  if (typeof record.baseUrl === 'string') reranker.baseUrl = record.baseUrl;
  if (typeof record.model === 'string') reranker.model = record.model;
  const topK = asPositiveNumber(record.topK);
  if (topK !== undefined) reranker.topK = topK;
  const timeoutMs = asPositiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) reranker.timeoutMs = timeoutMs;
  if (record.failureMode === 'fallback' || record.failureMode === 'fail') {
    reranker.failureMode = record.failureMode;
  }
  return Object.keys(reranker).length > 0 ? reranker : undefined;
}
