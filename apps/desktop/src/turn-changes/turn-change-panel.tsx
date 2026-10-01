/**
 * Right-panel 本轮变更: the turn a card opened with 查看变更 — its files and
 * per-file diffs from the sealed record (what that turn did, never the
 * current working tree), its undo state, and a way over to the workspace's
 * Git view. Nothing selected → a short hint.
 *
 * Reuses TurnChangeBar so the card and the panel can never disagree about
 * state or actions.
 */
import type { ReactElement } from 'react';
import { TurnChangeBar } from './turn-change-bar.js';
import { useTurnChangesApi } from './turn-changes-context.js';

export type TurnChangePanelProps = {
  projectPath: string | null;
  locale: 'zh-CN' | 'en';
  /** Switch the review panel to workspace Git (查看工作区全部变更). */
  onShowWorkspaceChanges: () => void;
};

export function TurnChangePanel(props: TurnChangePanelProps): ReactElement | null {
  const api = useTurnChangesApi();
  const t = (zh: string, en: string): string => (props.locale === 'en' ? en : zh);
  const summary =
    api && api.focusedChangeSetId ? api.index.summaries.get(api.focusedChangeSetId) : undefined;

  return (
    <div className="turn-change-panel" data-testid="turn-change-panel">
      {api && summary ? (
        <TurnChangeBar
          summary={summary}
          api={api}
          projectPath={props.projectPath}
          locale={props.locale}
          placement="panel"
        />
      ) : (
        <p className="right-panel-empty muted" data-testid="turn-change-panel-empty">
          {t(
            '在回答下方的「本轮改动」卡片上点「查看变更」，这里显示该轮改了什么。',
            'Choose 查看变更 on a turn’s change card to see what that turn changed here.',
          )}
        </p>
      )}
      <button
        type="button"
        className="turn-change-panel-workspace"
        onClick={props.onShowWorkspaceChanges}
        data-testid="turn-change-panel-workspace"
      >
        {t('查看工作区全部变更', 'Show all workspace changes')}
      </button>
    </div>
  );
}
