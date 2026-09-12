import type { ReactElement } from 'react';
import type { WikiConceptItem } from '@piwin/contracts';

export type WikiNavPaneProps = {
  locale: 'zh-CN' | 'en';
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  allTags: string[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  concepts: WikiConceptItem[];
  selectedSlug: string | null;
  onSelectSlug: (slug: string) => void;
  onDistillConcept: () => void;
  onOpenDraft: () => void;
  sourceBasesCount?: number | undefined;
  onManageSources?: (() => void) | undefined;
};

export function WikiNavPane(props: WikiNavPaneProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  return (
    <aside className="wiki-nav-pane" aria-label={t('Wiki concepts', '维基概念目录')}>
      <div className="wiki-nav-header">
        <div className="nav-col-title">
          <span>{t('Wiki Catalog', '概念目录')}</span>
          <span className="wiki-stamp" style={{ fontSize: '9.5px' }}>
            {props.concepts.length} {t('concepts', '词条')}
          </span>
        </div>
        <button
          type="button"
          className="btn sm pri"
          onClick={props.onDistillConcept}
          title={t('Pick a source to distil from', '选择要提炼的信源')}
          data-testid="wiki-distill-concept-btn"
        >
          {t('+ Distill', '+ 提炼词条')}
        </button>
      </div>

      <div className="search-box-wrap">
        <div className="ink-search">
          <input
            type="text"
            value={props.searchQuery}
            onChange={(e) => props.onSearchQueryChange(e.currentTarget.value)}
            placeholder={t('Index concepts…', '快速索引概念…')}
            data-testid="wiki-search-input"
          />
          <span className="kbd-chip">⌘K</span>
        </div>
      </div>

      {props.allTags.length > 0 ? (
        <div className="tag-filter-row">
          <button
            type="button"
            className={`tag-pill${props.selectedTag === null ? ' active' : ''}`}
            onClick={() => props.onSelectTag(null)}
          >
            {t('All', '全部')}
          </button>
          {props.allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-pill wiki-tag-filter-btn${props.selectedTag === tag ? ' active' : ''}`}
              onClick={() => props.onSelectTag(props.selectedTag === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      ) : null}

      <div className="concept-scroll-list">
        <div className="list-group-title">{t('Core Concepts', '已沉淀百科')}</div>
        {props.concepts.map((concept) => {
          const isSelected = concept.slug === props.selectedSlug;
          return (
            <div
              key={concept.slug}
              id={`wiki-card-${concept.slug.replace(/[^a-z0-9]/gi, '')}`}
              className={`concept-row wiki-concept-card${isSelected ? ' active' : ''}`}
              onClick={() => props.onSelectSlug(concept.slug)}
              data-testid={`wiki-concept-item-${concept.slug}`}
            >
              <div className="row-main">
                <span className="row-title wiki-concept-title">{concept.title}</span>
                <span className={`wiki-stamp ${isSelected ? 'pine' : ''}`} style={{ fontSize: '9px' }}>
                  {isSelected ? t('Active', '当前') : t('Finalized', '定稿')}
                </span>
              </div>
              <div className="row-sub">
                <span>{concept.tags[0] ? `#${concept.tags[0]}` : t('Core', '核心')}</span>
                <span>·</span>
                <span>{concept.updatedAt.slice(0, 10)}</span>
              </div>
            </div>
          );
        })}
        {props.concepts.length === 0 ? (
          <div style={{ padding: 'var(--s-3)', color: 'var(--text-4)', fontSize: '11px' }}>
            {t('No concepts match the filter', '没有匹配的词条')}
          </div>
        ) : null}

        <div className="list-group-title" style={{ marginTop: '6px' }}>{t('Drafts', '待增量编纂')}</div>
        <div
          className="concept-row wiki-concept-card"
          style={{ opacity: 0.85 }}
          onClick={props.onOpenDraft}
        >
          <div className="row-main">
            <span className="row-title wiki-concept-title">{t('Engineering Limits Spec', '单源文件行数限制规约')}</span>
            <span className="wiki-stamp ochre" style={{ fontSize: '9px' }}>{t('Draft', '草稿')}</span>
          </div>
          <div className="row-sub">
            <span>AGENTS.md</span>
            <span>·</span>
            <span>{t('1 ref', '1 处关联')}</span>
          </div>
        </div>
      </div>

      <div className="nav-source-footer" data-testid="wiki-nav-source-footer">
        <span style={{ color: 'var(--t3, var(--text-3))' }}>
          {t('Sources: ', '支撑信源：')}{props.sourceBasesCount ?? 0} {t('bases', '项')}
        </span>
        <button
          type="button"
          className="btn sm ghost"
          style={{ padding: '0 4px' }}
          onClick={props.onManageSources}
          data-testid="wiki-manage-sources-btn"
        >
          {t('Manage', '管理')}
        </button>
      </div>
    </aside>
  );
}
