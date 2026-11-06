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
  onNewNote?: (() => void) | undefined;
  sourceBasesCount?: number | undefined;
  onManageSources?: (() => void) | undefined;
};

export function WikiNavPane(props: WikiNavPaneProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  return (
    <header className="wiki-nav-pane wiki-top-shelf" aria-label={t('Wiki concepts', '维基概念目录')}>
      <div className="wiki-shelf-toolbar">
        <div className="wiki-shelf-left">
          <div className="nav-col-title">
            <span>{t('Wiki Catalog', '知识词条')}</span>
            <span className="wiki-count-pill">{props.concepts.length}</span>
          </div>

          <div className="ink-search wiki-shelf-search">
            <input
              type="text"
              value={props.searchQuery}
              onChange={(e) => props.onSearchQueryChange(e.currentTarget.value)}
              placeholder={t('Filter concepts or tags…', '快速过滤概念或标签…')}
              data-testid="wiki-search-input"
            />
          </div>

          {props.allTags.length > 0 ? (
            <div className="tag-filter-row wiki-shelf-tags">
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
        </div>

        <div className="wiki-shelf-right">
          <div className="nav-source-footer" data-testid="wiki-nav-source-footer">
            <span className="nav-source-count">
              {t('Sources: ', '信源：')}{props.sourceBasesCount ?? 0}
            </span>
            <button
              type="button"
              className="nav-source-manage-btn"
              onClick={props.onManageSources}
              data-testid="wiki-manage-sources-btn"
            >
              {t('Manage →', '管理 →')}
            </button>
          </div>

          <div className="nav-header-actions">
            {props.onNewNote ? (
              <button
                type="button"
                className="btn sm"
                onClick={props.onNewNote}
                data-testid="wiki-new-note-btn"
              >
                {t('+ Note', '+ 笔记')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn sm pri"
              onClick={props.onDistillConcept}
              title={t('Pick a source to distil from', '选择要提炼的信源')}
              data-testid="wiki-distill-concept-btn"
            >
              {t('✦ Distill', '✦ 提炼')}
            </button>
          </div>
        </div>
      </div>

      <div className="concept-scroll-list wiki-shelf-scroll" role="tablist">
        {props.concepts.map((concept) => {
          const isSelected = concept.slug === props.selectedSlug;
          return (
            <button
              key={concept.slug}
              type="button"
              id={`wiki-card-${concept.slug.replace(/[^a-z0-9]/gi, '')}`}
              className={`concept-row wiki-concept-card wiki-shelf-card${isSelected ? ' active' : ''}`}
              onClick={() => props.onSelectSlug(concept.slug)}
              data-testid={`wiki-concept-item-${concept.slug}`}
              role="tab"
              aria-selected={isSelected}
            >
              <div className="row-main">
                <span className="row-title wiki-concept-title">{concept.title}</span>
                <span className={`wiki-stamp ${isSelected ? 'pine' : ''}`} style={{ fontSize: '9.5px' }}>
                  {concept.tags[0] ? `#${concept.tags[0]}` : t('Concept', '概念')}
                </span>
              </div>
              <div className="row-sub">
                <span>{concept.updatedAt.slice(0, 10)}</span>
              </div>
            </button>
          );
        })}
        {props.concepts.length === 0 ? (
          <div className="wiki-nav-empty">
            {t('No concepts match the filter', '没有匹配的词条')}
          </div>
        ) : null}
      </div>
    </header>
  );
}
