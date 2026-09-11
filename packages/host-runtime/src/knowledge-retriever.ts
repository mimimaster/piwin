/**
 * Multi-base knowledge retrieval: notes via searchNotes, folders via retrievePack,
 * then RRF merge. Mapping and merge are pure.
 */
import {
  KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  type ContextPackSource,
  type KnowledgeBaseSummary,
  type KnowledgeCitation,
  type KnowledgeSearchResult,
  type KnowledgeSearchSkipReason,
  type NoteSearchHit,
} from '@piwin/contracts';
import { DEFAULT_MAX_TOTAL_CHARS, type FolderRag } from '@piwin/doc-rag';
import { reciprocalRankFusion, searchNotes } from '@piwin/notes';
import {
  isSearchableKnowledgeBaseState,
} from './knowledge-base-state.js';
import type { KnowledgeBaseRuntime, NotesServices } from './knowledge-base-service.js';
import { listKnowledgeBaseSummaries } from './knowledge-base-service.js';

export const KNOWLEDGE_SEARCH_MAX_TOTAL_CHARS = DEFAULT_MAX_TOTAL_CHARS;

export type UnnumberedKnowledgeCitation = Omit<KnowledgeCitation, 'ref'>;

export type RankedKnowledgeHits = {
  baseId: string;
  citations: UnnumberedKnowledgeCitation[];
};

export function clampKnowledgeSearchLimit(limit: number | undefined): number {
  const requested = limit === undefined ? KNOWLEDGE_SEARCH_DEFAULT_LIMIT : Math.floor(limit);
  if (!Number.isFinite(requested) || requested < 1) return KNOWLEDGE_SEARCH_DEFAULT_LIMIT;
  return Math.min(KNOWLEDGE_SEARCH_MAX_LIMIT, requested);
}

export function citationIdentity(citation: Pick<
  UnnumberedKnowledgeCitation,
  'baseId' | 'noteId' | 'relativePath' | 'startLine' | 'pageStart'
>): string {
  return [
    citation.baseId,
    citation.noteId ?? '',
    citation.relativePath ?? '',
    citation.startLine === undefined ? '' : String(citation.startLine),
    citation.pageStart === undefined ? '' : String(citation.pageStart),
  ].join('\0');
}

export function mapNoteHitToCitation(
  hit: NoteSearchHit,
  base: Pick<KnowledgeBaseSummary, 'id' | 'name'>,
): UnnumberedKnowledgeCitation {
  const citation: UnnumberedKnowledgeCitation = {
    baseId: base.id,
    baseName: base.name,
    kind: 'notes',
    title: hit.note.title,
    noteId: hit.note.id,
    text: hit.snippet,
    score: hit.score,
  };
  return citation;
}

export function mapContextPackSourceToCitation(
  source: ContextPackSource,
  base: Pick<KnowledgeBaseSummary, 'id' | 'name'>,
): UnnumberedKnowledgeCitation {
  const score = source.rerankScore ?? source.retrievalScore;
  const citation: UnnumberedKnowledgeCitation = {
    baseId: base.id,
    baseName: base.name,
    kind: 'folder',
    title: source.relativePath,
    relativePath: source.relativePath,
    text: source.text,
  };
  if (source.headingPath && source.headingPath.length > 0) {
    citation.headingPath = source.headingPath;
  }
  if (source.startLine !== undefined) citation.startLine = source.startLine;
  if (source.endLine !== undefined) citation.endLine = source.endLine;
  if (source.pageStart !== undefined) citation.pageStart = source.pageStart;
  if (source.pageEnd !== undefined) citation.pageEnd = source.pageEnd;
  if (score !== undefined) citation.score = score;
  return citation;
}

export function mergeRankedKnowledgeHits(
  perBase: readonly RankedKnowledgeHits[],
  options?: { limit?: number; maxTotalChars?: number; rrfK?: number; startRef?: number },
): KnowledgeCitation[] {
  const limit = clampKnowledgeSearchLimit(options?.limit);
  const maxTotalChars = options?.maxTotalChars ?? KNOWLEDGE_SEARCH_MAX_TOTAL_CHARS;
  const startRef = options?.startRef !== undefined && options.startRef > 0 ? options.startRef : 1;
  const byId = new Map<string, UnnumberedKnowledgeCitation>();
  const rankedIdLists: string[][] = [];
  for (const group of perBase) {
    const ids: string[] = [];
    for (const citation of group.citations) {
      const id = citationIdentity(citation);
      if (!byId.has(id)) byId.set(id, citation);
      ids.push(id);
    }
    if (ids.length > 0) rankedIdLists.push(ids);
  }
  const scores = reciprocalRankFusion(rankedIdLists, {
    ...(options?.rrfK !== undefined ? { rrfK: options.rrfK } : {}),
  });
  const ranked = [...byId.entries()]
    .map(([id, citation]) => {
      const fused: UnnumberedKnowledgeCitation = {
        ...citation,
        score: scores.get(id) ?? citation.score ?? 0,
      };
      return fused;
    })
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const selected: KnowledgeCitation[] = [];
  let usedChars = 0;
  let ref = startRef;
  for (const citation of ranked) {
    if (selected.length >= limit) break;
    const remaining = maxTotalChars - usedChars;
    if (remaining <= 0) break;
    const text =
      citation.text.length > remaining ? citation.text.slice(0, remaining) : citation.text;
    if (text.length === 0) break;
    selected.push({ ...citation, text, ref });
    usedChars += text.length;
    ref += 1;
  }
  return selected;
}

export function skipReasonForBase(
  base: KnowledgeBaseSummary | undefined,
): KnowledgeSearchSkipReason | null {
  if (!base) return 'unknown';
  if (base.state === 'missing') return 'missing';
  if (base.state === 'not-indexed') return 'not-indexed';
  if (base.state === 'indexing') return 'indexing';
  if (isSearchableKnowledgeBaseState(base.state) || base.state === 'empty') return null;
  return 'not-indexed';
}

export async function searchKnowledgeBases(
  runtime: KnowledgeBaseRuntime,
  input: { query: string; baseIds?: string[]; limit?: number; startRef?: number },
): Promise<KnowledgeSearchResult> {
  const query = input.query.trim();
  const limit = clampKnowledgeSearchLimit(input.limit);
  const bases = await listKnowledgeBaseSummaries(runtime);
  const byId = new Map(bases.map((base) => [base.id, base]));
  const requested =
    input.baseIds && input.baseIds.length > 0
      ? input.baseIds
      : bases.filter((base) => isSearchableKnowledgeBaseState(base.state)).map((base) => base.id);

  const skipped: KnowledgeSearchResult['skipped'] = [];
  const degradedBaseIds: string[] = [];
  const perBase: RankedKnowledgeHits[] = [];
  const rag = await runtime.getFolderRag();

  for (const baseId of requested) {
    const base = byId.get(baseId);
    const skip = skipReasonForBase(base);
    if (skip && !(base?.kind === 'notes' && base.state === 'empty')) {
      skipped.push(skipEntry(baseId, skip));
      continue;
    }
    if (!base) {
      skipped.push(skipEntry(baseId, 'unknown'));
      continue;
    }
    try {
      if (base.kind === 'notes') {
        if (!runtime.getNotesServices) {
          skipped.push(skipEntry(baseId, 'error', 'Notes services are not available'));
          continue;
        }
        const notes = await searchNotesBase(runtime, query, limit);
        perBase.push({
          baseId: base.id,
          citations: notes.hits.map((hit) => mapNoteHitToCitation(hit, base)),
        });
        if (notes.degraded) degradedBaseIds.push(base.id);
      } else {
        const folder = await searchFolderBase(rag, base, query, limit);
        perBase.push({ baseId: base.id, citations: folder.citations });
        if (folder.degraded) degradedBaseIds.push(base.id);
      }
    } catch (error) {
      skipped.push({
        baseId,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    citations: mergeRankedKnowledgeHits(perBase, {
      limit,
      ...(input.startRef !== undefined ? { startRef: input.startRef } : {}),
    }),
    degradedBaseIds,
    skipped,
  };
}

function skipEntry(
  baseId: string,
  reason: KnowledgeSearchSkipReason,
  message?: string,
): KnowledgeSearchResult['skipped'][number] {
  return message === undefined ? { baseId, reason } : { baseId, reason, message };
}

async function searchNotesBase(
  runtime: KnowledgeBaseRuntime,
  query: string,
  limit: number,
): Promise<{ hits: NoteSearchHit[]; degraded: boolean }> {
  if (!runtime.getNotesServices) {
    throw new Error('Notes services are not available');
  }
  const services: NotesServices = await runtime.getNotesServices();
  const hits = await searchNotes(services.index, { query, limit }, services.searchOptions);
  return {
    hits,
    degraded: services.searchOptions.embeddingProvider === undefined,
  };
}

async function searchFolderBase(
  rag: FolderRag,
  base: KnowledgeBaseSummary,
  query: string,
  limit: number,
): Promise<{ citations: UnnumberedKnowledgeCitation[]; degraded: boolean }> {
  const folderPath = base.folderPath;
  if (!folderPath) {
    throw new Error(`Folder knowledge base ${base.id} has no folderPath`);
  }
  const pack = await rag.retrievePack(folderPath, query, { limit });
  return {
    citations: pack.sources.map((source) => mapContextPackSourceToCitation(source, base)),
    degraded: pack.degraded || !rag.hasEmbeddingProvider,
  };
}


