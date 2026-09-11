export { createNoteStore, NoteRevisionConflictError } from './note-store.js';
export type { NoteStore, NoteStoreOptions, ScannedNote } from './note-store.js';
export { reciprocalRankFusion, DEFAULT_RRF_K } from './hybrid-search.js';
export { createEmbeddingProvider } from './embedding/create-provider.js';
export type { CreateEmbeddingProviderOptions } from './embedding/create-provider.js';
export { createOpenAiCompatibleEmbedding } from './embedding/openai-compatible.js';
export { createOllamaEmbedding } from './embedding/ollama.js';
export { createLlmRerank, parseRankingIds, applyRanking } from './rerank/llm-rerank.js';
export type { LlmRerankOptions } from './rerank/llm-rerank.js';
export { cosineSimilarity } from './vector-math.js';
export {
  loadGoldenSet,
  parseGoldenSet,
  appendGoldenCase,
  getGoldenSetPath,
} from './golden-set.js';
export { tokenize, tokenizeForIndex, buildMatchExpression } from './tokenize.js';
export { encodeNoteMarkdown, decodeNoteMarkdown } from './markdown-codec.js';
export {
  getNotesRoot,
  getIndexPath,
  assertInsideNotesRoot,
  DEFAULT_COLLECTION,
} from './paths.js';
