import { useState, type ReactElement } from 'react';
import { Button, Notice, TextInput } from '@piwin/ui-kit';
import type { KnowledgeBaseSummary, KnowledgeCitation, KnowledgeSearchResult } from '@piwin/contracts';
import type { KnowledgeActionResult } from './use-knowledge-bases.js';
import { knowledgeCitationLocation } from './knowledge-citations.js';
import type { KnowledgeLocale } from './knowledge-base-copy.js';

export type KnowledgeSearchPanelProps = {
  base: KnowledgeBaseSummary;
  searchable: boolean;
  locale: KnowledgeLocale;
  search: (
    query: string,
    baseIds?: readonly string[],
  ) => Promise<KnowledgeActionResult<KnowledgeSearchResult>>;
  onOpenCitation: (citation: KnowledgeCitation) => void;
  onSendToChat: (text: string) => void;
};

type SearchStatus =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'done'; query: string; citations: KnowledgeCitation[] }
  | { kind: 'error'; message: string };

function quoteForChat(citation: KnowledgeCitation, zh: boolean): string {
  const location = knowledgeCitationLocation(citation);
  const source = `${citation.baseName} · ${citation.title}${location ? ` ${location}` : ''}`;
  const quoted = citation.text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n— ${source}\n\n${zh ? '关于这段内容：' : 'About this passage: '}`;
}

/** Retrieval without a model: raw passages, each one step from its source or a chat. */
export function KnowledgeSearchPanel(props: KnowledgeSearchPanelProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SearchStatus>({ kind: 'idle' });
  const searching = status.kind === 'searching';
  const canSearch = props.searchable && query.trim().length > 0 && !searching;

  async function runSearch(): Promise<void> {
    const trimmed = query.trim();
    if (!props.searchable || !trimmed || searching) return;
    setStatus({ kind: 'searching', query: trimmed });
    const result = await props.search(trimmed, [props.base.id]);
    setStatus(
      result.ok
        ? { kind: 'done', query: trimmed, citations: result.value.citations }
        : { kind: 'error', message: result.error },
    );
  }

  return (
    <section className="kb-search" aria-label={t('Find passages', '查找原文')} data-testid="knowledge-search-panel">
      <div className="kb-search-head">
        <h3>{t('Find passages', '查找原文')}</h3>
        <span className="kb-search-hint">
          {t('Returns source passages directly, without a model.', '不经过模型，直接返回原文片段。')}
        </span>
      </div>
      {/* A form, not a keydown handler: Enter that confirms an IME composition must not search. */}
      <form
        className="kb-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <TextInput
          value={query}
          placeholder={
            props.searchable
              ? t('Keywords or a question…', '输入关键词或问题…')
              : t('Available once ingestion finishes', '入库完成后即可查找')
          }
          onChange={(event) => setQuery(event.currentTarget.value)}
          className="kb-search-input"
          testId="knowledge-search-input"
        />
        <Button
          type="submit"
          variant="secondary"
          size="compact"
          disabled={!canSearch}
          data-testid="knowledge-search-submit"
        >
          <span>{searching ? t('Searching…', '查找中…') : t('Find', '查找')}</span>
        </Button>
      </form>

      {status.kind === 'error' ? (
        <Notice tone="error" testId="knowledge-search-error">
          {status.message}
        </Notice>
      ) : null}

      {status.kind === 'done' && status.citations.length === 0 ? (
        <p className="kb-search-empty" data-testid="knowledge-search-empty">
          {t(
            `Nothing matched “${status.query}”. Try other words, or check the relevant files are ingested.`,
            `没有找到和「${status.query}」相关的片段。换个说法试试，或确认相关文件已经入库。`,
          )}
        </p>
      ) : null}

      {status.kind === 'done' && status.citations.length > 0 ? (
        <ol className="kb-hits" data-testid="knowledge-search-results">
          {status.citations.map((citation) => {
            const location = knowledgeCitationLocation(citation);
            return (
              <li key={citation.ref} className="kb-hit">
                <div className="kb-hit-head">
                  <span className="kb-hit-title">{citation.title}</span>
                  {location ? <span className="kb-hit-loc">{location}</span> : null}
                  {citation.headingPath && citation.headingPath.length > 0 ? (
                    <span className="kb-hit-heading">{citation.headingPath.join(' › ')}</span>
                  ) : null}
                </div>
                <p className="kb-hit-text">{citation.text}</p>
                <div className="kb-hit-actions">
                  <Button variant="ghost" size="compact" onClick={() => props.onOpenCitation(citation)}>
                    <span>{t('Open source', '打开原文')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => props.onSendToChat(quoteForChat(citation, zh))}
                  >
                    <span>{t('Ask in chat', '带到对话')}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
