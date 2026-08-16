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
export type { FolderRag } from './doc-rag-types.js';

export {
  createDefaultChunker,
  detectLanguage,
  isSupportedExtension,
} from './chunker.js';

export { openDocIndex } from './doc-index.js';
export type { DocIndex } from './doc-index.js';

export { createFolderRag } from './folder-rag.js';
export type { CreateFolderRagOptions } from './folder-rag.js';
export { createParserRegistry } from './parsers/registry.js';
export type { ParserRegistry } from './parsers/registry.js';
export { createMarkdownParser } from './parsers/markdown-parser.js';
export { createTextParser } from './parsers/text-parser.js';
export { chunkParsedDocument } from './chunking/chunk-service.js';
export { mapUnstructuredElements } from './parsers/unstructured-adapter.js';
export { mapMineruContentList } from './parsers/mineru-adapter.js';

export { buildFlashcardGenerationPrompt } from './prompt-builder.js';
export type { BuildFlashcardGenerationPromptInput } from './prompt-builder.js';

export { FLASHCARD_QUALITY_RULES } from './quality-rules.js';

export {
  canonicalizeFolderPath,
  canonicalizeFolderPathSync,
  folderKey,
  getDocRagRoot,
  getDocIndexPath,
  getSourcePathSidecar,
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
