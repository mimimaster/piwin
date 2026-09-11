/** Response readers for `knowledge/*` commands. Shapes are checked, not assumed. */
import {
  readKnowledgeToolDetails,
  KNOWLEDGE_CITATIONS_DETAILS_KIND,
  type KnowledgeBaseSummary,
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
    (value.kind === 'notes' || value.kind === 'folder') &&
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
