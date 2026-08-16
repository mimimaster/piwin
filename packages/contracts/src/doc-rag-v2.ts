/**
 * Doc Cards V2 job / generation types.
 * Scan returns supported `ScannedDocFile`s plus optional `unsupported`.
 */

export type ParsedBlockType =
  | 'title'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'quote';

export type ParsedBlock = {
  blockId: string;
  order: number;
  type: ParsedBlockType;
  text: string;
  headingPath?: string[];
  page?: number;
  startLine?: number;
  endLine?: number;
};

export type ParsedDocument = {
  documentId: string;
  relativePath: string;
  title?: string;
  blocks: ParsedBlock[];
  parser: { id: string; version: string };
};

export type DocChunkV2 = {
  chunkId: string;
  documentId: string;
  folderKey: string;
  relativePath: string;
  content: string;
  contentHash: string;
  headingPath?: string[];
  sourceOrder: number;
  startLine?: number;
  endLine?: number;
  pageStart?: number;
  pageEnd?: number;
  previousChunkId?: string;
  nextChunkId?: string;
  language?: string;
  tokenCount: number;
  parserId: string;
  parserVersion: string;
  chunkerId: string;
  chunkerVersion: string;
};

export type ScannedFileV2 = {
  relativePath: string;
  extension: string;
  sizeBytes: number;
  support: 'supported' | 'unsupported';
  unsupportedReason?:
    | 'MINERU_NOT_CONFIGURED'
    | 'UNSTRUCTURED_NOT_CONFIGURED'
    | 'UNSUPPORTED_FILE_TYPE';
};

export type DocumentIndexStatus =
  | 'DISCOVERED'
  | 'PARSING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'INDEXING'
  | 'READY'
  | 'FAILED'
  | 'UNSUPPORTED';

export type DocumentManifest = {
  documentId: string;
  folderKey: string;
  relativePath: string;
  extension: string;
  fileSize: number;
  fileHash: string;
  status: DocumentIndexStatus;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  indexedAt?: string;
};

export type IngestionJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_DEGRADED'
  | 'FAILED'
  | 'CANCELED';

export type IngestionJob = {
  id: string;
  folderKey: string;
  workspaceName: string;
  folderPath: string;
  includeFiles: string[];
  status: IngestionJobStatus;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  skippedUnsupported: number;
  stageCounts: { parsing: number; chunking: number; embedding: number; indexing: number };
  warnings: Array<{ file: string; code: string; message: string }>;
  startedAt?: string;
  completedAt?: string;
};

export type IndexFolderAccepted = {
  jobId: string;
  status: 'PENDING' | 'RUNNING';
};

export type GenerationJobStatus =
  | 'PENDING'
  | 'CHECKING_INDEX'
  | 'RETRIEVING'
  | 'RERANKING'
  | 'ASSEMBLING_CONTEXT'
  | 'EXTRACTING_KNOWLEDGE'
  | 'PROCESSING_KNOWLEDGE'
  | 'GENERATING_CARDS'
  | 'VALIDATING'
  | 'PERSISTING'
  | 'OPENING_SESSION'
  | 'COMPLETED'
  | 'COMPLETED_DEGRADED'
  | 'FAILED'
  | 'CANCELED';

export type GenerationJob = {
  id: string;
  folderKey: string;
  folderPath: string;
  workspaceName: string;
  includeFiles: string[];
  topic?: string;
  status: GenerationJobStatus;
  sequenceId?: string;
  createdCardIds?: string[];
  sessionId?: string;
  created?: number;
  skipped?: number;
  startedAt?: string;
  completedAt?: string;
};

export type FlashcardGenerationRequest = {
  folder: string;
  includeFiles?: string[];
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  density?: 'concise' | 'standard' | 'detailed';
  deck?: string;
};

export type ContextPackSource = {
  chunkId: string;
  documentId: string;
  relativePath: string;
  headingPath?: string[];
  startLine?: number;
  endLine?: number;
  pageStart?: number;
  pageEnd?: number;
  text: string;
  retrievalScore?: number;
  rerankScore?: number;
  retrievedBy: 'hybrid' | 'fts' | 'neighbor';
};

export type ContextPack = {
  query: string;
  folderKey: string;
  retrievalMode: 'hybrid' | 'fts_only';
  degraded: boolean;
  sources: ContextPackSource[];
};

export type KnowledgePointType =
  | 'definition'
  | 'fact'
  | 'property'
  | 'structure'
  | 'mechanism'
  | 'reason'
  | 'relationship'
  | 'comparison'
  | 'procedure'
  | 'application'
  | 'example'
  | 'exception'
  | 'formula';

export type RawKnowledgePoint = {
  tempId: string;
  concept: string;
  statement: string;
  type: KnowledgePointType;
  importance: number;
  sourceChunkIds: string[];
};

export type KnowledgePoint = {
  id: string;
  concept: string;
  statement: string;
  type: KnowledgePointType;
  importance: number;
  sourceChunkIds: string[];
  sourceOrder: number;
};

export type GeneratedFlashcard = {
  position: number;
  front: string;
  back: string;
  cardType: string;
  relationFromPrevious?: string;
  knowledgePointIds: string[];
  sourceChunkIds: string[];
};

export type DocCardSequenceView = {
  sequenceId: string;
  generationId: string;
  workspaceName: string;
  cardIds: string[];
};

export type DoccardsErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'MINERU_NOT_CONFIGURED'
  | 'UNSTRUCTURED_NOT_CONFIGURED'
  | 'PARSER_FAILED'
  | 'INDEX_NOT_READY'
  | 'INDEX_FAILED'
  | 'INDEX_RUNNING'
  | 'NO_SUPPORTED_FILES'
  | 'HOST_RESTARTED'
  | 'GENERATION_RUNNING'
  | 'NO_RETRIEVAL_RESULTS'
  | 'RERANKER_FAILED'
  | 'KNOWLEDGE_EXTRACTION_FAILED'
  | 'NO_VALID_KNOWLEDGE_POINTS'
  | 'FLASHCARD_GENERATION_FAILED'
  | 'NO_VALID_FLASHCARDS'
  | 'GENERATION_MODEL_NOT_CONFIGURED';
