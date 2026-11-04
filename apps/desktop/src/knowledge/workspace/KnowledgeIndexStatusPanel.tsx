import type { ReactElement } from 'react';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import { knowledgeBaseStateLabel } from './knowledge-source-state.js';
import { indexStatusRows } from './knowledge-index-status.js';

export type KnowledgeIndexStatusPanelProps = {
  locale: 'zh-CN' | 'en';
  bases: readonly KnowledgeBaseSummary[];
  busyBaseId: string | null;
  error: string | null;
  onRetry: (folderPath: string, baseId: string) => void;
  onCancel: (folderPath: string, baseId: string) => void;
  onOpenSettings?: (() => void) | undefined;
  onClose: () => void;
};

export function KnowledgeIndexStatusPanel(props: KnowledgeIndexStatusPanelProps): ReactElement {
  const t = (en: string, cn: string) => (props.locale === 'zh-CN' ? cn : en);
  const rows = indexStatusRows(props.bases);

  return (
    <div className="kw-index-status" data-testid="knowledge-index-status">
      <header className="kw-page-head">
        <h1>{t('Index & Settings', '索引与设置')}</h1>
        <p>
          {t(
            'Rebuild or cancel folder indexes here. Embedding and parser settings stay on the existing page.',
            '在这里重建或取消文件夹索引。向量与解析设置仍走现有设置页。',
          )}
        </p>
      </header>
      {props.error ? (
        <p className="kw-assist-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <ul className="kw-list">
        {rows.map((row) => {
          const label = knowledgeBaseStateLabel(
            {
              id: row.baseId,
              kind: 'folder',
              name: row.name,
              state: row.state,
              degraded: row.degraded,
              documentCount: row.documentCount,
            },
            t,
          );
          return (
            <li key={row.baseId} className="kw-row" data-testid={`knowledge-index-row-${row.baseId}`}>
              <span className="kw-row-title">{row.name}</span>
              <span className="kw-row-meta">
                {label.label}
                {row.failedDocumentCount > 0
                  ? t(` · ${row.failedDocumentCount} failed`, ` · ${row.failedDocumentCount} 项失败`)
                  : ''}
              </span>
              {row.canRetry && row.folderPath ? (
                <button
                  type="button"
                  className="kw-btn"
                  disabled={props.busyBaseId === row.baseId}
                  data-testid={`knowledge-index-retry-${row.baseId}`}
                  onClick={() => props.onRetry(row.folderPath ?? '', row.baseId)}
                >
                  {t('Retry', '重试')}
                </button>
              ) : null}
              {row.canCancel && row.folderPath ? (
                <button
                  type="button"
                  className="kw-btn"
                  disabled={props.busyBaseId === row.baseId}
                  data-testid={`knowledge-index-cancel-${row.baseId}`}
                  onClick={() => props.onCancel(row.folderPath ?? '', row.baseId)}
                >
                  {t('Cancel', '取消')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="article-actions">
        {props.onOpenSettings ? (
          <button
            type="button"
            className="btn sm pri"
            data-testid="knowledge-index-open-settings"
            onClick={props.onOpenSettings}
          >
            {t('Embedding settings', '向量设置')}
          </button>
        ) : null}
        <button type="button" className="btn sm" data-testid="knowledge-index-close" onClick={props.onClose}>
          {t('Close', '关闭')}
        </button>
      </div>
    </div>
  );
}
