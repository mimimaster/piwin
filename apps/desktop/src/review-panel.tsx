/**
 * Review tab — VS Code / Codex style: Changes + Git in one surface.
 */
import { useState, type ReactElement, type ReactNode } from 'react';

export type ReviewPanelProps = {
  changesContent: ReactNode;
  gitContent: ReactNode;
  changesCount?: number;
  locale?: 'zh-CN' | 'en';
};

type ReviewSubTab = 'changes' | 'history';

export function ReviewPanel(props: ReviewPanelProps): ReactElement {
  const [subTab, setSubTab] = useState<ReviewSubTab>('changes');

  return (
    <div className="review-panel" data-testid="review-panel">
      <div className="review-subtabs" role="tablist" aria-label="Review sections">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'changes'}
          className={subTab === 'changes' ? 'review-subtab active' : 'review-subtab'}
          onClick={() => setSubTab('changes')}
        >
          Changes
          {typeof props.changesCount === 'number' && props.changesCount > 0 ? (
            <span className="review-subtab-badge">{props.changesCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'history'}
          className={subTab === 'history' ? 'review-subtab active' : 'review-subtab'}
          onClick={() => setSubTab('history')}
        >
          History
        </button>
      </div>
      <div className="review-panel-body" role="tabpanel">
        {subTab === 'changes' ? props.changesContent : props.gitContent}
      </div>
    </div>
  );
}
