import { useMemo, useState, type ReactElement } from 'react';
import { Notice, Spinner } from '@piwin/ui-kit';
import type { WorkspaceSearchHit, WorkspaceSearchKind, WorkspaceSearchPage } from './knowledge-workspace-search.js';

export type KnowledgeWorkspaceSearchPanelProps = {
  locale: 'zh-CN' | 'en';
  query: string;
  loading: boolean;
  error: string | null;
  page: WorkspaceSearchPage | null;
  onOpenHit: (hit: WorkspaceSearchHit) => void;
  onAskAi: (hits: WorkspaceSearchHit[]) => void;
  onOpenIndex?: (() => void) | undefined;
};

const KIND_LABEL: Record<WorkspaceSearchKind, { en: string; zh: string }> = {
  material: { en: 'Materials', zh: '资料' },
  wiki: { en: 'Wiki', zh: '知识页' },
  card: { en: 'Cards', zh: '闪卡' },
};

export function KnowledgeWorkspaceSearchPanel(props: KnowledgeWorkspaceSearchPanelProps): ReactElement {
  const t = (en: string, cn: string) => (props.locale === 'zh-CN' ? cn : en);
  const [kindFilter, setKindFilter] = useState<WorkspaceSearchKind | 'all'>('all');
  const groups = useMemo(() => {
    if (!props.page) return [];
    if (kindFilter === 'all') return props.page.groups;
    return props.page.groups.filter((group) => group.kind === kindFilter);
  }, [kindFilter, props.page]);

  return (
    <div className="kw-search" data-testid="knowledge-workspace-search">
      <header className="kw-page-head">
        <h1>{t('Search', '搜索')}</h1>
        <p>
          {t(
            `Results for “${props.query}”. Cards are listed here; they are not sent as Ask-AI evidence.`,
            `“${props.query}” 的结果。闪卡会出现在列表里，但不会当作问 AI 的证据。`,
          )}
        </p>
      </header>

      <div className="vault-chips" role="group" aria-label={t('Type', '类型')}>
        {(['all', 'material', 'wiki', 'card'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`vault-chip${kindFilter === kind ? ' is-on' : ''}`}
            data-testid={`knowledge-search-filter-${kind}`}
            aria-pressed={kindFilter === kind}
            onClick={() => setKindFilter(kind)}
          >
            {kind === 'all' ? t('All', '全部') : t(KIND_LABEL[kind].en, KIND_LABEL[kind].zh)}
          </button>
        ))}
      </div>

      {props.page?.unindexed ? (
        <Notice tone="warning" testId="knowledge-search-unindexed">
          {t(
            'Some libraries are not fully searchable yet. Title matches are not full-text hits.',
            '部分内容尚未可搜。目录标题匹配不是全文搜索。',
          )}
          {props.onOpenIndex ? (
            <button type="button" className="kw-link" onClick={props.onOpenIndex}>
              {t('Index & Settings', '索引与设置')}
            </button>
          ) : null}
        </Notice>
      ) : null}

      {props.error ? (
        <Notice tone="error" testId="knowledge-search-error">
          {props.error}
        </Notice>
      ) : null}

      {props.loading ? <Spinner label={t('Searching…', '正在搜索…')} /> : null}

      {!props.loading && props.page && groups.every((group) => group.hits.length === 0) ? (
        <p className="kw-muted">{t('No matches.', '没有匹配结果。')}</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.kind} className="kw-card" data-testid={`knowledge-search-group-${group.kind}`}>
          <div className="kw-card-head">
            <h2>{t(KIND_LABEL[group.kind].en, KIND_LABEL[group.kind].zh)}</h2>
          </div>
          <ul className="kw-list">
            {group.hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="kw-row"
                  data-testid={`knowledge-search-hit-${hit.id}`}
                  onClick={() => props.onOpenHit(hit)}
                >
                  <span className="kw-row-title">{hit.title}</span>
                  <span className="kw-row-meta">
                    {hit.titleMatchOnly
                      ? t('Title match · not full-text', '标题匹配 · 非全文')
                      : hit.derivedFromId
                        ? t('Derived from source', '派生于原文')
                        : hit.sourceLabel}
                  </span>
                  <span className="kw-muted">{hit.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {props.page && props.page.groups.some((group) => group.hits.length > 0) ? (
        <button
          type="button"
          className="kw-btn is-primary"
          data-testid="knowledge-search-ask-ai"
          onClick={() => props.onAskAi(props.page?.groups.flatMap((group) => group.hits) ?? [])}
        >
          {t('Ask AI from these results', '基于这些结果问 AI')}
        </button>
      ) : null}
    </div>
  );
}
