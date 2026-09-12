import { useCallback, type MouseEvent, type ReactElement } from 'react';
import { Spinner } from '@piwin/ui-kit';
import type { WikiConceptDetail, WikiConceptItem } from '@piwin/contracts';
import { MarkdownView } from '../MarkdownView.js';
import { formatWikilinksForMarkdown, slugifyWikiTarget, wikiLinkLabel } from './format-wikilinks.js';

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
  wikiFolderPath?: string | undefined;
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
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => props.onUseInChat('wiki')}
                  data-testid="wiki-use-in-chat-btn"
                >
                  {t('AI Distill & Edit', 'AI 增量编纂')}
                </button>
                {props.onProduceFlashcards && props.wikiFolderPath ? (
                  <button
                    type="button"
                    className="btn sm pri"
                    onClick={() => props.onProduceFlashcards?.(props.wikiFolderPath ?? '')}
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
              <span className="wiki-stamp pine article-byline-stamp">{t('Verified', '已交叉校验')}</span>
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
                <span className="wiki-stamp azure">{t('Embedding Verified', '向量索引校验')}</span>
              </div>
              <p className="colophon-note" id="wiki-provenance-text">
                {t(
                  `Synthesized from raw knowledge slices in "${concept.relativePath}". Chunks clustered and verified via local embeddings.`,
                  `本词条合成自信源切片「${concept.relativePath}」，原始证据已由本地向量索引交叉聚类校验。`,
                )}
              </p>
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
