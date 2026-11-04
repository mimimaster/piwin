import { useCallback, type MouseEvent, type ReactElement } from 'react';
import { Spinner } from '@piwin/ui-kit';
import type { WikiConceptDetail, WikiConceptItem } from '@piwin/contracts';
import { MarkdownView } from '../markdown/MarkdownView.js';
import { formatWikilinksForMarkdown, slugifyWikiTarget, wikiLinkLabel } from './format-wikilinks.js';
import type { WikiPageDraft } from './wiki-page-draft.js';

export type WikiArticlePaneProps = {
  locale: 'zh-CN' | 'en';
  concept: WikiConceptDetail | null;
  /** Catalog used to resolve `[[slug]]` targets back to readable titles. */
  concepts: readonly WikiConceptItem[];
  loading: boolean;
  onSelectSlug: (slug: string) => void;
  onUseInChat: (baseId: string) => void;
  onOpenSources: () => void;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
  onDraftFlashcards?: ((input: { slug: string; title: string; content: string }) => void) | undefined;
  wikiFolderPath?: string | undefined;
  editable?: boolean | undefined;
  draft?: WikiPageDraft | null | undefined;
  saveError?: string | null | undefined;
  saving?: boolean | undefined;
  distilling?: boolean | undefined;
  onStartEdit?: (() => void) | undefined;
  onDraftChange?: ((draft: Pick<WikiPageDraft, 'title' | 'content'>) => void) | undefined;
  onSaveAsChange?: ((saveAs: 'create' | 'update') => void) | undefined;
  onSaveDraft?: (() => void) | undefined;
  onCancelDraft?: (() => void) | undefined;
};

/**
 * Pane 2 of the wiki workspace: one concept rendered as a reading page.
 * The page is a single column — eyebrow, title, byline, prose, colophon —
 * so the article ends where its text ends instead of being stretched to the
 * viewport with the provenance block pinned to the bottom edge.
 */
export function WikiArticlePane(props: WikiArticlePaneProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { concept } = props;

  const handleArticleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#concept-')) {
        event.preventDefault();
        props.onSelectSlug(href.replace('#concept-', ''));
      }
    },
    [props],
  );

  if (props.distilling) {
    return (
      <main className="wiki-content-canvas" aria-label={t('Distilling', '正在整理')}>
        <div className="vault-empty" data-testid="wiki-distill-pending">
          <Spinner label={t('Compiling a draft…', '正在生成草稿…')} />
        </div>
      </main>
    );
  }

  if (props.draft) {
    const sources = props.draft.sources ?? [];
    const related = props.draft.relatedPages ?? [];
    return (
      <main className="wiki-content-canvas" aria-label={t('Edit wiki page', '编辑知识页')}>
        <article className="article-container" data-testid="wiki-page-editor">
          {props.draft.existingPage ? (
            <div className="article-actions" data-testid="wiki-draft-save-as">
              <button
                type="button"
                className={`btn sm${props.draft.saveAs === 'update' ? ' pri' : ''}`}
                data-testid="wiki-draft-save-as-update"
                onClick={() => props.onSaveAsChange?.('update')}
              >
                {t('Update existing', '更新已有页')}
              </button>
              <button
                type="button"
                className={`btn sm${props.draft.saveAs === 'create' ? ' pri' : ''}`}
                data-testid="wiki-draft-save-as-create"
                onClick={() => props.onSaveAsChange?.('create')}
              >
                {t('Save as new', '另存为新页')}
              </button>
            </div>
          ) : null}
          {props.draft.saveAs === 'update' && props.draft.existingPage ? (
            <pre className="wiki-draft-current" data-testid="wiki-draft-current">
              {props.draft.existingPage.content}
            </pre>
          ) : null}
          <input
            className="wiki-draft-title"
            data-testid="wiki-draft-title"
            value={props.draft.title}
            onChange={(event) =>
              props.onDraftChange?.({ title: event.currentTarget.value, content: props.draft?.content ?? '' })
            }
            placeholder={t('Title', '标题')}
          />
          <textarea
            className="wiki-draft-body"
            data-testid="wiki-draft-body"
            value={props.draft.content}
            rows={16}
            onChange={(event) =>
              props.onDraftChange?.({ title: props.draft?.title ?? '', content: event.currentTarget.value })
            }
            placeholder={t('Write the page…', '写正文…')}
          />
          {sources.length > 0 ? (
            <ul className="wiki-draft-sources" data-testid="wiki-draft-sources">
              {sources.map((source) => (
                <li key={`${source.baseId}:${source.relativePath}`}>{source.relativePath}</li>
              ))}
            </ul>
          ) : null}
          {related.length > 0 ? (
            <ul className="wiki-draft-related" data-testid="wiki-draft-related">
              {related.map((page) => (
                <li key={page.slug}>{page.title}</li>
              ))}
            </ul>
          ) : null}
          {props.saveError ? (
            <p className="kw-assist-error" role="alert" data-testid="wiki-draft-error">
              {props.saveError}
            </p>
          ) : null}
          <div className="article-actions">
            <button
              type="button"
              className="btn sm pri"
              data-testid="wiki-draft-save"
              disabled={props.saving || !props.draft.title.trim() || !props.draft.content.trim()}
              onClick={() => props.onSaveDraft?.()}
            >
              {props.saving ? t('Saving…', '保存中…') : t('Save', '保存')}
            </button>
            <button
              type="button"
              className="btn sm"
              data-testid="wiki-draft-cancel"
              disabled={props.saving}
              onClick={() => props.onCancelDraft?.()}
            >
              {t('Cancel', '取消')}
            </button>
          </div>
        </article>
      </main>
    );
  }

  return (
    <main className="wiki-content-canvas" aria-label={t('Concept Article', '词条正文')}>
      {props.loading ? (
        <div className="vault-empty">
          <Spinner label={t('Loading concept…', '正在加载词条…')} />
        </div>
      ) : concept ? (
        <article className="article-container" id="article-body">
          <header className="article-header">
            {concept.tags.length > 0 ? (
              <div className="article-domains">
                {concept.tags.map((tag) => (
                  <span key={tag} className="article-domain">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="article-title-row">
              <h1 className="article-h1" id="wiki-main-title" data-testid="wiki-active-concept-title">
                {concept.title}
              </h1>
              <div className="article-actions">
                {props.editable && props.onStartEdit ? (
                  <button
                    type="button"
                    className="btn sm pri"
                    onClick={props.onStartEdit}
                    data-testid="wiki-edit-page-btn"
                  >
                    {t('Edit', '编辑')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => props.onUseInChat('wiki')}
                  data-testid="wiki-use-in-chat-btn"
                >
                  {t('AI Distill & Edit', 'AI 增量编纂')}
                </button>
                {props.onDraftFlashcards || (props.onProduceFlashcards && props.wikiFolderPath) ? (
                  <button
                    type="button"
                    className="btn sm pri"
                    onClick={() => {
                      if (props.onDraftFlashcards && concept) {
                        props.onDraftFlashcards({
                          slug: concept.slug,
                          title: concept.title,
                          content: concept.content,
                        });
                        return;
                      }
                      props.onProduceFlashcards?.(props.wikiFolderPath ?? '');
                    }}
                    data-testid="wiki-produce-cards-btn"
                  >
                    {t('Generate Flashcards', '生成闪卡')}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="article-byline">
              <span className="article-byline-item">
                {t('Compiled ', '编纂于 ')}
                <time dateTime={concept.updatedAt}>{concept.updatedAt.slice(0, 10)}</time>
              </span>
              <span className="article-byline-item">
                {concept.links.length} {t('linked refs', '处引用')}
              </span>
            </div>
          </header>

          <div
            className="article-prose wiki-prose-text"
            id="wiki-main-body"
            onClick={handleArticleClick}
            data-testid="wiki-concept-content"
          >
            <MarkdownView
              text={formatWikilinksForMarkdown(concept.content)}
              locale={props.locale}
              renderingPhase="completed"
            />
          </div>

          <footer className="article-colophon">
            <section className="colophon-block" data-testid="wiki-provenance-box">
              <div className="colophon-head">
                <span className="colophon-title">{t('Provenance', '证据溯源')}</span>
              </div>
              <p className="colophon-note" id="wiki-provenance-text">
                {t(
                  'This page is stored as a wiki file. Its own path is not evidence: open the sources it was distilled from to check the originals.',
                  '这一页以 Wiki 文件形式保存。它自身的路径不是证据：请打开它整理时使用的资料核对原文。',
                )}
              </p>
              {concept.sources && concept.sources.length > 0 ? (
                <ul className="colophon-sources" data-testid="wiki-concept-sources">
                  {concept.sources.map((source) => (
                    <li key={`${source.baseId}:${source.relativePath}:${source.lineStart ?? ''}`}>
                      {source.relativePath}
                      {source.lineStart !== undefined
                        ? ` · ${source.lineStart}${source.lineEnd !== undefined ? `–${source.lineEnd}` : ''}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="colophon-source">
                <code className="colophon-path" title={concept.relativePath}>
                  {concept.relativePath}
                </code>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={props.onOpenSources}
                  data-testid="wiki-goto-source-btn"
                >
                  {t('Locate in Sources →', '在信源库中定位原文 →')}
                </button>
              </div>
            </section>

            {concept.links.length > 0 ? (
              <nav className="wiki-outlinks-bar" data-testid="wiki-outlinks-footer">
                <span className="colophon-title">{t('Connected Concepts', '相关联概念')}</span>
                {concept.links.map((link) => (
                  <button
                    key={link}
                    type="button"
                    className="wiki-link-chip"
                    onClick={() => props.onSelectSlug(slugifyWikiTarget(link))}
                  >
                    {wikiLinkLabel(link, props.concepts)}
                  </button>
                ))}
              </nav>
            ) : null}
          </footer>
        </article>
      ) : (
        <div className="article-container article-standby" data-testid="wiki-empty-view">
          <div className="standby-card">
            <span className="standby-kicker">{t('LLM-Wiki', '维基编纂台')}</span>
            <h2 className="standby-title">{t('Knowledge Wiki is Ready', '知识维基已就绪')}</h2>
            <p className="standby-note">
              {t(
                'Karpathy LLM-Wiki turns raw materials into an interconnected personal encyclopedia. In any session, ask the agent to digest documents or use /wiki digest to compile concepts.',
                '基于 Andrej Karpathy LLM-Wiki 架构。在任何会话中让 Agent 提炼材料（或使用 /wiki digest），生成的百科词条将自动建立 [[双向超链接]] 并沉淀在此。',
              )}
            </p>
            <div className="standby-actions">
              <button
                type="button"
                className="btn sm pri"
                onClick={() => props.onUseInChat('wiki')}
                data-testid="wiki-use-in-chat-empty"
              >
                {t('Chat with Wiki', '在对话中探索维基')}
              </button>
              <button
                type="button"
                className="btn sm sec"
                onClick={props.onOpenSources}
                data-testid="wiki-empty-goto-documents"
              >
                {t('View Sources', '查看信源证据')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
