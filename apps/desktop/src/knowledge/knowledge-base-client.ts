/** Response readers for `knowledge/*` commands. Shapes are checked, not assumed. */
import {
  readKnowledgeToolDetails,
  KNOWLEDGE_CITATIONS_DETAILS_KIND,
  type KnowledgeBaseSummary,
  type KnowledgeDocumentEntry,
  type KnowledgeDocumentListResult,
  type KnowledgeDocumentReadResult,
  type KnowledgeSearchResult,
} from '@piwin/contracts';

const BASE_STATES = new Set(['empty', 'missing', 'not-indexed', 'indexing', 'ready', 'partial']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKnowledgeBaseSummary(value: unknown): value is KnowledgeBaseSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'notes' || value.kind === 'folder' || value.kind === 'wiki') &&
    typeof value.name === 'string' &&
    typeof value.state === 'string' &&
    BASE_STATES.has(value.state) &&
    typeof value.degraded === 'boolean' &&
    typeof value.documentCount === 'number'
  );
}

export function readKnowledgeBaseList(data: unknown): KnowledgeBaseSummary[] | null {
  if (!isRecord(data) || !Array.isArray(data.bases)) return null;
  return data.bases.filter(isKnowledgeBaseSummary);
}

export function readKnowledgeBaseMutation(data: unknown): KnowledgeBaseSummary | null {
  return isRecord(data) && isKnowledgeBaseSummary(data.base) ? data.base : null;
}

/** Removed base id, from `KnowledgeBaseRemoveResult`. */
export function readKnowledgeBaseRemoval(data: unknown): string | null {
  return isRecord(data) && data.removed === true && typeof data.baseId === 'string'
    ? data.baseId
    : null;
}

export function readKnowledgeSearchResult(data: unknown): KnowledgeSearchResult | null {
  if (!isRecord(data)) return null;
  const details = readKnowledgeToolDetails({
    kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
    citations: data.citations,
    degradedBaseIds: data.degradedBaseIds,
  });
  if (!details) return null;
  const skipped = Array.isArray(data.skipped) ? data.skipped.filter(isRecord) : [];
  return {
    citations: details.citations,
    degradedBaseIds: details.degradedBaseIds,
    skipped: skipped.flatMap((entry) =>
      typeof entry.baseId === 'string' && typeof entry.reason === 'string'
        ? [
            {
              baseId: entry.baseId,
              reason: entry.reason as KnowledgeSearchResult['skipped'][number]['reason'],
              ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
            },
          ]
        : [],
    ),
  };
}

/** Bases the agent can search right now. */
export function isSearchableKnowledgeBase(base: KnowledgeBaseSummary): boolean {
  return base.state === 'ready' || base.state === 'partial';
}

function isKnowledgeDocumentEntry(value: unknown): value is KnowledgeDocumentEntry {
  return (
    isRecord(value) &&
    typeof value.relativePath === 'string' &&
    typeof value.title === 'string' &&
    typeof value.extension === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.language === 'string' &&
    typeof value.indexed === 'boolean' &&
    typeof value.chunkCount === 'number' &&
    (value.readability === 'text' || value.readability === 'unsupported')
  );
}

/** One page of `knowledge/documents/list`. */
export function readKnowledgeDocumentList(data: unknown): KnowledgeDocumentListResult | null {
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  if (typeof data.baseId !== 'string' || typeof data.total !== 'number') return null;
  return {
    baseId: data.baseId,
    folderPath: typeof data.folderPath === 'string' ? data.folderPath : '',
    items: data.items.filter(isKnowledgeDocumentEntry),
    ...(typeof data.nextCursor === 'string' && data.nextCursor.length > 0
      ? { nextCursor: data.nextCursor }
      : {}),
    total: data.total,
  };
}

/** One bounded window from `knowledge/document/read`. */
export function readKnowledgeDocumentRead(data: unknown): KnowledgeDocumentReadResult | null {
  if (
    !isRecord(data) ||
    typeof data.baseId !== 'string' ||
    typeof data.relativePath !== 'string' ||
    typeof data.text !== 'string' ||
    typeof data.startLine !== 'number' ||
    typeof data.endLine !== 'number' ||
    typeof data.totalLines !== 'number' ||
    typeof data.hasMore !== 'boolean'
  ) {
    return null;
  }
  return {
    baseId: data.baseId,
    relativePath: data.relativePath,
    title: typeof data.title === 'string' ? data.title : data.relativePath,
    language: typeof data.language === 'string' ? data.language : 'text',
    text: data.text,
    startLine: data.startLine,
    endLine: data.endLine,
    totalLines: data.totalLines,
    hasMore: data.hasMore,
    truncatedChars: data.truncatedChars === true,
    indexed: data.indexed === true,
    chunkCount: typeof data.chunkCount === 'number' ? data.chunkCount : 0,
    readability: data.readability === 'unsupported' ? 'unsupported' : 'text',
  };
}
