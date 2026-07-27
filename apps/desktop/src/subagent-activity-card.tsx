/**
 * Inline parent-transcript subagent lifecycle card (PSR D5).
 * Observation only — no spawn/merge controls in the default workspace UI.
 */
import type { ReactElement } from 'react';
import type { SubagentActivityView } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';

export type SubagentActivityCardProps = {
  activity: SubagentActivityView;
  onOpenSession?: (sessionId: string) => void;
};

const STATE_LABEL: Record<SubagentActivityView['state'], string> = {
  started: 'Started',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  merged: 'Merged',
};

export function SubagentActivityCard(props: SubagentActivityCardProps): ReactElement {
  const { activity } = props;
  return (
    <div
      className="subagent-activity-card"
      data-testid="subagent-activity-card"
      data-state={activity.state}
      data-child-session-id={activity.childSessionId}
    >
      <header className="subagent-activity-header">
        <strong>Subagent</strong>
        <span className={`subagent-activity-state state-${activity.state}`}>
          {STATE_LABEL[activity.state]}
        </span>
      </header>
      <div className="subagent-activity-body">
        <div className="subagent-activity-name">{activity.displayName}</div>
        <p className="subagent-activity-task muted">{activity.taskSummary}</p>
        {activity.worktreePath ? (
          <div className="subagent-activity-worktree muted" title={activity.worktreePath}>
            Worktree: <code>{activity.worktreePath}</code>
          </div>
        ) : null}
      </div>
      {props.onOpenSession ? (
        <footer className="subagent-activity-footer">
          <Button
            variant="ghost"
            size="compact"
            data-testid="subagent-open-session"
            onClick={() => props.onOpenSession?.(activity.childSessionId)}
          >
            Open session
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
