/**
 * Real summary numbers for the knowledge overview.
 *
 * Every block comes from an existing Host read; a block that the Host cannot
 * answer stays `null` and reports its own error instead of hiding behind a
 * placeholder number. Nothing here is derived from a client cache.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  FlashcardStudyCatalogPage,
  HostCommand,
  HostResponse,
  KnowledgeBaseSummary,
  KnowledgeCollection,
  WikiConceptItem,
} from '@piwin/contracts';

export type KnowledgeOverviewMaterials = {
  /** Registered folder sources (the material library's groups). */
  sources: number;
  /** Deduplicated logical documents across those sources. */
  documents: number;
  notes: number;
  /** Sources that need attention (unindexed, missing, partially failed). */
  needsAttention: number;
};

export type KnowledgeOverviewWiki = {
  concepts: number;
  recent: WikiConceptItem[];
};

export type KnowledgeOverviewStudy = {
  dueCount: number;
  newCount: number;
  /** Rounds the Host still holds as active/paused; the overview offers "continue". */
  unfinishedCount: number;
};

export type KnowledgeOverviewData = {
  materials: KnowledgeOverviewMaterials | null;
  wiki: KnowledgeOverviewWiki | null;
  study: KnowledgeOverviewStudy | null;
  /** `null` means the Host does not expose collections yet. */
  collections: KnowledgeCollection[] | null;
};

export type KnowledgeOverviewState = {
  data: KnowledgeOverviewData;
  loading: boolean;
  /** One message per failed block; the other blocks still render. */
  errors: string[];
  reload: () => void;
};

const RECENT_CONCEPT_LIMIT = 4;

const EMPTY: KnowledgeOverviewData = { materials: null, wiki: null, study: null, collections: null };

function summariseMaterials(bases: readonly KnowledgeBaseSummary[]): KnowledgeOverviewMaterials {
  let sources = 0;
  let documents = 0;
  let notes = 0;
  let needsAttention = 0;
  for (const base of bases) {
    if (base.kind === 'notes') {
      notes = base.documentCount ?? 0;
      continue;
    }
    if (base.kind !== 'folder') continue;
    sources += 1;
    documents += base.documentCount ?? 0;
    if (base.state !== 'ready' && base.state !== 'empty') needsAttention += 1;
  }
  return { sources, documents, notes, needsAttention };
}

function recentConcepts(concepts: readonly WikiConceptItem[]): WikiConceptItem[] {
  return [...concepts]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENT_CONCEPT_LIMIT);
}

export function useKnowledgeOverview(args: {
  request: (command: HostCommand) => Promise<HostResponse>;
  enabled: boolean;
  /** Bumped after a produce/distill run so the numbers catch up. */
  refreshKey?: unknown;
}): KnowledgeOverviewState {
  const { enabled, request, refreshKey } = args;
  const [data, setData] = useState<KnowledgeOverviewData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);

    const failures: string[] = [];

    async function read(command: HostCommand): Promise<unknown> {
      try {
        const response = await request(command);
        if (!response.success) {
          failures.push(response.error);
          return null;
        }
        return response.data;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        return null;
      }
    }

    /** For optional reads: an old Host rejecting them is not a broken overview. */
    async function readOptional(command: HostCommand): Promise<unknown> {
      try {
        const response = await request(command);
        return response.success ? response.data : null;
      } catch {
        return null;
      }
    }

    void (async () => {
      const [basesData, wikiData, catalogData, collectionsData] = await Promise.all([
        read({ type: 'knowledge/bases/list' }),
        read({ type: 'knowledge/wiki/overview' }),
        read({ type: 'flashcards/study/catalog', limit: 1, scopeFilter: { kind: 'all' } }),
        // An old Host rejects this command; that is "no collections", not a
        // broken overview, so it never competes for the error budget.
        readOptional({ type: 'knowledge/collections/list' }),
      ]);
      if (cancelled) return;

      const bases = (basesData as { bases?: KnowledgeBaseSummary[] } | null)?.bases;
      const wiki = wikiData as { concepts?: WikiConceptItem[]; totalConcepts?: number } | null;
      const catalog = catalogData as Partial<FlashcardStudyCatalogPage> | null;
      const collections = (collectionsData as { collections?: KnowledgeCollection[] } | null)
        ?.collections;

      setData({
        materials: bases ? summariseMaterials(bases) : null,
        wiki: wiki
          ? {
              concepts: wiki.totalConcepts ?? wiki.concepts?.length ?? 0,
              recent: recentConcepts(wiki.concepts ?? []),
            }
          : null,
        study: catalog
          ? {
              dueCount: catalog.dueCount ?? 0,
              newCount: catalog.newCount ?? 0,
              unfinishedCount: catalog.unfinishedRounds?.length ?? 0,
            }
          : null,
        collections: Array.isArray(collections) ? collections : null,
      });
      setErrors(failures);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, reloadToken, request, refreshKey]);

  return { data, loading, errors, reload };
}
