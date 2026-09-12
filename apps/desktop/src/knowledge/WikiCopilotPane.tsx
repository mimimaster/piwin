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
            {t('Card #01 · Concept Drill', '卡片 #01 · 概念对比')}
          </div>
          <div className="flashcard-mini-q">
            {concept.slug.includes('fsrs')
              ? t('What are the core parameters of FSRS?', 'FSRS 算法的核心调度参数有哪些？')
              : t('Difference between traditional RAG and LLM-Wiki?', '传统 RAG 与 LLM-Wiki 的本质差异是什么？')}
          </div>
          <div className="flashcard-mini-a">
            {concept.slug.includes('fsrs')
              ? t(
                  'Stability and Retrievability based differential dynamics.',
                  '基于记忆稳定性（Stability）与可提取概率（Retrievability）的微分模型。',
                )
              : t(
                  'RAG does shallow chunk retrieval; LLM-Wiki synthesizes a compounding graph.',
                  'RAG 仅对离散文本做浅层切片检索；LLM-Wiki 是由 AI 主动去重、归纳建立全局概念图谱。',
                )}
          </div>
          {props.onGoToFlashcards ? (
            <button
              type="button"
              className="btn sm pri"
              style={{ width: '100%', marginTop: '2px' }}
              onClick={props.onGoToFlashcards}
              data-testid="wiki-copilot-study-btn"
            >
              {t('Practice in Flashcards (2 cards)', '在每日复习中练习（2 张）')}
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
