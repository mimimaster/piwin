/**
 * Materials library: the registered sources as browsable groups.
 *
 * A source is a folder on the Host, so it is the first grouping level. The
 * state chip reports what the Host actually knows (indexed, indexable, gone);
 * browsing never waits for an index, and the section never claims a format is
 * readable when no parser backs it.
 */
import type { ReactElement } from 'react';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import { knowledgeBaseStateLabel } from './knowledge-source-state.js';
import { Spinner } from '@piwin/ui-kit';
import { IconFolderPlus } from '../../tool-cards/shell-icons.js';

export type KnowledgeMaterialsSectionProps = {
  locale: 'zh-CN' | 'en';
  sources: readonly KnowledgeBaseSummary[];
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onAddFolder?: (() => void) | undefined;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
  generating?: boolean | undefined;
};

export function KnowledgeMaterialsSection(props: KnowledgeMaterialsSectionProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  const query = props.query.trim().toLowerCase();
  const visible = query
    ? props.sources.filter((base) =>
        `${base.name} ${base.folderPath ?? ''}`.toLowerCase().includes(query),
      )
    : props.sources;

  return (
    <div className="kw-materials" data-testid="knowledge-materials">
      <header className="kw-page-head">
        <h1>{t('Materials', '资料库')}</h1>
        <p>
          {t(
            'Folders registered on this Host. Reading never waits for indexing.',
            '这台 Host 上登记的文件夹。阅读不必等索引完成。',
          )}
        </p>
        <div className="kw-head-actions">
          <input
            type="search"
            className="kw-filter"
            value={props.query}
            placeholder={t('Filter by name or path', '按名称或路径筛选')}
            aria-label={t('Filter materials', '筛选资料')}
            onChange={(event) => props.onQueryChange(event.target.value)}
            data-testid="knowledge-materials-filter"
          />
          {props.onAddFolder ? (
            <button
              type="button"
              className="kw-btn is-primary"
              onClick={props.onAddFolder}
              data-testid="knowledge-materials-add-folder"
            >
              <IconFolderPlus width={15} height={15} aria-hidden="true" />
              <span>{t('Add a folder', '添加文件夹')}</span>
            </button>
          ) : null}
        </div>
      </header>

      {props.loading && visible.length === 0 ? (
        <Spinner label={t('Loading materials…', '正在加载资料…')} />
      ) : visible.length === 0 ? (
        <section className="kw-empty" data-testid="knowledge-materials-empty">
          <h2>
            {query ? t('Nothing matches this filter', '没有匹配的资料') : t('No materials yet', '还没有资料')}
          </h2>
          <p>
            {query
              ? t('Clear the filter to see every source.', '清空筛选条件即可看到全部来源。')
              : t(
                  'Add a folder of Markdown, text or code. You can read it immediately; search indexes it later.',
                  '添加一个装着 Markdown、纯文本或代码的文件夹。马上就能读，搜索索引之后再建立。',
                )}
          </p>
        </section>
      ) : (
        <ul className="kw-source-list">
          {visible.map((base) => {
            const state = knowledgeBaseStateLabel(base, t);
            return (
              <li key={base.id} className="kw-source" data-testid={`knowledge-material-${base.id}`}>
                <div className="kw-source-head">
                  <span className="kw-source-name">{base.name}</span>
                  <span className={`kw-chip is-${state.tone}`} data-testid={`knowledge-material-state-${base.id}`}>
                    {state.label}
                  </span>
                </div>
                <div className="kw-source-path" title={base.folderPath ?? ''}>
                  {base.folderPath ?? '~/.piwin/notes'}
                </div>
                <div className="kw-source-meta">
                  {t(
                    `${base.documentCount ?? 0} documents${base.degraded ? ' · full-text mode' : ''}`,
                    `${base.documentCount ?? 0} 份文档${base.degraded ? ' · 全文模式' : ''}`,
                  )}
                </div>
                {base.folderPath && props.onProduceFlashcards && base.state !== 'missing' ? (
                  <div className="kw-source-actions">
                    <button
                      type="button"
                      className="kw-btn kw-btn-sm is-primary"
                      disabled={props.generating === true}
                      onClick={() => props.onProduceFlashcards?.(base.folderPath ?? '')}
                      data-testid={`knowledge-material-produce-${base.id}`}
                    >
                      {t('Distil & make cards', '提炼词条并产卡')}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
