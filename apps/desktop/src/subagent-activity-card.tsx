/**
 * Inline parent-transcript subagent lifecycle card (PSR D5).
 * Observation only — no spawn/merge controls in the default workspace UI.
 *
 * When a live SubagentStreamState is provided, the card can be expanded
 * to show the child session's streaming text, thinking, and tool calls
 * in real time — similar to Cursor/Devin inline subagent views.
 */
import { useState, type ReactElement } from 'react';
import type { SubagentActivityView } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';
import { IconChevronDown } from './shell-icons.js';
import type { RunStatusKind } from './run-status.js';
import type { SubagentStreamState } from './chat-reducer.js';

export type SubagentActivityCardProps = {
  activity: SubagentActivityView;
  onOpenSession?: (sessionId: string) => void;
  /** Live stream state from child session events. When present, card is expandable. */
  stream?: SubagentStreamState;
};

const STATE_LABEL: Record<SubagentActivityView['state'], string> = {
  started: 'Started',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  merged: 'Merged',
};

const STATE_KIND_MAP: Record<SubagentActivityView['state'], RunStatusKind> = {
  started: 'preparing',
  running: 'working',
  completed: 'complete',
  failed: 'failed',
  cancelled: 'stopping',
  merged: 'complete',
};

function ToolStatusIcon({ status }: { status: 'running' | 'done' | 'error' }): ReactElement {
  if (status === 'done') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3.5 8.5l3 3 6-6" />
      </svg>
    );
  }
  if (status === 'error') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="subagent-tool-spinner"
    >
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M12.2 3.8l-2 2M5.8 10.2l-2 2" />
    </svg>
  );
}

export function SubagentActivityCard(props: SubagentActivityCardProps): ReactElement {
  const { activity, stream } = props;
  const statusKind = STATE_KIND_MAP[activity.state] ?? 'working';
  const [expanded, setExpanded] = useState(false);

  const canExpand =
    stream !== undefined &&
    (stream.text.length > 0 || stream.tools.length > 0 || stream.thinking.length > 0);
  const isLive = stream?.streaming === true;

  const handleToggle = () => {
    if (canExpand) setExpanded((prev) => !prev);
  };

  return (
    <div
      className="subagent-activity-card"
      data-testid="subagent-activity-card"
      data-state={activity.state}
      data-child-session-id={activity.childSessionId}
      data-expanded={expanded}
      data-live={isLive}
      data-can-expand={canExpand}
    >
      <header className="subagent-activity-header">
        <div
          className="subagent-activity-title"
          {...(canExpand ? { onClick: handleToggle, role: 'button', tabIndex: 0 } : {})}
        >
          <ActivitySvgIcon kind={statusKind} className="subagent-status-icon" />
          <strong>Subagent</strong>
          {canExpand ? (
            <IconChevronDown
              className={`subagent-expand-chevron${expanded ? ' is-expanded' : ''}`}
              width={12}
              height={12}
            />
          ) : null}
          {isLive ? (
            <span className="subagent-live-badge" aria-label="live">
              live
            </span>
          ) : null}
        </div>
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
        {activity.state === 'running' && !canExpand ? (
          <div className="subagent-activity-progress" aria-hidden="true">
            <div className="subagent-activity-progress-bar" />
          </div>
        ) : null}
      </div>

      {expanded && stream ? (
        <div className="subagent-stream-panel" data-testid="subagent-stream-panel">
          {stream.thinking.length > 0 ? (
            <details className="subagent-stream-thinking">
              <summary className="muted">Thinking</summary>
              <pre className="subagent-stream-thinking-text">{stream.thinking}</pre>
            </details>
          ) : null}
          {stream.tools.length > 0 ? (
            <div className="subagent-stream-tools">
              {stream.tools.map((tool) => (
                <div
                  key={tool.toolCallId}
                  className="subagent-stream-tool"
                  data-status={tool.status}
                >
                  <div className="subagent-stream-tool-header">
                    <ToolStatusIcon status={tool.status} />
                    <code className="subagent-stream-tool-name">{tool.toolName}</code>
                  </div>
                  {tool.output.length > 0 ? (
                    <pre className="subagent-stream-tool-output">{tool.output.slice(-2048)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {stream.text.length > 0 ? (
            <div className="subagent-stream-text" data-testid="subagent-stream-text">
              {stream.text}
              {isLive ? (
                <span className="subagent-stream-cursor" aria-hidden="true">
                  ▋
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

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
