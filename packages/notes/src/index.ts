export { createNoteStore } from './note-store.js';
export type { NoteStore, NoteStoreOptions, ScannedNote } from './note-store.js';
export { openNoteIndex } from './note-index.js';
export type { NoteIndex } from './note-index.js';
export { searchNotes } from './search-notes.js';
export type { SearchNotesOptions } from './search-notes.js';
export { fuseHybridHits, DEFAULT_RRF_K } from './hybrid-search.js';
export type { ChannelResults } from './hybrid-search.js';
export { createEmbeddingProvider } from './embedding/create-provider.js';
export type { CreateEmbeddingProviderOptions } from './embedding/create-provider.js';
export { createOpenAiCompatibleEmbedding } from './embedding/openai-compatible.js';
export { createOllamaEmbedding } from './embedding/ollama.js';
export { cosineSimilarity } from './vector-math.js';
export { tokenize, tokenizeForIndex, buildMatchExpression } from './tokenize.js';
export { encodeNoteMarkdown, decodeNoteMarkdown } from './markdown-codec.js';
export {
  getNotesRoot,
  getIndexPath,
  assertInsideNotesRoot,
  DEFAULT_COLLECTION,
} from './paths.js';
