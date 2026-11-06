import type { ReactElement } from 'react';
import type { WikiConceptDetail, WikiConceptItem } from '@piwin/contracts';
import { slugifyWikiTarget, wikiLinkLabel } from './format-wikilinks.js';

export type WikiCopilotPaneProps = {
  concept: WikiConceptDetail | null;
  concepts?: readonly WikiConceptItem[] | undefined;
  locale: 'zh-CN' | 'en';
  onSelectSlug: (slug: string) => void;
  onUseInChat: (baseId: string) => void;
  onGoToFlashcards?: (() => void) | undefined;
};

export function WikiCopilotPane(props: WikiCopilotPaneProps): ReactElement {
  const { concept, locale } = props;
  const isZh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (isZh ? cn : en);
  const catalog = props.concepts ?? [];

  if (!concept) {
    return <aside className="wiki-copilot-pane is-empty" aria-label={t('Wiki Copilot', '维基助读')} />;
  }

  return (
    <aside className="wiki-copilot-pane" aria-label={t('Wiki Copilot', '维基助读')}>
      <div className="wiki-copilot-section">
        <div className="copilot-section-title">
          <span>{t('Connected Concepts', '网状关联词条')} ({concept.links.length})</span>
        </div>
        {concept.links.length > 0 ? (
          <div className="copilot-link-list">
            {concept.links.map((link) => {
              const slug = slugifyWikiTarget(link);
              return (
                <button
                  key={link}
                  type="button"
                  className="concept-node-btn copilot-link-item"
                  onClick={() => props.onSelectSlug(slug)}
                >
                  <span>{wikiLinkLabel(link, catalog)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="wiki-copilot-hint">{t('No outbound concept links', '暂无关联词条')}</p>
        )}
      </div>

      <div className="wiki-copilot-section">
        <div className="copilot-section-title">{t('Memory Reinforcement', '记忆强化')}</div>
        <p className="wiki-copilot-desc">
          {t(
            'Distill key definitions and boundaries from this page into spaced-repetition flashcard drafts.',
            '将当前词条中的关键定义与对比边界提炼为问答/填空闪卡草稿。',
          )}
        </p>
        {props.onGoToFlashcards ? (
          <button
            type="button"
            className="btn sm pri"
            style={{ width: '100%' }}
            onClick={props.onGoToFlashcards}
            data-testid="wiki-copilot-study-btn"
          >
            {t('⚡ Practice in Flashcards', '⚡ 在每日复习中练习')}
          </button>
        ) : null}
      </div>

      <div className="wiki-copilot-section">
        <div className="copilot-section-title">{t('Session Integration', '会话联动')}</div>
        <button
          type="button"
          className="btn sec"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => props.onUseInChat('wiki')}
          data-testid="wiki-copilot-chat-btn"
        >
          {t('💬 Cite Page in Chat', '💬 引用本页到当前对话')}
        </button>
      </div>
    </aside>
  );
}
