/**
 * Multi-base knowledge retrieval: every base goes through retrievePack,
 * then RRF merge. Notes citations are shaped separately from folder ones.
 */
import { basename } from 'node:path';
import {
  KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  NOTES_KNOWLEDGE_BASE_ID,
  WIKI_KNOWLEDGE_BASE_ID,
  type ContextPackSource,
  type KnowledgeBaseSummary,
  type KnowledgeCitation,
  type KnowledgeSearchResult,
  type KnowledgeSearchSkipReason,
} from '@piwin/contracts';
import { DEFAULT_MAX_TOTAL_CHARS, type FolderDocumentRecord, type FolderRag } from '@piwin/doc-rag';
import { getNotesRoot, reciprocalRankFusion } from '@piwin/notes';
import {
  isSearchableKnowledgeBaseState,
} from './knowledge-base-state.js';
import type { KnowledgeBaseRuntime } from './knowledge-base-service.js';
import { listKnowledgeBaseSummaries } from './knowledge-base-service.js';
import { getPiwinRoot, getPiwinWikiDir } from './paths.js';

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
  copySharedSourceFields(citation, source, score);
  return citation;
}

export function mapContextPackSourceToNotesCitation(
  source: ContextPackSource,
  base: Pick<KnowledgeBaseSummary, 'id' | 'name'>,
): UnnumberedKnowledgeCitation {
  const score = source.rerankScore ?? source.retrievalScore;
  const titleFromMeta = source.metadata?.title;
  const citation: UnnumberedKnowledgeCitation = {
    baseId: base.id,
    baseName: base.name,
    kind: 'notes',
    title: typeof titleFromMeta === 'string' && titleFromMeta.length > 0 ? titleFromMeta : source.relativePath,
    noteId: noteIdFromRelativePath(source.relativePath),
    relativePath: source.relativePath,
    text: source.text,
  };
  copySharedSourceFields(citation, source, score);
  return citation;
}

export function mapContextPackSourceToWikiCitation(
  source: ContextPackSource,
  base: Pick<KnowledgeBaseSummary, 'id' | 'name'>,
): UnnumberedKnowledgeCitation {
  const score = source.rerankScore ?? source.retrievalScore;
  const titleFromMeta = source.metadata?.title;
  const citation: UnnumberedKnowledgeCitation = {
    baseId: base.id,
    baseName: base.name,
    kind: 'wiki',
    title: typeof titleFromMeta === 'string' && titleFromMeta.length > 0 ? titleFromMeta : source.relativePath,
    relativePath: source.relativePath,
    text: source.text,
  };
  copySharedSourceFields(citation, source, score);
  return citation;
}

function copySharedSourceFields(
  citation: UnnumberedKnowledgeCitation,
  source: ContextPackSource,
  score: number | undefined,
): void {
  if (source.headingPath && source.headingPath.length > 0) {
    citation.headingPath = source.headingPath;
  }
  if (source.startLine !== undefined) citation.startLine = source.startLine;
  if (source.endLine !== undefined) citation.endLine = source.endLine;
  if (source.pageStart !== undefined) citation.pageStart = source.pageStart;
  if (source.pageEnd !== undefined) citation.pageEnd = source.pageEnd;
  if (score !== undefined) citation.score = score;
  if (source.metadata) citation.metadata = source.metadata;
}

export function noteIdFromRelativePath(relativePath: string): string {
  const base = basename(relativePath);
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
}

export function relativePathsMatchingTags(
  documents: readonly FolderDocumentRecord[],
  tags: readonly string[],
): string[] {
  const wanted = new Set(tags);
  return documents
    .filter((document) => {
      const raw = document.metadata?.tags;
      if (!Array.isArray(raw)) return false;
      return raw.some((tag) => typeof tag === 'string' && wanted.has(tag));
    })
    .map((document) => document.relativePath);
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
  input: { query: string; baseIds?: string[]; tags?: string[]; limit?: number; startRef?: number },
): Promise<KnowledgeSearchResult> {
  const query = input.query.trim();
  const limit = clampKnowledgeSearchLimit(input.limit);
  const tags = input.tags?.filter((tag) => tag.trim().length > 0);
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

  if (requested.includes(NOTES_KNOWLEDGE_BASE_ID)) {
    const notes = byId.get(NOTES_KNOWLEDGE_BASE_ID);
    const notesPath =
      notes?.folderPath ?? getNotesRoot(getPiwinRoot(runtime.piwinRoot));
    if (notes?.state !== 'missing') {
      try {
        await rag.indexFolder(notesPath);
      } catch (error) {
        console.warn(
          `notes drift reindex failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (requested.includes(WIKI_KNOWLEDGE_BASE_ID)) {
    const wiki = byId.get(WIKI_KNOWLEDGE_BASE_ID);
    const wikiPath =
      wiki?.folderPath ?? getPiwinWikiDir(getPiwinRoot(runtime.piwinRoot));
    if (wiki?.state !== 'missing') {
      try {
        await rag.indexFolder(wikiPath);
      } catch (error) {
        console.warn(
          `wiki drift reindex failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  for (const baseId of requested) {
    const base = byId.get(baseId);
    const skip = skipReasonForBase(base);
    const notesNotIndexed = base?.kind === 'notes' && skip === 'not-indexed';
    const wikiNotIndexed = base?.kind === 'wiki' && skip === 'not-indexed';
    if (skip && !notesNotIndexed && !wikiNotIndexed) {
      skipped.push(skipEntry(baseId, skip));
      continue;
    }
    if (!base) {
      skipped.push(skipEntry(baseId, 'unknown'));
      continue;
    }
    try {
      const folder = await searchFolderBase(rag, base, query, limit, tags);
      if (folder.emptyAllowlist) continue;
      perBase.push({ baseId: base.id, citations: folder.citations });
      if (folder.degraded) degradedBaseIds.push(base.id);
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

async function searchFolderBase(
  rag: FolderRag,
  base: KnowledgeBaseSummary,
  query: string,
  limit: number,
  tags: string[] | undefined,
): Promise<{ citations: UnnumberedKnowledgeCitation[]; degraded: boolean; emptyAllowlist: boolean }> {
  const folderPath = base.folderPath;
  if (!folderPath) {
    throw new Error(`Folder knowledge base ${base.id} has no folderPath`);
  }
  let fileAllowlist: string[] | undefined;
  if (tags && tags.length > 0) {
    const documents = await rag.listDocuments(folderPath);
    const allowed = relativePathsMatchingTags(documents, tags);
    if (allowed.length === 0) {
      return { citations: [], degraded: false, emptyAllowlist: true };
    }
    fileAllowlist = allowed;
  }
  const pack = await rag.retrievePack(folderPath, query, {
    limit,
    ...(fileAllowlist ? { fileAllowlist } : {}),
  });
  const mapper =
    base.kind === 'notes'
      ? mapContextPackSourceToNotesCitation
      : base.kind === 'wiki'
        ? mapContextPackSourceToWikiCitation
        : mapContextPackSourceToCitation;
  return {
    citations: pack.sources.map((source) => mapper(source, base)),
    degraded: pack.degraded || !rag.hasEmbeddingProvider,
    emptyAllowlist: false,
  };
}
