import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Spinner } from '@piwin/ui-kit';
import type {
  HostCommand,
  HostResponse,
  KnowledgeBaseSummary,
  WikiConceptDetail,
  WikiOverviewResult,
} from '@piwin/contracts';
import { WikiArticlePane } from './WikiArticlePane.js';
import { WikiCopilotPane } from './WikiCopilotPane.js';
import { WikiNavPane } from './WikiNavPane.js';
import { WikiSourceDrawer } from './WikiSourceDrawer.js';
import { isWorkbenchHostTeardownError } from '../workbench-host-teardown.js';
import { STARTER_CONCEPTS, STARTER_CONCEPT_DETAILS } from './wiki-starter-concepts.js';
import { formatWikilinksForMarkdown } from './format-wikilinks.js';
export { formatWikilinksForMarkdown };

export function wikiUnavailableCopy(
  error: string,
  locale: 'zh-CN' | 'en',
): { title: string; description: string } {
  const zh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  if (isWorkbenchHostTeardownError(error)) {
    return {
      title: t('Knowledge base unavailable', '知识库不可用'),
      description: t(
        'The Host connection is still opening or was interrupted. Retry when the Host is ready, or review sources already on this page.',
        '与 Host 的连接尚未建立或已中断。Host 就绪后可重试，也可以先查看已登记的信源。',
      ),
    };
  }
  if (error.includes('Unhandled command')) {
    return {
      title: t('Knowledge wiki unavailable', '知识维基暂不可用'),
      description: t(
        'The connected Host service does not support Wiki synthesis yet, or needs to be restarted.',
        '当前连接的 Host 尚未支持 Wiki 沉淀服务，或服务正在重启。您可以稍后重试。',
      ),
    };
  }
  return {
    title: t('Knowledge wiki unavailable', '知识维基暂不可用'),
    description: error,
  };
}

export type KnowledgeWikiViewProps = {
  locale: 'zh-CN' | 'en';
  request: (command: HostCommand) => Promise<HostResponse>;
  onUseInChat: (baseId: string) => void;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
  onGoToDocuments?: (() => void) | undefined;
  onGoToFlashcards?: (() => void) | undefined;
  wikiFolderPath?: string | undefined;
  testId?: string | undefined;
  sourceBases?: readonly KnowledgeBaseSummary[] | undefined;
  sourceDrawerOpen?: boolean | undefined;
  onOpenSourceDrawer?: (() => void) | undefined;
  onCloseSourceDrawer?: (() => void) | undefined;
  onAddFolder?: (() => void) | undefined;
  onOpenIngest?: ((folderPath: string) => void) | undefined;
};

export function KnowledgeWikiView(props: KnowledgeWikiViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  const [overview, setOverview] = useState<WikiOverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeConcept, setActiveConcept] = useState<WikiConceptDetail | null>(null);
  const [loadingConcept, setLoadingConcept] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [localDrawerOpen, setLocalDrawerOpen] = useState(false);

  const drawerOpen = props.sourceDrawerOpen ?? localDrawerOpen;
  const handleOpenDrawer = props.onOpenSourceDrawer ?? (() => setLocalDrawerOpen(true));
  const handleCloseDrawer = props.onCloseSourceDrawer ?? (() => setLocalDrawerOpen(false));

  const isStarterMode = overview !== null && overview.concepts.length === 0;

  const rawConcepts = useMemo(() => {
    if (overview && overview.concepts.length > 0) {
      return overview.concepts;
    }
    if (overview && overview.concepts.length === 0) {
      return STARTER_CONCEPTS;
    }
    return [];
  }, [overview]);

  const requestRef = useRef(props.request);
  requestRef.current = props.request;

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await requestRef.current({ type: 'knowledge/wiki/overview' });
      if (!res.success) {
        setError(res.error);
      } else if (res.data) {
        const data = res.data as WikiOverviewResult;
        setOverview(data);
        if (data.concepts.length > 0) {
          setSelectedSlug(data.concepts[0]?.slug ?? null);
        } else {
          setSelectedSlug('llm-wiki');
        }
      } else {
        setError('Failed to load wiki overview');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (overview) {
      if (overview.concepts.length === 0) {
        if (!selectedSlug) setSelectedSlug('llm-wiki');
      } else {
        if (!selectedSlug || !overview.concepts.some((c) => c.slug === selectedSlug)) {
          setSelectedSlug(overview.concepts[0]?.slug ?? null);
        }
      }
    }
  }, [overview, selectedSlug]);

  // Load selected concept detail
  useEffect(() => {
    if (!selectedSlug) {
      setActiveConcept(null);
      return;
    }
    if (isStarterMode) {
      setActiveConcept(STARTER_CONCEPT_DETAILS[selectedSlug] ?? STARTER_CONCEPT_DETAILS['llm-wiki'] ?? null);
      return;
    }
    let cancelled = false;
    setLoadingConcept(true);
    requestRef
      .current({ type: 'knowledge/wiki/concept', slug: selectedSlug })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          const data = res.data as { concept: WikiConceptDetail };
          setActiveConcept(data.concept);
        } else {
          setActiveConcept(null);
        }
      })
      .catch(() => {
        if (!cancelled) setActiveConcept(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingConcept(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isStarterMode, selectedSlug]);

  const filteredConcepts = useMemo(() => {
    let list = rawConcepts;
    if (selectedTag) {
      list = list.filter((c) => c.tags.includes(selectedTag));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.summary?.toLowerCase().includes(q) ||
          c.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [rawConcepts, selectedTag, searchQuery]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of rawConcepts) {
      for (const t of c.tags) set.add(t);
    }
    return [...set].sort();
  }, [rawConcepts]);

  const sourceDrawer = drawerOpen ? (
    <WikiSourceDrawer
      locale={props.locale}
      sourceBases={props.sourceBases ?? []}
      onClose={handleCloseDrawer}
      onAddFolder={props.onAddFolder}
      onOpenIngest={props.onOpenIngest}
      onProduceFlashcards={props.onProduceFlashcards}
    />
  ) : null;

  if (loading && !overview) {
    return (
      <div className="wiki-state" data-testid={props.testId ?? 'knowledge-wiki-workspace'}>
        <div className="vault-empty" data-testid="wiki-loading">
          <Spinner label={t('Loading knowledge wiki…', '正在加载维基知识库…')} />
        </div>
        {sourceDrawer}
      </div>
    );
  }

  if (error) {
    const unavailable = wikiUnavailableCopy(error, props.locale);
    return (
      <div className="wiki-state" data-testid="wiki-error-view">
        <div className="vault-empty">
          <h2>{unavailable.title}</h2>
          <p>{unavailable.description}</p>
          <div className="vault-empty-actions">
            <button
              type="button"
              className="btn sm sec"
              onClick={() => void fetchOverview()}
              data-testid="wiki-error-retry"
            >
              {t('Retry', '重试')}
            </button>
            {handleOpenDrawer ? (
              <button
                type="button"
                className="btn sm pri"
                onClick={handleOpenDrawer}
                data-testid="wiki-goto-documents"
              >
                {t('View Sources', '查看信源证据')}
              </button>
            ) : null}
          </div>
        </div>
        {sourceDrawer}
      </div>
    );
  }

  return (
    <div className="wiki-layout" data-testid={props.testId ?? 'knowledge-wiki-workspace'}>
      {/* Pane 1: Concept Catalog */}
      <WikiNavPane
        locale={props.locale}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        allTags={allTags}
        selectedTag={selectedTag}
        onSelectTag={setSelectedTag}
        concepts={filteredConcepts}
        selectedSlug={selectedSlug}
        onSelectSlug={(slug) => setSelectedSlug(slug)}
        onDistillConcept={() => handleOpenDrawer()}
        onOpenDraft={() => props.onUseInChat('wiki')}
        sourceBasesCount={props.sourceBases?.length ?? 0}
        onManageSources={handleOpenDrawer}
      />

      {/* Pane 2: Concept Reading Canvas */}
      <WikiArticlePane
        locale={props.locale}
        concept={activeConcept}
        concepts={rawConcepts}
        loading={loadingConcept}
        onSelectSlug={(slug) => setSelectedSlug(slug)}
        onUseInChat={props.onUseInChat}
        onOpenSources={handleOpenDrawer}
        onProduceFlashcards={props.onProduceFlashcards}
        wikiFolderPath={props.wikiFolderPath}
      />

      {/* Pane 3: Concept Copilot Pane */}
      <WikiCopilotPane
        concept={activeConcept}
        concepts={rawConcepts}
        locale={props.locale}
        onSelectSlug={(slug) => setSelectedSlug(slug)}
        onUseInChat={props.onUseInChat}
        onGoToFlashcards={props.onGoToFlashcards}
      />

      {sourceDrawer}
    </div>
  );
}
