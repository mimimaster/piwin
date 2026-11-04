import { useMemo, useState, type ReactElement } from 'react';
import type { FlashcardCreateInput, FlashcardDraftResult } from '@piwin/contracts';
import { draftPreview } from './knowledge-card-draft.js';

export type KnowledgeCardDraftPanelProps = {
  locale: 'zh-CN' | 'en';
  result: FlashcardDraftResult;
  saving: boolean;
  error: string | null;
  onSave: (cards: FlashcardCreateInput[]) => void;
  onCancel: () => void;
};

export function KnowledgeCardDraftPanel(props: KnowledgeCardDraftPanelProps): ReactElement {
  const t = (en: string, cn: string) => (props.locale === 'zh-CN' ? cn : en);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(props.result.drafts.map((_, index) => index)),
  );
  const chosen = useMemo(
    () => props.result.drafts.filter((_, index) => selected.has(index)),
    [props.result.drafts, selected],
  );

  return (
    <div className="kw-card-draft" data-testid="knowledge-card-draft">
      <header className="kw-section-head">
        <div>
          <h2 className="kw-title">{t('Card drafts', '卡片草稿')}</h2>
          <p className="kw-sub">
            {t(
              `${props.result.counts.basic} basic · ${props.result.counts.cloze} cloze. Save only the cards you want.`,
              `${props.result.counts.basic} 张问答 · ${props.result.counts.cloze} 张填空。只保存你勾选的卡。`,
            )}
          </p>
        </div>
      </header>
      <ul className="kw-card-draft-list">
        {props.result.drafts.map((draft, index) => (
          <li key={`${draft.front ?? draft.text ?? index}-${index}`}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(index)}
                data-testid={`knowledge-card-draft-item-${index}`}
                onChange={() => {
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
              />
              <span>{draftPreview(draft) || t('(empty)', '（空）')}</span>
            </label>
          </li>
        ))}
      </ul>
      {props.error ? (
        <p className="kw-assist-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="article-actions">
        <button
          type="button"
          className="btn sm pri"
          data-testid="knowledge-card-draft-save"
          disabled={props.saving || chosen.length === 0}
          onClick={() => props.onSave(chosen)}
        >
          {props.saving ? t('Saving…', '保存中…') : t('Save selected', '保存所选')}
        </button>
        <button
          type="button"
          className="btn sm"
          data-testid="knowledge-card-draft-cancel"
          disabled={props.saving}
          onClick={props.onCancel}
        >
          {t('Cancel', '取消')}
        </button>
      </div>
    </div>
  );
}
