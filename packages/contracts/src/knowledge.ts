/**
 * Shared knowledge-plane provider config (Doc Cards V2).
 *
 * Types only in P0 — `PiwinConfig.knowledge` is unwired until P1.
 * Secrets stay as env/ref names, never inline keys.
 */

export type KnowledgeHttpAuth = {
  /** Env var name holding the API key. */
  apiKeyEnv?: string;
  /** Keychain / SecretRef id. Never an inline secret. */
  apiKeyRef?: string;
};

export type KnowledgeParserHttpConfig = KnowledgeHttpAuth & {
  enabled?: boolean;
  mode?: 'http';
  baseUrl?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
};

export type KnowledgeMineruConfig = KnowledgeHttpAuth & {
  enabled?: boolean;
  mode?: 'http' | 'local-command';
  baseUrl?: string;
  command?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
};

export type KnowledgeChunkingConfig = {
  strategy?: 'structure_recursive';
  targetMinTokens?: number;
  targetMaxTokens?: number;
  hardMaxTokens?: number;
  mergeBelowTokens?: number;
  overlapTokens?: number;
};

export type KnowledgeEmbeddingConfig = KnowledgeHttpAuth & {
  enabled?: boolean;
  provider?: 'openai-compatible' | 'ollama';
  baseUrl?: string;
  model?: string;
  dimension?: number;
  batchSize?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
};

export type KnowledgeRetrievalConfig = {
  vectorTopK?: number;
  ftsTopK?: number;
  fusedTopK?: number;
};

export type KnowledgeRerankerConfig = KnowledgeHttpAuth & {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  model?: string;
  topK?: number;
  timeoutMs?: number;
  failureMode?: 'fallback' | 'fail';
};

export type KnowledgeContextConfig = {
  neighborBefore?: number;
  neighborAfter?: number;
  maxTokens?: number;
};

export type KnowledgeLlmConfig = {
  /** Resolves to an existing provider + model id. */
  modelRef?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type KnowledgePointsConfig = {
  dedupSimilarity?: number;
  minimumImportance?: number;
};

export type KnowledgeJobsConfig = {
  ingestionConcurrency?: number;
  generationConcurrency?: number;
};

export type KnowledgeStorageConfig = {
  lancedbUri?: string;
  chunkTable?: string;
};

export type KnowledgeConfig = {
  storage?: KnowledgeStorageConfig;
  parser?: {
    unstructured?: KnowledgeParserHttpConfig;
    mineru?: KnowledgeMineruConfig;
  };
  chunking?: KnowledgeChunkingConfig;
  embedding?: KnowledgeEmbeddingConfig;
  retrieval?: KnowledgeRetrievalConfig;
  reranker?: KnowledgeRerankerConfig;
  context?: KnowledgeContextConfig;
  extractionLlm?: KnowledgeLlmConfig;
  flashcardLlm?: KnowledgeLlmConfig;
  knowledgePoints?: KnowledgePointsConfig;
  jobs?: KnowledgeJobsConfig;
};
