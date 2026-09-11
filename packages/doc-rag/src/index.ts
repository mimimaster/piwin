/** @piwin/doc-rag — folder-scoped document indexing & retrieval for flashcard generation. */

export type {
  DocChunk,
  DocChunker,
  ScannedDocFile,
  RetrieveOptions,
  RetrievedChunk,
  IndexFolderOptions,
  IndexFolderResult,
  RetrieveResult,
  ScanFolderResult,
  ListByFolderResult,
  OpenSourceResult,
  FlashcardGenerationParams,
} from '@piwin/contracts';
export type { FolderRag, FolderDocumentRecord } from './doc-rag-types.js';

export {
  createDefaultChunker,
  detectLanguage,
  isSupportedExtension,
} from './chunker.js';

export { createFolderRag } from './folder-rag.js';
export type { CreateFolderRagOptions } from './folder-rag.js';
export { createParserRegistry } from './parsers/registry.js';
export type { ParserRegistry } from './parsers/registry.js';
export { createMarkdownParser } from './parsers/markdown-parser.js';
export { createTextParser } from './parsers/text-parser.js';
export { chunkParsedDocument } from './chunking/chunk-service.js';
export { mapUnstructuredElements } from './parsers/unstructured-adapter.js';
export { mapMineruContentList } from './parsers/mineru-adapter.js';
export { openLanceDocIndex } from './indexing/lancedb-index.js';
export type { DocIndexStore } from './indexing/doc-index-store.js';
export { retrieveV2 } from './retrieval/retrieval-service.js';
export { createHttpReranker } from './retrieval/http-reranker.js';
export { adaptNotesEmbedding } from './embedding-adapter.js';

export { buildFlashcardGenerationPrompt } from './prompt-builder.js';
export type { BuildFlashcardGenerationPromptInput } from './prompt-builder.js';

export { FLASHCARD_QUALITY_RULES } from './quality-rules.js';
export {
  assignPositions,
  toFlashcardCreateInputs,
  writeGenerationRecord,
  buildSinglePassPrompt,
  parseDraftCardsJson,
} from './generation/generation-service.js';
export type { DraftCardsFn, DraftCardsRequest } from './generation/generation-service.js';
export { runTwoStageGeneration, TWO_STAGE_PIPELINE } from './generation/generation-pipeline.js';
export type { CompleteJsonFn, TwoStageGenerationResult } from './generation/generation-pipeline.js';
export { parseRawKnowledgePoints, RAW_KNOWLEDGE_POINT_SCHEMA } from './generation/kp-schema.js';
export { resolveSourceIds } from './generation/resolve-source-ids.js';
export { postprocessKnowledgePoints } from './generation/kp-postprocess.js';
export { parseGeneratedFlashcards } from './generation/flashcard-schema.js';
export { qaGeneratedFlashcards } from './generation/flashcard-qa.js';
export { getStateStorePath } from './paths.js';

export {
  canonicalizeFolderPath,
  canonicalizeFolderPathSync,
  folderKey,
  getDocRagRoot,
  getDocIndexPath,
  getLanceDbPath,
  documentIdFor,
  getSourcePathSidecar,
  listSourcePathSidecars,
  isSafeRelativePath,
  isPathConfined,
} from './paths.js';

export {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_WALK_DEPTH,
  SKIP_DIR_NAMES,
  SKIP_FILE_NAME_PATTERNS,
  DEFAULT_RETRIEVE_LIMIT,
  DEFAULT_MAX_TOTAL_CHARS,
  DEFAULT_MAX_BATCH_SIZE,
  CODE_FALLBACK_MAX_LINES,
} from './limits.js';
