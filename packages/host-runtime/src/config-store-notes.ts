import type { PiwinConfig } from '@piwin/contracts';
import { normalizeNotesKnowledgeExtras } from './config-store-knowledge.js';
import { asPositiveNumber, asRecord } from './config-store-primitives.js';

/**
 * Normalize `PiwinConfig.notes` and `PiwinConfig.flashcards` incl. knowledge extras.
 */

export function normalizeNotesConfig(value: unknown): PiwinConfig['notes'] {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const notes: NonNullable<PiwinConfig['notes']> = {};
  if (typeof record.enabled === 'boolean') {
    notes.enabled = record.enabled;
  }
  const embedding = asRecord(record.embedding);
  if (
    embedding &&
    (embedding.provider === 'openai-compatible' || embedding.provider === 'ollama') &&
    typeof embedding.baseUrl === 'string' &&
    typeof embedding.model === 'string'
  ) {
    notes.embedding = {
      provider: embedding.provider,
      baseUrl: embedding.baseUrl,
      model: embedding.model,
      ...(typeof embedding.apiKeyEnv === 'string' ? { apiKeyEnv: embedding.apiKeyEnv } : {}),
      ...(typeof embedding.apiKeyRef === 'string' ? { apiKeyRef: embedding.apiKeyRef } : {}),
      ...(asPositiveNumber(embedding.dimensions) !== undefined
        ? { dimensions: asPositiveNumber(embedding.dimensions) as number }
        : {}),
    };
  }
  const rerank = asRecord(record.rerank);
  if (rerank && rerank.provider === 'llm') {
    notes.rerank = {
      provider: 'llm',
      ...(typeof rerank.enabled === 'boolean' ? { enabled: rerank.enabled } : {}),
    };
  }
  const search = asRecord(record.search);
  if (search) {
    const searchConfig: NonNullable<NonNullable<PiwinConfig['notes']>['search']> = {};
    if (
      search.defaultMode === 'auto' ||
      search.defaultMode === 'fts' ||
      search.defaultMode === 'vector' ||
      search.defaultMode === 'hybrid'
    ) {
      searchConfig.defaultMode = search.defaultMode;
    }
    const rrfK = asPositiveNumber(search.rrfK);
    if (rrfK !== undefined) {
      searchConfig.rrfK = rrfK;
    }
    if (Object.keys(searchConfig).length > 0) {
      notes.search = searchConfig;
    }
  }
  const knowledgeExtras = normalizeNotesKnowledgeExtras(record.knowledgeExtras);
  if (knowledgeExtras) {
    notes.knowledgeExtras = knowledgeExtras;
  }
  return Object.keys(notes).length > 0 ? notes : undefined;
}

export function normalizeFlashcardsConfig(value: unknown): PiwinConfig['flashcards'] {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const flashcards: NonNullable<PiwinConfig['flashcards']> = {};
  if (typeof record.enabled === 'boolean') {
    flashcards.enabled = record.enabled;
  }
  const newPerDay = asPositiveNumber(record.newPerDay);
  if (newPerDay !== undefined) {
    flashcards.newPerDay = newPerDay;
  }
  const maxReviewsPerDay = asPositiveNumber(record.maxReviewsPerDay);
  if (maxReviewsPerDay !== undefined) {
    flashcards.maxReviewsPerDay = maxReviewsPerDay;
  }
  return Object.keys(flashcards).length > 0 ? flashcards : undefined;
}
