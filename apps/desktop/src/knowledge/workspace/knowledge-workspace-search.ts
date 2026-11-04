/**
 * One search over materials, wiki pages and cards. Host retrieval stays as
 * knowledge/search + flashcards/study/catalog; this module only groups, marks
 * derived wiki hits, and admits title matches when a folder is not indexed.
 */
import type {
  FlashcardStudyCatalogPage,
  KnowledgeCitation,
  KnowledgeDocumentEntry,
  KnowledgeSearchResult,
} from '@piwin/contracts';

export type WorkspaceSearchKind = 'material' | 'wiki' | 'card';

export type WorkspaceSearchHit = {
  kind: WorkspaceSearchKind;
  id: string;
  title: string;
  snippet: string;
  sourceLabel: string;
  derivedFromId?: string;
  titleMatchOnly?: boolean;
  citation?: KnowledgeCitation;
  wikiSlug?: string;
  cardId?: string;
  baseId?: string;
  relativePath?: string;
};

export type WorkspaceSearchGroup = {
  kind: WorkspaceSearchKind;
  hits: WorkspaceSearchHit[];
};

export type TitleMatch = {
  baseId: string;
  baseName: string;
  entry: KnowledgeDocumentEntry;
};

export type WorkspaceSearchPage = {
  query: string;
  groups: WorkspaceSearchGroup[];
  skipped: KnowledgeSearchResult['skipped'];
  unindexed: boolean;
};

const KIND_ORDER: readonly WorkspaceSearchKind[] = ['material', 'wiki', 'card'];

export function wikiSlugFromPath(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '');
}

export function mergeWorkspaceSearchHits(input: {
  query: string;
  search: KnowledgeSearchResult;
  catalog?: FlashcardStudyCatalogPage | null;
  titleMatches?: readonly TitleMatch[];
}): WorkspaceSearchPage {
  const materials: WorkspaceSearchHit[] = [];
  const wiki: WorkspaceSearchHit[] = [];
  const materialByPath = new Map<string, string>();

  for (const citation of input.search.citations) {
    if (citation.kind === 'wiki') {
      wiki.push(hitFromCitation('wiki', citation));
      continue;
    }
    const hit = hitFromCitation('material', citation);
    materials.push(hit);
    if (citation.relativePath) {
      materialByPath.set(pathKey(citation.baseId, citation.relativePath), hit.id);
    }
  }

  for (const match of input.titleMatches ?? []) {
    const key = pathKey(match.baseId, match.entry.relativePath);
    if (materialByPath.has(key)) continue;
    const hit: WorkspaceSearchHit = {
      kind: 'material',
      id: `title:${match.baseId}:${match.entry.relativePath}`,
      title: match.entry.title,
      snippet: match.entry.relativePath,
      sourceLabel: match.baseName,
      titleMatchOnly: true,
      baseId: match.baseId,
      relativePath: match.entry.relativePath,
    };
    materials.push(hit);
    materialByPath.set(key, hit.id);
  }

  for (const hit of wiki) {
    const derived = derivedMaterialId(hit.citation, materialByPath);
    if (derived) hit.derivedFromId = derived;
  }

  const cards: WorkspaceSearchHit[] = (input.catalog?.tiles ?? []).map((tile) => {
    const hit: WorkspaceSearchHit = {
      kind: 'card',
      id: `card:${tile.id}`,
      title: tile.preview,
      snippet: tile.preview,
      sourceLabel: tile.kind === 'set' ? 'set' : 'card',
    };
    if (tile.kind === 'single') hit.cardId = tile.id;
    return hit;
  });

  const groups: WorkspaceSearchGroup[] = KIND_ORDER.flatMap((kind) => {
    const hits = kind === 'material' ? materials : kind === 'wiki' ? wiki : cards;
    return hits.length > 0 ? [{ kind, hits }] : [];
  });

  const skipped = input.search.skipped;
  const unindexed = skipped.some(
    (entry) => entry.reason === 'not-indexed' || entry.reason === 'indexing',
  );

  return { query: input.query, groups, skipped, unindexed };
}

/** Cards never enter Ask-AI evidence. Derived wiki is dropped when the original is present. */
export function evidenceHitsForAskAi(
  hits: readonly WorkspaceSearchHit[],
): WorkspaceSearchHit[] {
  const ids = new Set(hits.map((hit) => hit.id));
  return hits.filter((hit) => {
    if (hit.kind === 'card') return false;
    if (hit.derivedFromId && ids.has(hit.derivedFromId)) return false;
    return Boolean(hit.citation) || Boolean(hit.relativePath);
  });
}

export function formatHitsForChat(hits: readonly WorkspaceSearchHit[], locale: 'zh-CN' | 'en'): string {
  const zh = locale === 'zh-CN';
  const lines = hits.map((hit) => {
    const body = hit.citation?.text?.trim() || hit.snippet;
    const quoted = body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    return `${quoted}\n\n— ${hit.sourceLabel} · ${hit.title}`;
  });
  const prompt = zh ? '基于这些结果：' : 'Based on these results:';
  return `${lines.join('\n\n')}\n\n${prompt}`;
}

function hitFromCitation(kind: 'material' | 'wiki', citation: KnowledgeCitation): WorkspaceSearchHit {
  const hit: WorkspaceSearchHit = {
    kind,
    id: `${kind}:${citation.baseId}:${citation.relativePath ?? citation.ref}`,
    title: citation.title,
    snippet: citation.text.trim().slice(0, 240),
    sourceLabel: citation.baseName,
    citation,
    baseId: citation.baseId,
    ...(citation.relativePath ? { relativePath: citation.relativePath } : {}),
  };
  if (kind === 'wiki' && citation.relativePath) {
    hit.wikiSlug = wikiSlugFromPath(citation.relativePath);
  }
  return hit;
}

function pathKey(baseId: string, relativePath: string): string {
  return `${baseId}::${relativePath}`;
}

function derivedMaterialId(
  citation: KnowledgeCitation | undefined,
  materialByPath: Map<string, string>,
): string | undefined {
  if (!citation) return undefined;
  for (const source of wikiSourcePaths(citation.metadata)) {
    const byExact = materialByPath.get(pathKey(source.baseId ?? '', source.relativePath));
    if (byExact) return byExact;
    for (const [key, id] of materialByPath) {
      if (key.endsWith(`::${source.relativePath}`)) return id;
    }
  }
  return undefined;
}

function wikiSourcePaths(
  metadata: Record<string, unknown> | undefined,
): Array<{ relativePath: string; baseId?: string }> {
  const raw = metadata?.sources;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ relativePath: string; baseId?: string }> = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ relativePath: item.trim() });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.relativePath !== 'string' || !record.relativePath.trim()) continue;
    out.push({
      relativePath: record.relativePath.trim(),
      ...(typeof record.baseId === 'string' ? { baseId: record.baseId } : {}),
    });
  }
  return out;
}
