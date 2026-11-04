import type { ReactElement } from 'react';
import { EmptyState, IconDocument, Spinner } from '@piwin/ui-kit';
import type { KnowledgeBaseSummary, KnowledgeDocumentEntry } from '@piwin/contracts';
import { knowledgeBaseStateLabel } from './knowledge-source-state.js';

export type KnowledgeDocumentsSectionProps = {
  locale: 'zh-CN' | 'en';
  sources: readonly KnowledgeBaseSummary[];
  selectedBaseId: string | null;
  onSelectBase: (baseId: string) => void;
  items: readonly KnowledgeDocumentEntry[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpenDocument: (entry: KnowledgeDocumentEntry) => void;
  onAddFolder?: (() => void) | undefined;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
  generating: boolean;
};

function formatDate(iso: string | undefined, locale: 'zh-CN' | 'en'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The library lists documents, not index states. A source that was just
 * registered shows its files immediately; "not indexed" only removes the
 * search capability badge, never the row.
 */
export function KnowledgeDocumentsSection(props: KnowledgeDocumentsSectionProps): ReactElement {
  const t = (en: string, cn: string) => (props.locale === 'zh-CN' ? cn : en);
  const selected = props.sources.find((source) => source.id === props.selectedBaseId) ?? null;

  return (
    <div className="kw-section kw-documents" data-testid="knowledge-documents">
      <div className="kw-section-head">
        <div>
          <h2 className="kw-title">{t('Materials', '资料库')}</h2>
          <p className="kw-sub">
            {t(
              'Browse everything you registered. Reading does not wait for the search index.',
              '浏览你登记的全部资料。能不能读，不等于有没有建索引。',
            )}
          </p>
        </div>
        {props.onAddFolder ? (
          <button
            type="button"
            className="kw-btn"
            onClick={props.onAddFolder}
            data-testid="knowledge-documents-add-folder"
          >
            {t('Add folder', '添加资料')}
          </button>
        ) : null}
      </div>

      <div className="kw-source-chips" role="tablist" aria-label={t('Sources', '来源')}>
        {props.sources.map((source) => {
          const state = knowledgeBaseStateLabel(source, t);
          const active = source.id === props.selectedBaseId;
          return (
            <button
              key={source.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`kw-source-chip${active ? ' is-active' : ''}`}
              onClick={() => props.onSelectBase(source.id)}
              data-testid={`knowledge-source-chip-${source.id}`}
            >
              <span className="kw-source-chip-name">{source.name}</span>
              <span className="kw-source-chip-meta">
                {source.documentCount > 0 ? source.documentCount : state.label}
              </span>
            </button>
          );
        })}
      </div>

      {props.sources.length === 0 ? (
        <EmptyState
          title={t('No materials yet', '还没有资料')}
          description={t(
            'Register a folder of Markdown, text or code files. It is readable immediately; the search index can wait.',
            '登记一个装着 Markdown、纯文本或代码的文件夹。马上就能读，搜索索引之后再建立。',
          )}
          size="spacious"
          testId="knowledge-documents-empty"
        />
      ) : props.error ? (
        <p className="kw-error" data-testid="knowledge-documents-error">
          {props.error}
        </p>
      ) : props.loading ? (
        <div className="kw-loading" data-testid="knowledge-documents-loading">
          <Spinner label={t('Reading folder…', '正在读取文件夹…')} />
        </div>
      ) : props.items.length === 0 ? (
        <EmptyState
          title={t('Nothing matches this source', '这个来源下没有匹配的文件')}
          description={t(
            'Clear the filter, or pick another source on the left.',
            '清空筛选，或换一个来源。',
          )}
          size="compact"
          testId="knowledge-documents-no-match"
        />
      ) : (
        <>
          <ul className="kw-doc-list" data-testid="knowledge-document-list">
            {props.items.map((entry) => (
              <li key={entry.relativePath}>
                <button
                  type="button"
                  className="kw-doc-row"
                  onClick={() => props.onOpenDocument(entry)}
                  data-testid={`knowledge-document-${entry.relativePath}`}
                  title={entry.relativePath}
                >
                  <span className="kw-doc-icon" aria-hidden="true">
                    <IconDocument width={16} height={16} />
                  </span>
                  <span className="kw-doc-main">
                    <span className="kw-doc-title">{entry.title}</span>
                    <span className="kw-doc-path">{entry.relativePath}</span>
                  </span>
                  <span className="kw-doc-meta">
                    {entry.readability === 'unsupported' ? (
                      <span className="kw-chip is-warn" title={entry.unsupportedReason}>
                        {t('needs parser', '需要解析')}
                      </span>
                    ) : entry.indexed ? (
                      <span className="kw-chip is-ok">
                        {t(`${entry.chunkCount} slices`, `${entry.chunkCount} 片`)}
                      </span>
                    ) : (
                      <span className="kw-chip is-muted">{t('readable', '可读')}</span>
                    )}
                    <span className="kw-doc-size">{formatSize(entry.sizeBytes)}</span>
                    <span className="kw-doc-date">{formatDate(entry.updatedAt, props.locale)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="kw-doc-footer">
            <span className="kw-doc-count" data-testid="knowledge-documents-count">
              {t(
                `Showing ${props.items.length} of ${props.total}`,
                `已显示 ${props.items.length} / ${props.total}`,
              )}
            </span>
            {props.hasMore ? (
              <button
                type="button"
                className="kw-btn kw-btn-sm"
                disabled={props.loadingMore}
                onClick={props.onLoadMore}
                data-testid="knowledge-documents-load-more"
              >
                {props.loadingMore ? t('Loading…', '加载中…') : t('Load more', '加载更多')}
              </button>
            ) : null}
            {selected?.folderPath && props.onProduceFlashcards && selected.state !== 'missing' ? (
              <button
                type="button"
                className="kw-btn kw-btn-sm is-primary"
                disabled={props.generating}
                onClick={() => props.onProduceFlashcards?.(selected.folderPath ?? '')}
                data-testid="knowledge-documents-produce"
              >
                {t('Distil & make cards', '提炼词条并产卡')}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
