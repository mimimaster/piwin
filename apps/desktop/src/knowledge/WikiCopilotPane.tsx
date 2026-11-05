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
        <div className="copilot-section-title">{t('Connected Concepts', '网状关联条目')}</div>
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
        <div className="copilot-section-title">{t('Derived Flashcards', '衍生强化闪卡')}</div>
        <div className="flashcard-mini-tile">
          <div className="flashcard-mini-kicker">
            {t('Concept Knowledge Point', '词条知识点')}
          </div>
          <div className="flashcard-mini-q">
            {concept.title}
          </div>
          <div className="flashcard-mini-a">
            {concept.summary || t('Spaced repetition drills compiled from this concept.', '基于此词条提炼的间隔复习卡片。')}
          </div>
          {props.onGoToFlashcards ? (
            <button
              type="button"
              className="btn sm pri"
              style={{ width: '100%', marginTop: '4px' }}
              onClick={props.onGoToFlashcards}
              data-testid="wiki-copilot-study-btn"
            >
              {t('Practice in Flashcards', '在每日复习中练习')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="wiki-copilot-section">
        <div className="copilot-section-title">{t('Session Tools', '会话辅助工具')}</div>
        <button
          type="button"
          className="btn sec"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => props.onUseInChat('wiki')}
          data-testid="wiki-copilot-chat-btn"
        >
          {t('Bring to Current Chat', '带入当前对话')}
        </button>
      </div>
    </aside>
  );
}
