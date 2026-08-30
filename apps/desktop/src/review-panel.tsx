/**
 * Review tab — three contexts: this-turn changes, subagent result, workspace Git.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useDesktopLocale } from './desktop-locale-context';

export type ReviewPanelContext = 'this-turn' | 'result' | 'git';

export type ReviewPanelProps = {
  changesContent: ReactNode;
  gitContent: ReactNode;
  resultContent?: ReactNode;
  resultId?: string;
  changeSetId?: string;
  /** Open a specific context; omitted keeps this-turn until the user switches. */
  context?: ReviewPanelContext;
  changesCount?: number;
  locale?: 'zh-CN' | 'en';
};

const TAB_LABELS = {
  'zh-CN': {
    'this-turn': '本轮变更',
    result: '子任务结果',
    git: 'Git',
  },
  en: {
    'this-turn': 'This turn',
    result: 'Result',
    git: 'Git',
  },
} as const;

const TAB_TEST_IDS: Record<ReviewPanelContext, string> = {
  'this-turn': 'review-tab-this-turn',
  result: 'review-tab-result',
  git: 'review-tab-git',
};

export function ReviewPanel(props: ReviewPanelProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const [subTab, setSubTab] = useState<ReviewPanelContext>(props.context ?? 'this-turn');
  const isZh = (props.locale ?? contextLocale) === 'zh-CN';
  const labels = isZh ? TAB_LABELS['zh-CN'] : TAB_LABELS.en;
  const showResultTab = props.resultContent != null;

  useEffect(() => {
    if (props.context !== undefined) {
      setSubTab(props.context);
    }
  }, [props.context]);

  const activeTab: ReviewPanelContext =
    subTab === 'result' && !showResultTab ? 'this-turn' : subTab;
  const body =
    activeTab === 'this-turn'
      ? props.changesContent
      : activeTab === 'result'
        ? props.resultContent
        : props.gitContent;

  return (
    <div
      className="review-panel"
      data-testid="review-panel"
      data-review-context={activeTab}
      {...(props.resultId !== undefined ? { 'data-result-id': props.resultId } : {})}
      {...(props.changeSetId !== undefined ? { 'data-change-set-id': props.changeSetId } : {})}
    >
      <div
        className="review-subtabs"
        role="tablist"
        aria-label={isZh ? '审查分区' : 'Review sections'}
      >
        <ReviewTab
          context="this-turn"
          label={labels['this-turn']}
          selected={activeTab === 'this-turn'}
          onSelect={setSubTab}
          {...(typeof props.changesCount === 'number' ? { badge: props.changesCount } : {})}
        />
        {showResultTab ? (
          <ReviewTab
            context="result"
            label={labels.result}
            selected={activeTab === 'result'}
            onSelect={setSubTab}
          />
        ) : null}
        <ReviewTab
          context="git"
          label={labels.git}
          selected={activeTab === 'git'}
          onSelect={setSubTab}
        />
      </div>
      <div className="review-panel-body" role="tabpanel" data-review-context={activeTab}>
        {body}
      </div>
    </div>
  );
}

function ReviewTab(props: {
  context: ReviewPanelContext;
  label: string;
  selected: boolean;
  onSelect: (context: ReviewPanelContext) => void;
  badge?: number;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      data-testid={TAB_TEST_IDS[props.context]}
      data-review-tab={props.context}
      aria-selected={props.selected}
      className={props.selected ? 'review-subtab active' : 'review-subtab'}
      onClick={() => props.onSelect(props.context)}
    >
      {props.label}
      {typeof props.badge === 'number' && props.badge > 0 ? (
        <span className="review-subtab-badge">{props.badge}</span>
      ) : null}
    </button>
  );
}
